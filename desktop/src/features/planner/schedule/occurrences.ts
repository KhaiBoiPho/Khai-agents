/**
 * Occurrence computation, ported from Yuvomi's server/services/schedule.js
 * and the pure helpers in public/pages/schedule.js.
 *
 * Entries are computed on read, never materialised: editing a pattern can
 * never leave stale copies behind. Per day an override beats the newest
 * applicable pattern, which beats nothing; extra shifts are added on top of
 * whatever that resolved to.
 */

import { addDays, dateKeysInRange, daysBetween, toMinutes } from "./dates";
import {
  DEFAULT_WEEKLY_HOURS,
  MAX_RANGE_DAYS,
  type ExtraShift,
  type OverlapWarning,
  type Override,
  type Pattern,
  type ScheduleEntry,
  type ScheduleState,
  type ShiftType,
} from "./model";

/** Position of `date` in a cycle; days before the anchor wrap backwards. */
export function cyclePosition(anchorDate: string, cycleLength: number, date: string): number | null {
  const days = daysBetween(anchorDate, date);
  if (days === null || !Number.isInteger(cycleLength) || cycleLength < 1) return null;
  return ((days % cycleLength) + cycleLength) % cycleLength;
}

function appliesOn(pattern: Pattern, date: string): boolean {
  return (
    pattern.active &&
    (!pattern.validFrom || pattern.validFrom <= date) &&
    (!pattern.validUntil || pattern.validUntil >= date)
  );
}

/**
 * Newest validFrom first; an open-ended start loses to any dated one (SQLite
 * sorts NULL last under DESC), then the most recently created wins.
 */
