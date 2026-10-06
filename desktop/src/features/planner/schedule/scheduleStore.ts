/**
 * Schedule state: load, validate, persist, and the edits the page makes.
 *
 * Every edit is a pure function of the state so the rules (fill caps,
 * cycle-shortening refusal, type-in-use refusal) are testable without a DOM.
 *
 * TODO(backend): persist through the planning service instead of browser
 * storage; reminders and the ICS feed need the server.
 */

import { useCallback, useEffect, useState } from "react";

import { isoDate, PLANNER_KEYS, readStore, writeStore } from "../shared/persistentState";
import { dateKeysInRange, daysBetween, isDateKey } from "./dates";
import {
  MAX_CYCLE_LENGTH,
  MAX_FILL_DAYS,
  MAX_PATTERN_DAY_ROWS,
  newId,
  SHIFT_COLOR_NAMES,
  type ExtraShift,
  type Override,
  type Pattern,
  type PatternDay,
  type ScheduleState,
  type ShiftType,
} from "./model";
import { patternDaysExceedingCycleLength } from "./occurrences";
import { buildSeed } from "./seed";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const optionalKey = (value: unknown): string | null => (isDateKey(value) ? value : null);

function normalizeType(raw: unknown): ShiftType | null {
  if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const start = typeof raw.start === "string" && TIME.test(raw.start) ? raw.start : null;
  const end = typeof raw.end === "string" && TIME.test(raw.end) ? raw.end : null;
  const color = SHIFT_COLOR_NAMES.includes(raw.color as never) ? (raw.color as ShiftType["color"]) : "slate";
  return {
    id: raw.id,
    name: raw.name,
    shortCode: str(raw.shortCode).slice(0, 12),
    // Both or neither.
    start: start && end ? start : null,
    end: start && end ? end : null,
    color,
  };
}

function normalizePattern(raw: unknown): Pattern | null {
  if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.memberId !== "string") return null;
  if (!isDateKey(raw.anchorDate)) return null;
  const cycleLength = Number(raw.cycleLength);
  if (!Number.isInteger(cycleLength) || cycleLength < 1 || cycleLength > MAX_CYCLE_LENGTH) return null;
  const days: PatternDay[] = Array.isArray(raw.days)
    ? raw.days.flatMap((day): PatternDay[] => {
        if (!isObject(day) || !Number.isInteger(day.position)) return [];
        const position = day.position as number;
        if (position < 0 || position >= cycleLength) return [];
        return [{ id: str(day.id, newId("pd")), position, shiftTypeId: typeof day.shiftTypeId === "string" ? day.shiftTypeId : null }];
      })
    : [];
  return {
    id: raw.id,
    memberId: raw.memberId,
    name: str(raw.name, "Schedule plan"),
    kind: raw.kind === "timetable" ? "timetable" : "rotation",
    anchorDate: raw.anchorDate,
    cycleLength,
    validFrom: optionalKey(raw.validFrom),
    validUntil: optionalKey(raw.validUntil),
    active: raw.active !== false,
    days,
    createdAt: str(raw.createdAt, "1970-01-01T00:00:00.000Z"),
  };
}

function normalizeDayRow<T extends Override | ExtraShift>(raw: unknown, requireType: boolean): T | null {
  if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.memberId !== "string" || !isDateKey(raw.date)) return null;
  const shiftTypeId = typeof raw.shiftTypeId === "string" ? raw.shiftTypeId : null;
  if (requireType && !shiftTypeId) return null;
  return { id: raw.id, memberId: raw.memberId, date: raw.date, shiftTypeId, note: str(raw.note) } as T;
}

/** A stored value of the wrong shape falls back to the seed. */
export function normalizeState(raw: unknown, seed: ScheduleState): ScheduleState {
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.types) || !Array.isArray(raw.patterns)) return seed;
  const settings = isObject(raw.settings) ? raw.settings : {};
  const weeklyHours: Record<string, number> = {};
  if (isObject(settings.weeklyHours)) {
    for (const [member, hours] of Object.entries(settings.weeklyHours)) {
      if (typeof hours === "number" && hours > 0 && hours <= 168) weeklyHours[member] = hours;
    }
  }
  return {
    version: 1,
    types: raw.types.map(normalizeType).filter((type): type is ShiftType => type !== null),
    patterns: raw.patterns.map(normalizePattern).filter((pattern): pattern is Pattern => pattern !== null),
    overrides: (Array.isArray(raw.overrides) ? raw.overrides : [])
      .map((row) => normalizeDayRow<Override>(row, false))
      .filter((row): row is Override => row !== null),
    extras: (Array.isArray(raw.extras) ? raw.extras : [])
      .map((row) => normalizeDayRow<ExtraShift>(row, true))
      .filter((row): row is ExtraShift => row !== null),
    settings: { weeklyHours, overtimeEnabled: settings.overtimeEnabled !== false },
  };
}

