/**
 * RRULE subset and series expansion.
 *
 * Supports exactly what Yuvomi's form writes: FREQ DAILY/WEEKLY/MONTHLY/
 * YEARLY, INTERVAL, BYDAY (weekly), BYMONTHDAY=-1 (monthly only) and one end
 * condition, UNTIL or COUNT. Expansion walks day keys, never instants, so a
 * series keeps its wall-clock time across DST.
 *
 * Two rules carried over from Yuvomi's server engine:
 * - A monthly series on the 29th–31st clamps to the last day of a short month
 *   instead of skipping it, and the intended day is always taken from the
 *   series start, so one short month never rewrites it for good.
 * - COUNT counts excluded (EXDATE) occurrences too, as RFC 5545 does.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import {
  addDays,
  daysInMonth,
  dayOf,
  formatShortDate,
  makeKey,
  monthOf,
  weekdayOf,
  yearOf,
  type DateKey,
} from "./dates";

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type WeekdayCode = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export interface RRuleParts {
  freq: Freq | "";
  interval: number;
  byday: WeekdayCode[];
  /** Inclusive last day, YYYY-MM-DD, or "". */
  until: DateKey | "";
  count: number | null;
  lastDay: boolean;
}

/** Monday-first, the order the weekday buttons show. */
export const WEEKDAY_CODES: readonly WeekdayCode[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const CODE_TO_INDEX: Record<WeekdayCode, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const INDEX_TO_CODE: WeekdayCode[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const FREQS: readonly Freq[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
/** Hard stop for pathological rules; a daily series over ~50 years. */
const MAX_STEPS = 20000;

export function weekdayCodeOf(key: DateKey): WeekdayCode {
  return INDEX_TO_CODE[weekdayOf(key)]!;
}

export function emptyRule(): RRuleParts {
  return { freq: "", interval: 1, byday: [], until: "", count: null, lastDay: false };
}

export function parseRRule(rule: string | null | undefined): RRuleParts {
  const result = emptyRule();
  if (!rule) return result;
  for (const segment of String(rule).replace(/^RRULE:/i, "").split(";")) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    const key = segment.slice(0, eq).toUpperCase();
    const value = segment.slice(eq + 1).trim();
    if (key === "FREQ" && (FREQS as readonly string[]).includes(value.toUpperCase())) {
      result.freq = value.toUpperCase() as Freq;
    }
    if (key === "INTERVAL") result.interval = Math.max(1, parseInt(value, 10) || 1);
    if (key === "BYDAY") {
      result.byday = value
        .split(",")
        .map((day) => day.trim().toUpperCase())
        .filter((day): day is WeekdayCode => day in CODE_TO_INDEX);
    }
    if (key === "UNTIL") {
      const clean = value.replace(/[TZ]/g, "");
      if (/^\d{8}/.test(clean)) result.until = `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
    }
    if (key === "COUNT") {
      const n = parseInt(value, 10);
      if (Number.isInteger(n) && n > 0) result.count = n;
    }
    if (key === "BYMONTHDAY" && value === "-1") result.lastDay = true;
  }
  return result;
}

export function buildRRule(parts: RRuleParts): string | null {
  if (!parts.freq) return null;
  const out = [`FREQ=${parts.freq}`];
  if (parts.interval > 1) out.push(`INTERVAL=${parts.interval}`);
  if (parts.freq === "WEEKLY" && parts.byday.length) {
    const sorted = [...parts.byday].sort(
      (a, b) => WEEKDAY_CODES.indexOf(a) - WEEKDAY_CODES.indexOf(b),
    );
    out.push(`BYDAY=${sorted.join(",")}`);
  }
  if (parts.freq === "MONTHLY" && parts.lastDay) out.push("BYMONTHDAY=-1");
  if (parts.count && parts.count > 0) out.push(`COUNT=${parts.count}`);
  else if (parts.until) out.push(`UNTIL=${parts.until.replace(/-/g, "")}T235959Z`);
  return out.join(";");
}

function unitLabel(freq: Freq | "", plural: boolean): string {
  const units: Record<Freq, [string, string]> = {
    DAILY: ["day", "days"],
    WEEKLY: ["week", "weeks"],
    MONTHLY: ["month", "months"],
    YEARLY: ["year", "years"],
  };
  return freq ? units[freq][plural ? 1 : 0] : "";
}

export function intervalUnitLabel(freq: Freq | "", interval: number): string {
  return unitLabel(freq, interval > 1);
}

const FREQ_LABELS: Record<Freq, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
};

const DAY_LABELS: Record<WeekdayCode, string> = {
  MO: "Mo", TU: "Tu", WE: "We", TH: "Th", FR: "Fr", SA: "Sa", SU: "Su",
};

/** "Every 2 weeks (Mo, We) · until 3 Nov 2026" — the read-only summary. */
export function describeRRule(rule: string | null | undefined): string {
  const parts = parseRRule(rule);
  if (!parts.freq) return "";
  let rhythm =
    parts.interval > 1
      ? `Every ${parts.interval} ${intervalUnitLabel(parts.freq, parts.interval)}`
      : FREQ_LABELS[parts.freq];
  if (parts.freq === "WEEKLY" && parts.byday.length) {
    rhythm += ` (${parts.byday.map((day) => DAY_LABELS[day]).join(", ")})`;
  }
  if (parts.freq === "MONTHLY" && parts.lastDay) rhythm += " (on the last day of the month)";
  if (parts.count) return `${rhythm} · ${parts.count} ${parts.count === 1 ? "occurrence" : "occurrences"}`;
  if (parts.until) return `${rhythm} · until ${formatShortDate(parts.until)}`;
  return rhythm;
}

/**
 * Candidate days in series order, unbounded except by the rule itself.
 * The generator yields every slot the rule names on or after `start`;
 * callers apply EXDATE and the visible window.
 */
function* candidates(start: DateKey, parts: RRuleParts): Generator<DateKey> {
  const { freq, interval } = parts;
  if (freq === "DAILY") {
    for (let k = 0; ; k++) yield addDays(start, k * interval);
  }
  if (freq === "WEEKLY") {
    const days = (parts.byday.length ? parts.byday : [weekdayCodeOf(start)])
      .map((code) => (CODE_TO_INDEX[code] + 6) % 7) // Monday = 0
      .sort((a, b) => a - b);
    const weekMonday = addDays(start, -((weekdayOf(start) + 6) % 7));
    for (let week = 0; ; week += interval) {
      for (const offset of days) {
        const day = addDays(weekMonday, week * 7 + offset);
        if (day >= start) yield day;
      }
    }
  }
  if (freq === "MONTHLY") {
    const anchorDay = dayOf(start);
    for (let k = 0; ; k++) {
      const total = yearOf(start) * 12 + monthOf(start) + k * interval;
      const year = Math.floor(total / 12);
      const month = total - year * 12;
      const last = daysInMonth(year, month);
      const day = makeKey(year, month, parts.lastDay ? last : Math.min(anchorDay, last));
      if (day >= start) yield day;
    }
  }
  if (freq === "YEARLY") {
    const anchorDay = dayOf(start);
    const month = monthOf(start);
    for (let k = 0; ; k++) {
      const year = yearOf(start) + k * interval;
      yield makeKey(year, month, Math.min(anchorDay, daysInMonth(year, month)));
    }
  }
}

/**
 * Start days of a series that fall in [from, to], minus `exdates`.
 * A rule that does not parse yields the start alone, like a single event.
 */
export function expandSeries(
  start: DateKey,
  rule: string | null | undefined,
  from: DateKey,
  to: DateKey,
  exdates: readonly DateKey[] = [],
): DateKey[] {
  const parts = parseRRule(rule);
  if (!parts.freq) return start >= from && start <= to ? [start] : [];
  const excluded = new Set(exdates);
  const out: DateKey[] = [];
  let produced = 0;
  let steps = 0;
  for (const day of candidates(start, parts)) {
    if (++steps > MAX_STEPS) break;
    if (parts.until && day > parts.until) break;
    if (parts.count && produced >= parts.count) break;
    if (day > to) break;
    produced++;
    if (day >= from && !excluded.has(day)) out.push(day);
  }
  return out;
}

/** How many slots of the series come before `day` (EXDATEs included). */
export function occurrenceIndex(start: DateKey, rule: string | null | undefined, day: DateKey): number {
  const parts = parseRRule(rule);
  if (!parts.freq) return 0;
  let index = 0;
  let steps = 0;
  for (const candidate of candidates(start, parts)) {
    if (++steps > MAX_STEPS || candidate >= day) break;
    index++;
  }
  return index;
}

/** The series' first slot on or after `notBefore`, or null when it has ended. */
export function nextOccurrence(
  start: DateKey,
  rule: string | null | undefined,
  notBefore: DateKey,
  exdates: readonly DateKey[] = [],
  horizonDays = 366 * 5,
): DateKey | null {
  const parts = parseRRule(rule);
  if (!parts.freq) return start >= notBefore ? start : null;
  return expandSeries(start, rule, notBefore, addDays(notBefore, horizonDays), exdates)[0] ?? null;
}

/** The same rule ending the day before `day` — "this and following" cut. */
export function endRuleBefore(rule: string, day: DateKey): string | null {
  const parts = parseRRule(rule);
  if (!parts.freq) return null;
  return buildRRule({ ...parts, count: null, until: addDays(day, -1) });
}

/**
 * The rule for the successor series that starts at `day`. A COUNT series
 * hands over only the occurrences it had left, so the split adds none.
 */
export function successorRule(start: DateKey, rule: string, day: DateKey): string | null {
  const parts = parseRRule(rule);
  if (!parts.freq) return null;
  if (parts.count) {
    const remaining = parts.count - occurrenceIndex(start, rule, day);
    return buildRRule({ ...parts, count: Math.max(1, remaining) });
  }
  return buildRRule(parts);
}

/**
 * Validation for the editor: an UNTIL before the start would make a series
 * with no occurrence at all.
 */
export function ruleEndsBeforeStart(rule: string | null, start: DateKey): boolean {
  const parts = parseRRule(rule);
  return Boolean(parts.freq && parts.until && parts.until < start);
}

/** Concrete preview for "last day of the month" — Yuvomi's monthEndHintText. */
export function monthEndHint(start: DateKey): string {
  const first = makeKey(yearOf(start), monthOf(start), daysInMonth(yearOf(start), monthOf(start)));
  if (first === start) return `${formatShortDate(start)} is already the last day of the month and will be the first occurrence.`;
  return `The entered date ${formatShortDate(start)} will not be a separate occurrence. The first occurrence will be ${formatShortDate(first)}.`;
}

// --- form state ------------------------------------------------------------------

/** The editor's view of a rule. */
export interface RecurrenceState {
  freq: Freq | "";
  interval: number;
  endMode: "never" | "until" | "count";
  until: DateKey | "";
  count: number;
  /** Only days the user chose; empty means "the start's weekday". */
  byday: WeekdayCode[];
  lastDay: boolean;
}

export function recurrenceFromRule(rule: string | null): RecurrenceState {
  const parts = parseRRule(rule);
  return {
    freq: parts.freq,
    interval: parts.interval,
    endMode: parts.count ? "count" : parts.until ? "until" : "never",
    until: parts.until,
    count: parts.count ?? 10,
    byday: parts.byday,
    lastDay: parts.lastDay,
  };
}

export function ruleFromRecurrence(state: RecurrenceState): string | null {
  return buildRRule({
    freq: state.freq,
    interval: Math.min(99, Math.max(1, state.interval || 1)),
    byday: state.freq === "WEEKLY" ? state.byday : [],
    until: state.endMode === "until" ? state.until : "",
    count: state.endMode === "count" ? Math.min(999, Math.max(1, state.count || 1)) : null,
    lastDay: state.freq === "MONTHLY" && state.lastDay,
  });
}