export function comparePatternPriority(a: Pattern, b: Pattern): number {
  if (a.validFrom !== b.validFrom) {
    if (a.validFrom == null) return 1;
    if (b.validFrom == null) return -1;
    return a.validFrom < b.validFrom ? 1 : -1;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function isOvernightType(type: ShiftType | null): boolean {
  return Boolean(type?.start && type.end && type.end <= type.start);
}

interface ResolveInput {
  from: string;
  to: string;
  memberId: string;
  patterns: Pattern[];
  overrides: Override[];
  types: Map<string, ShiftType>;
}

/** One member's patterns and overrides over an inclusive window. */
export function resolveEntries({ from, to, memberId, patterns, overrides, types }: ResolveInput): {
  entries: ScheduleEntry[];
  warnings: OverlapWarning[];
} {
  const own = patterns
    .filter((pattern) => pattern.memberId === memberId && pattern.active)
    .sort(comparePatternPriority);
  const overrideByDate = new Map(
    overrides.filter((row) => row.memberId === memberId).map((row) => [row.date, row]),
  );
  const entries: ScheduleEntry[] = [];
  const warnings: OverlapWarning[] = [];
  const typeOf = (id: string | null) => (id ? (types.get(id) ?? null) : null);

  for (const date of dateKeysInRange(from, to)) {
    const override = overrideByDate.get(date);
    if (override) {
      const shiftType = typeOf(override.shiftTypeId);
      entries.push({
        key: `${date}:${memberId}:override:${override.id}`,
        memberId,
        date,
        source: "override",
        patternId: null,
        position: null,
        shiftType,
        note: override.note,
        isFree: shiftType === null,
        crossesMidnight: isOvernightType(shiftType),
      });
      continue;
    }
    const matches = own.filter((pattern) => appliesOn(pattern, date));
    if (!matches.length) continue;
    if (matches.length > 1) {
      warnings.push({ memberId, date, patternIds: matches.map((pattern) => pattern.id) });
    }
    const pattern = matches[0]!;
    const position = cyclePosition(pattern.anchorDate, pattern.cycleLength, date);
    const rows = pattern.days.filter((day) => day.position === position);
    // An unset position is still one explicit free-day entry, never zero.
    const effective = rows.length ? rows : [{ id: `p${pattern.id}`, position: position ?? 0, shiftTypeId: null }];
    for (const day of effective) {
      const shiftType = typeOf(day.shiftTypeId);
      entries.push({
        key: `${date}:${memberId}:pattern:${day.id}`,
        memberId,
        date,
        source: "pattern",
        patternId: pattern.id,
        position,
        shiftType,
        note: "",
        isFree: shiftType === null,
        crossesMidnight: isOvernightType(shiftType),
      });
    }
  }
  return { entries, warnings };
}

function extraEntry(extra: ExtraShift, types: Map<string, ShiftType>): ScheduleEntry {
  const shiftType = types.get(extra.shiftTypeId) ?? null;
  return {
    key: `${extra.date}:${extra.memberId}:extra:${extra.id}`,
    memberId: extra.memberId,
    date: extra.date,
    source: "extra",
    patternId: null,
    position: null,
    shiftType,
    note: extra.note,
    isFree: false,
    crossesMidnight: isOvernightType(shiftType),
  };
}

/**
 * Every member's resolved entries in [from, to], plus overlap warnings.
 * The window is capped at MAX_RANGE_DAYS, matching Yuvomi's /entries.
 */
export function scheduleData(
  state: ScheduleState,
  from: string,
  to: string,
  memberIds?: readonly string[],
): { entries: ScheduleEntry[]; warnings: OverlapWarning[] } {
  const span = daysBetween(from, to);
  if (span === null || span < 0) return { entries: [], warnings: [] };
  const end = span >= MAX_RANGE_DAYS ? addDays(from, MAX_RANGE_DAYS - 1) : to;
  const types = new Map(state.types.map((type) => [type.id, type]));
  const members =
    memberIds ??
    [...new Set([
      ...state.patterns.map((p) => p.memberId),
      ...state.overrides.map((o) => o.memberId),
      ...state.extras.map((e) => e.memberId),
    ])];
  const entries: ScheduleEntry[] = [];
  const warnings: OverlapWarning[] = [];
  for (const memberId of members) {
    const resolved = resolveEntries({
      from,
      to: end,
      memberId,
      patterns: state.patterns,
      overrides: state.overrides.filter((row) => row.date >= from && row.date <= end),
      types,
    });
    entries.push(...resolved.entries);
    warnings.push(...resolved.warnings);
    for (const extra of state.extras) {
      if (extra.memberId === memberId && extra.date >= from && extra.date <= end) {
        entries.push(extraEntry(extra, types));
      }
    }
  }
  return { entries, warnings };
}

/* ---------- Durations and labels ---------- */

/** Length in minutes; end <= start crosses midnight, end == start is 24 h. */
export function shiftMinutes(type: ShiftType | null): number | null {
  if (!type?.start || !type.end) return null;
  const start = toMinutes(type.start);
  let end = toMinutes(type.end);
  if (end <= start) end += 24 * 60;
  return end - start;
}

export function clockLabel(type: ShiftType | null): string {
  if (!type?.start || !type.end) return "All day";
  const crosses = type.end <= type.start;
  const fullDay = type.end === type.start;
  return `${type.start}–${type.end}${crosses ? " +1" : ""}${fullDay ? " · 24 h" : ""}`;
}

export function typeLabel(type: ShiftType | null): string {
  if (!type) return "Free day";
  return type.shortCode ? `${type.shortCode} · ${type.name}` : type.name;
}

export function formatHours(minutes: number): string {
  const value = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(minutes / 60);
  return `${value} h`;
}

/**
 * The worst rolling 7-day window, not fixed calendar weeks: a block running
 * Thursday to Monday would otherwise be cut into two halves that each stay
 * under the target.
 */
export function overtimeInfo(
  entries: readonly ScheduleEntry[],
  weeklyHours = DEFAULT_WEEKLY_HOURS,
): { over: boolean; excessMinutes: number } {
  const days = entries
    .map((entry) => ({ day: daysBetween("1970-01-01", entry.date) ?? 0, minutes: shiftMinutes(entry.shiftType) ?? 0 }))
    .sort((a, b) => a.day - b.day);
  let start = 0;
  let sum = 0;
  let worst = 0;
  for (let end = 0; end < days.length; end += 1) {
    sum += days[end]!.minutes;
    while (days[start]!.day < days[end]!.day - 6) {
      sum -= days[start]!.minutes;
      start += 1;
    }
    worst = Math.max(worst, sum);
  }
  const excessMinutes = Math.max(0, worst - weeklyHours * 60);
  return { over: excessMinutes > 0, excessMinutes };
}

export interface StatisticsItem {
  type: ShiftType;
  count: number;
  minutes: number;
  hasHours: boolean;
}

export function statisticsSummary(entries: readonly ScheduleEntry[]) {
  const byType = new Map<string, StatisticsItem>();
  let freeDays = 0;
  for (const entry of entries) {
    if (!entry.shiftType) {
      freeDays += 1;
      continue;
    }
    const item = byType.get(entry.shiftType.id) ?? { type: entry.shiftType, count: 0, minutes: 0, hasHours: false };
    const minutes = shiftMinutes(entry.shiftType);
    item.count += 1;
    if (minutes != null) {
      item.minutes += minutes;
      item.hasHours = true;
    }
    byType.set(entry.shiftType.id, item);
  }
  const values = [...byType.values()].sort((a, b) => b.count - a.count || a.type.name.localeCompare(b.type.name));
  return {
    values,
    freeDays,
    totalCount: values.reduce((total, item) => total + item.count, 0),
    totalMinutes: values.reduce((total, item) => total + item.minutes, 0),
  };
}

/* ---------- Pattern helpers ---------- */

/** 1-based positions that a shorter cycle would drop, or null. */
export function patternDaysExceedingCycleLength(
  days: readonly { position: number }[],
  cycleLength: number,
): { from: number; to: number } | null {
  const excluded = days.map((day) => day.position).filter((position) => position >= cycleLength);
  if (!excluded.length) return null;
  return { from: Math.min(...excluded) + 1, to: Math.max(...excluded) + 1 };
}

/** Next date on or after `today` at 1-based `position`; wraps both ways. */
export function cycleDayNextDate(anchor: string, cycleLength: number, position: number, today: string): string {
  if (!Number.isInteger(cycleLength) || cycleLength < 1) return anchor;
  const normalize = (value: number) => ((value % cycleLength) + cycleLength) % cycleLength;
  const diff = daysBetween(anchor, today) ?? 0;
  const delta = normalize(position - 1 - normalize(diff));
  return addDays(anchor, diff + delta);
}

/**
 * The date a cycle-day header names. Falls back to the first occurrence when
 * the next one sits outside the validity window, so a header never names a
 * date the pattern would not show.
 */
export function cycleDayDate(pattern: Pattern, position: number, today: string): string {
  let date = cycleDayNextDate(pattern.anchorDate, pattern.cycleLength, position, today);
  if ((pattern.validFrom && date < pattern.validFrom) || (pattern.validUntil && date > pattern.validUntil)) {
    date = addDays(pattern.anchorDate, position - 1);
  }
  return date;
}

export function windowsOverlap(
  aFrom: string | null,
  aUntil: string | null,
  bFrom: string | null,
  bUntil: string | null,
): boolean {
  return (aFrom || "0000-01-01") <= (bUntil || "9999-12-31") && (bFrom || "0000-01-01") <= (aUntil || "9999-12-31");
}

export function findOverlappingActivePattern(
  patterns: readonly Pattern[],
  memberId: string,
  validFrom: string | null,
  validUntil: string | null,
  excludeId: string | null = null,
): Pattern | undefined {
  return patterns.find(
    (pattern) =>
      pattern.active &&
      pattern.memberId === memberId &&
      pattern.id !== excludeId &&
      windowsOverlap(pattern.validFrom, pattern.validUntil, validFrom, validUntil),
  );
}

/** The winner today, or null while fewer than two patterns compete. */
export function resolveWinningPatternId(patterns: readonly Pattern[], memberId: string, date: string): string | null {
  const candidates = patterns.filter((pattern) => pattern.memberId === memberId && appliesOn(pattern, date));
  if (candidates.length < 2) return null;
  return [...candidates].sort(comparePatternPriority)[0]!.id;
}

/* ---------- Override grouping ---------- */

export interface DayGroup<T> {
  memberId: string;
  shiftTypeId: string | null;
  note: string;
  from: string;
  to: string;
  ids: string[];
  rows: T[];
}

/**
 * Consecutive days for one member with the same type and note collapse into
 * one row. Display only — storage stays one row per day.
 */
export function groupConsecutive<T extends { id: string; memberId: string; date: string; shiftTypeId: string | null; note: string }>(
  rows: readonly T[],
): DayGroup<T>[] {
  const sorted = [...rows].sort((a, b) => a.memberId.localeCompare(b.memberId) || a.date.localeCompare(b.date));
  const groups: DayGroup<T>[] = [];
  for (const row of sorted) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.memberId === row.memberId &&
      last.shiftTypeId === row.shiftTypeId &&
      last.note === row.note &&
      addDays(last.to, 1) === row.date
    ) {
      last.to = row.date;
      last.ids.push(row.id);
      last.rows.push(row);
    } else {
      groups.push({
        memberId: row.memberId,
        shiftTypeId: row.shiftTypeId,
        note: row.note,
        from: row.date,
        to: row.date,
        ids: [row.id],
        rows: [row],
      });
    }
  }
  return groups;
}