export function todayKey(): string {
  return isoDate(new Date());
}

export function loadScheduleState(today = todayKey()): ScheduleState {
  const seed = buildSeed(today);
  return normalizeState(readStore<unknown>(PLANNER_KEYS.schedule, seed), seed);
}

/* ---------- Edits ---------- */

export class ScheduleError extends Error {}

export type ShiftTypeInput = Omit<ShiftType, "id">;

export function upsertShiftType(state: ScheduleState, input: ShiftTypeInput, id?: string): ScheduleState {
  const name = input.name.trim();
  if (!name) throw new ScheduleError("Give the shift type a name.");
  if (Boolean(input.start) !== Boolean(input.end)) throw new ScheduleError("Set both a start and an end time, or neither.");
  const type: ShiftType = { ...input, name, shortCode: input.shortCode.trim().slice(0, 12), id: id ?? newId("st") };
  return {
    ...state,
    types: id ? state.types.map((item) => (item.id === id ? type : item)) : [...state.types, type],
  };
}

export function shiftTypeInUse(state: ScheduleState, id: string): boolean {
  return (
    state.patterns.some((pattern) => pattern.days.some((day) => day.shiftTypeId === id)) ||
    state.overrides.some((row) => row.shiftTypeId === id) ||
    state.extras.some((row) => row.shiftTypeId === id)
  );
}

export function deleteShiftType(state: ScheduleState, id: string): ScheduleState {
  // Mirrors ON DELETE RESTRICT: a type still in use cannot vanish under a plan.
  if (shiftTypeInUse(state, id)) {
    throw new ScheduleError("This shift type is still used by a schedule plan, override, or extra shift. Remove those uses first.");
  }
  return { ...state, types: state.types.filter((type) => type.id !== id) };
}

/** Creates the template's presets that are not there yet (by name). */
export function applyQuickstart(
  state: ScheduleState,
  presets: readonly Omit<ShiftType, "id">[],
): { state: ScheduleState; created: number } {
  const existing = new Set(state.types.map((type) => type.name.toLowerCase()));
  const fresh = presets
    .filter((preset) => !existing.has(preset.name.toLowerCase()))
    .map((preset) => ({ ...preset, id: newId("st") }));
  return { state: { ...state, types: [...state.types, ...fresh] }, created: fresh.length };
}

export type PatternInput = Pick<
  Pattern,
  "memberId" | "name" | "kind" | "anchorDate" | "cycleLength" | "validFrom" | "validUntil" | "active"
>;

export function upsertPattern(state: ScheduleState, input: PatternInput, id?: string): ScheduleState {
  const name = input.name.trim();
  if (!name) throw new ScheduleError("Give the plan a name.");
  if (!isDateKey(input.anchorDate)) throw new ScheduleError("Choose the day the cycle starts on.");
  if (!Number.isInteger(input.cycleLength) || input.cycleLength < 1 || input.cycleLength > MAX_CYCLE_LENGTH) {
    throw new ScheduleError(`The cycle must be between 1 and ${MAX_CYCLE_LENGTH} days.`);
  }
  if (input.validFrom && input.validUntil && input.validFrom > input.validUntil) {
    throw new ScheduleError("“Valid until” must not be before “Valid from”.");
  }
  if (id) {
    const current = state.patterns.find((pattern) => pattern.id === id);
    if (!current) return state;
    // Shortening is refused while days sit beyond the new length, rather than
    // silently dropping them.
    const excluded = patternDaysExceedingCycleLength(
      current.days.filter((day) => day.shiftTypeId),
      input.cycleLength,
    );
    if (excluded) {
      throw new ScheduleError(`Days ${excluded.from}–${excluded.to} still have shifts. Clear them first, then shorten the cycle.`);
    }
    const days = current.days.filter((day) => day.position < input.cycleLength);
    return {
      ...state,
      patterns: state.patterns.map((pattern) => (pattern.id === id ? { ...pattern, ...input, name, days } : pattern)),
    };
  }
  const pattern: Pattern = { ...input, name, id: newId("sp"), days: [], createdAt: new Date().toISOString() };
  return { ...state, patterns: [...state.patterns, pattern] };
}

