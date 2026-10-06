/**
 * Recurrence for tasks — the subset of RFC 5545 RRULE the task form writes:
 * FREQ (daily/weekly/monthly/yearly), INTERVAL, BYDAY on weekly rules,
 * BYMONTHDAY=-1 on monthly rules, and UNTIL.
 *
 * A recurring task keeps exactly one open occurrence; the next one is created
 * when the current one is ticked off. All arithmetic runs on YYYY-MM-DD keys
 * through UTC fields, so a device's daylight-saving shift can never move a day.
 */

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RecurrenceRule {
  freq: Frequency;
  interval: number;
  /** Weekdays, 0 = Sunday … 6 = Saturday. Weekly rules only. */
  byday: number[];
  /** Last day of the series, YYYY-MM-DD. */
  until: string | null;
  /** Monthly on the last day of the month. */
  lastDay: boolean;
}

export const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Safety net for the catch-up loop, not its reach: daily rules fast-forward. */
const CATCH_UP_STEPS = 2000;

export function parseRule(rule: string | null | undefined): RecurrenceRule | null {
  if (!rule) return null;
  const raw = rule.startsWith("RRULE:") ? rule.slice(6) : rule;
  const parts: Record<string, string> = {};
  for (const segment of raw.split(";")) {
    const eq = segment.indexOf("=");
    if (eq > 0) parts[segment.slice(0, eq).toUpperCase()] = segment.slice(eq + 1);
  }
  const freq = (parts.FREQ ?? "").toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") {
    return null;
  }
  const interval = Math.max(1, Math.min(99, parseInt(parts.INTERVAL ?? "1", 10) || 1));
  const byday = (parts.BYDAY ?? "")
    .split(",")
    .map((token) => WEEKDAY_CODES.indexOf(token.trim().toUpperCase() as (typeof WEEKDAY_CODES)[number]))
    .filter((day) => day >= 0);
  return {
    freq,
    interval,
    byday: freq === "WEEKLY" ? [...new Set(byday)].sort((a, b) => a - b) : [],
    until: parseUntil(parts.UNTIL),
    lastDay: freq === "MONTHLY" && (parts.BYMONTHDAY ?? "").trim() === "-1",
  };
}

function parseUntil(value: string | undefined): string | null {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(value ?? "");
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function buildRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === "WEEKLY" && rule.byday.length) {
    parts.push(`BYDAY=${rule.byday.map((day) => WEEKDAY_CODES[day]).join(",")}`);
  }
  if (rule.freq === "MONTHLY" && rule.lastDay) parts.push("BYMONTHDAY=-1");
  if (rule.until) parts.push(`UNTIL=${rule.until.replaceAll("-", "")}`);
  return parts.join(";");
}

const UNIT: Record<Frequency, [string, string]> = {
  DAILY: ["day", "days"],
  WEEKLY: ["week", "weeks"],
  MONTHLY: ["month", "months"],
  YEARLY: ["year", "years"],
};

const FREQ_LABEL: Record<Frequency, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
};

export function unitLabel(freq: Frequency, count: number): string {
  return UNIT[freq][count === 1 ? 0 : 1];
}

/** "Every 2 weeks (Mon, Thu) · from completion · until Dec 31, 2026". */
export function describeRule(rule: string | null, fromCompletion = false): string {
  const parsed = parseRule(rule);
  if (!parsed) return "";
  let text =
    parsed.interval > 1
      ? `Every ${parsed.interval} ${unitLabel(parsed.freq, parsed.interval)}`
      : FREQ_LABEL[parsed.freq];
  if (parsed.byday.length) text += ` (${parsed.byday.map((day) => WEEKDAY_SHORT[day]).join(", ")})`;
  if (parsed.lastDay) text += " (last day of the month)";
  if (fromCompletion) text += " · from completion";
  if (parsed.until) text += ` · until ${formatKey(parsed.until)}`;
  return text;
}

function formatKey(key: string): string {
  const date = keyToUtc(key);
  return date
    ? date.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : key;
}