/** What of the old span lies outside the new one: zero to two pieces. */
export function rangeDifference(oldFrom: string, oldTo: string, newFrom: string, newTo: string) {
  const spans: { from: string; to: string }[] = [];
  if (oldFrom < newFrom) {
    const dayBefore = addDays(newFrom, -1);
    const end = dayBefore < oldTo ? dayBefore : oldTo;
    if (oldFrom <= end) spans.push({ from: oldFrom, to: end });
  }
  if (oldTo > newTo) {
    const dayAfter = addDays(newTo, 1);
    const start = dayAfter > oldFrom ? dayAfter : oldFrom;
    if (start <= oldTo) spans.push({ from: start, to: oldTo });
  }
  return spans;
}

/* ---------- Week grid (Compare) ---------- */

export interface LaneEntry extends ScheduleEntry {
  continuation?: boolean;
}

export const DEFAULT_ACTIVE_HOURS = Array.from({ length: 14 }, (_, index) => index + 6);

/**
 * Lanes per day and member. An overnight shift gets a second block on the
 * next day from 00:00 to its real end, and that day's "free" marker is
 * dropped — the person is only free once the shift ends.
 */
export function buildLanes(days: readonly string[], memberIds: readonly string[], entries: readonly ScheduleEntry[]) {
  const byDayAndMember = new Map<string, LaneEntry[]>();
  for (const entry of entries) {
    const key = `${entry.date}:${entry.memberId}`;
    byDayAndMember.set(key, [...(byDayAndMember.get(key) ?? []), entry]);
  }
  for (const entry of entries) {
    if (!entry.crossesMidnight) continue;
    const key = `${addDays(entry.date, 1)}:${entry.memberId}`;
    const kept = (byDayAndMember.get(key) ?? []).filter((item) => item.shiftType);
    byDayAndMember.set(key, [...kept, { ...entry, key: `${entry.key}:cont`, continuation: true }]);
  }
  const startOf = (entry: LaneEntry) =>
    entry.continuation || !entry.shiftType?.start ? -1 : toMinutes(entry.shiftType.start);
  for (const list of byDayAndMember.values()) list.sort((a, b) => startOf(a) - startOf(b));
  return days.map((date) => ({
    date,
    lanes: memberIds.map((memberId) => ({ memberId, entries: byDayAndMember.get(`${date}:${memberId}`) ?? [] })),
  }));
}