/** Replaces every cycle-day row in one go, like PUT /patterns/:id/days. */
export function savePatternDays(
  state: ScheduleState,
  patternId: string,
  rows: readonly { position: number; shiftTypeId: string | null }[],
): ScheduleState {
  if (rows.length > MAX_PATTERN_DAY_ROWS) throw new ScheduleError(`A plan holds at most ${MAX_PATTERN_DAY_ROWS} rows.`);
  return {
    ...state,
    patterns: state.patterns.map((pattern) =>
      pattern.id === patternId
        ? {
            ...pattern,
            days: rows
              .filter((row) => row.position >= 0 && row.position < pattern.cycleLength && row.shiftTypeId)
              .map((row) => ({ id: newId("pd"), position: row.position, shiftTypeId: row.shiftTypeId })),
          }
        : pattern,
    ),
  };
}

export function deletePattern(state: ScheduleState, id: string): ScheduleState {
  return { ...state, patterns: state.patterns.filter((pattern) => pattern.id !== id) };
}

function checkSpan(from: string, to: string): number {
  const span = daysBetween(from, to);
  if (span === null || span < 0) throw new ScheduleError("Choose a valid period.");
  if (span + 1 > MAX_FILL_DAYS) throw new ScheduleError(`A range covers at most ${MAX_FILL_DAYS} days.`);
  return span;
}

/** Upserts one override per day across an inclusive range. */
export function fillOverrides(
  state: ScheduleState,
  memberId: string,
  from: string,
  to: string,
  shiftTypeId: string | null,
  note: string,
): ScheduleState {
  checkSpan(from, to);
  const dates = new Set(dateKeysInRange(from, to));
  const kept = state.overrides.filter((row) => !(row.memberId === memberId && dates.has(row.date)));
  const added = [...dates].map((date) => ({ id: newId("so"), memberId, date, shiftTypeId, note: note.trim() }));
  return { ...state, overrides: [...kept, ...added] };
}

export function deleteOverrides(state: ScheduleState, memberId: string, from: string, to: string): ScheduleState {
  return {
    ...state,
    overrides: state.overrides.filter((row) => !(row.memberId === memberId && row.date >= from && row.date <= to)),
  };
}

/** Adds one extra per day across a range; extras stack, so nothing is replaced. */
export function addExtras(
  state: ScheduleState,
  memberId: string,
  from: string,
  to: string,
  shiftTypeId: string,
  note: string,
): ScheduleState {
  if (!shiftTypeId) throw new ScheduleError("Choose a shift type.");
  checkSpan(from, to);
  const added = dateKeysInRange(from, to).map((date) => ({ id: newId("se"), memberId, date, shiftTypeId, note: note.trim() }));
  return { ...state, extras: [...state.extras, ...added] };
}

export function deleteExtras(state: ScheduleState, ids: readonly string[]): ScheduleState {
  const drop = new Set(ids);
  return { ...state, extras: state.extras.filter((row) => !drop.has(row.id)) };
}

export function setWeeklyHours(state: ScheduleState, memberId: string, hours: number | null): ScheduleState {
  const weeklyHours = { ...state.settings.weeklyHours };
  if (hours && hours > 0) weeklyHours[memberId] = hours;
  else delete weeklyHours[memberId];
  return { ...state, settings: { ...state.settings, weeklyHours } };
}

/* ---------- Hook ---------- */

export function useScheduleStore() {
  const [state, setState] = useState<ScheduleState>(() => loadScheduleState());
  useEffect(() => {
    writeStore(PLANNER_KEYS.schedule, state);
  }, [state]);
  /** Applies an edit; returns the error message instead of throwing. */
  const apply = useCallback((edit: (current: ScheduleState) => ScheduleState): string | null => {
    let next: ScheduleState;
    try {
      next = edit(state);
    } catch (error) {
      if (error instanceof ScheduleError) return error.message;
      throw error;
    }
    setState(next);
    return null;
  }, [state]);
  return { state, apply, reset: () => setState(buildSeed(todayKey())) };
}