function keyToUtc(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function utcToKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * The occurrence after `base`.
 *
 * `fromArbitraryDate` is set when `base` is a completion day rather than an
 * occurrence: the interval then restarts there, so "monthly on the last day"
 * completed on the 10th does not shortcut to the 31st of the same month.
 */
export function nextOccurrence(
  base: string,
  rule: string,
  { fromArbitraryDate = false }: { fromArbitraryDate?: boolean } = {},
): string | null {
  const parsed = parseRule(rule);
  const start = keyToUtc(base);
  if (!parsed || !start) return null;
  const { freq, interval, byday } = parsed;
  const next = new Date(start);

  if (freq === "DAILY") {
    next.setUTCDate(next.getUTCDate() + interval);
  } else if (freq === "WEEKLY") {
    if (!byday.length) {
      next.setUTCDate(next.getUTCDate() + 7 * interval);
    } else {
      const current = start.getUTCDay();
      // Weeks run Monday to Sunday, so Sunday sorts last.
      const isoIndex = (day: number) => (day + 6) % 7;
      const later = byday.filter((day) => isoIndex(day) > isoIndex(current));
      if (later.length) {
        const target = later.reduce((a, b) => (isoIndex(a) < isoIndex(b) ? a : b));
        next.setUTCDate(next.getUTCDate() + (isoIndex(target) - isoIndex(current)));
      } else {
        // Wrap into the first matching day of the next active week.
        const first = byday.reduce((a, b) => (isoIndex(a) < isoIndex(b) ? a : b));
        const toWeekStart = 7 - isoIndex(current);
        next.setUTCDate(next.getUTCDate() + toWeekStart + 7 * (interval - 1) + isoIndex(first));
      }
    }
  } else if (freq === "MONTHLY") {
    const year = start.getUTCFullYear();
    let month = start.getUTCMonth() + interval;
    if (parsed.lastDay && !fromArbitraryDate) {
      const lastInBase = lastDayOf(year, start.getUTCMonth());
      if (start.getUTCDate() < lastInBase) month = start.getUTCMonth();
    }
    // Clamp before moving months: a 31st must land on the 28th/30th, not roll over.
    const last = lastDayOf(year, month);
    const day = parsed.lastDay ? last : Math.min(start.getUTCDate(), last);
    next.setTime(Date.UTC(year, month, day));
  } else {
    const year = start.getUTCFullYear() + interval;
    const month = start.getUTCMonth();
    next.setTime(Date.UTC(year, month, Math.min(start.getUTCDate(), lastDayOf(year, month))));
  }

  const key = utcToKey(next);
  if (parsed.until && key > parsed.until) return null;
  return key;
}

/** First occurrence at or after `notBefore`, skipping missed periods. */
export function nextOccurrenceAfter(base: string, rule: string, notBefore: string): string | null {
  const parsed = parseRule(rule);
  if (!parsed) return null;
  let from = base;
  const baseDate = keyToUtc(base);
  const target = keyToUtc(notBefore);
  // Jump close to the target where the grid is fixed; stop one step short.
  if (baseDate && target && target > baseDate && !parsed.byday.length) {
    const days = Math.floor((target.getTime() - baseDate.getTime()) / 86_400_000);
    const step = parsed.freq === "DAILY" ? parsed.interval : parsed.freq === "WEEKLY" ? 7 * parsed.interval : 0;
    if (step) {
      const steps = Math.floor(days / step) - 1;
      if (steps > 0) {
        const jumped = new Date(baseDate);
        jumped.setUTCDate(jumped.getUTCDate() + steps * step);
        from = utcToKey(jumped);
      }
    }
  }
  let current = nextOccurrence(from, rule);
  let guard = 0;
  while (current && current < notBefore && guard++ < CATCH_UP_STEPS) {
    current = nextOccurrence(current, rule);
  }
  return current && current >= notBefore ? current : null;
}

/**
 * The due date of the follow-up created when an occurrence is completed.
 *
 * From the due date (default) the grid stays put and an overdue task catches
 * up to the first occurrence on or after the completion day. From completion
 * the interval starts on the day it was ticked off. A series without a due
 * date counts from the completion day either way, so it never just stops.
 */
export function nextDueAfterCompletion({
  anchorDate,
  rule,
  completedOn,
  fromCompletion = false,
}: {
  anchorDate: string | null;
  rule: string;
  completedOn: string;
  fromCompletion?: boolean;
}): string | null {
  if (fromCompletion || !anchorDate) {
    return nextOccurrence(completedOn, rule, { fromArbitraryDate: true });
  }
  // Ticked off ahead of time: the next run is still the one after this due date.
  if (anchorDate >= completedOn) return nextOccurrence(anchorDate, rule);
  return nextOccurrenceAfter(anchorDate, rule, completedOn);
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const a = keyToUtc(from);
  const b = keyToUtc(to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function addDays(key: string, days: number): string {
  const date = keyToUtc(key);
  if (!date) return key;
  date.setUTCDate(date.getUTCDate() + days);
  return utcToKey(date);
}

export function weekdayOf(key: string): number | null {
  return keyToUtc(key)?.getUTCDay() ?? null;
}