/**
 * Hours (0–23) any timed entry touches. Empty hours fold away so a
 * 45-minute class next to an 8-hour shift stays legible and to scale.
 */
export function computeActiveHours(entries: readonly ScheduleEntry[]): number[] {
  const active = new Set<number>();
  for (const entry of entries) {
    const type = entry.shiftType;
    if (!type?.start || !type.end) continue;
    const [startH] = type.start.split(":").map(Number) as [number];
    const [endH, endM] = type.end.split(":").map(Number) as [number, number];
    const endExclusive = endH + (endM > 0 ? 1 : 0);
    if (type.end <= type.start) {
      for (let hour = startH; hour < 24; hour += 1) active.add(hour);
      for (let hour = 0; hour < endExclusive; hour += 1) active.add(hour);
    } else {
      for (let hour = startH; hour < endExclusive; hour += 1) active.add(hour);
    }
  }
  if (!active.size) return DEFAULT_ACTIVE_HOURS;
  return [...active].sort((a, b) => a - b);
}

/** Minute-of-day on the folded scale; an end on the hour belongs to the hour before. */
export function collapsedMinutes(minutesOfDay: number, activeHours: readonly number[]): number | null {
  let hour = Math.floor(minutesOfDay / 60);
  let minute = minutesOfDay % 60;
  if (hour >= 24) {
    hour = 23;
    minute = 60;
  }
  let index = activeHours.indexOf(hour);
  if (index === -1 && minute === 0) {
    index = activeHours.indexOf(hour - 1);
    if (index !== -1) minute = 60;
  }
  if (index === -1) return null;
  return index * 60 + minute;
}

export function touchesVisibleDay(entry: ScheduleEntry, visible: ReadonlySet<string>): boolean {
  return visible.has(entry.date) || (entry.crossesMidnight && visible.has(addDays(entry.date, 1)));
}
