/**
 * Date-key arithmetic for Schedule.
 *
 * Keys are YYYY-MM-DD calendar days. All arithmetic runs on UTC midnights so
 * a daylight-saving change between two keys never yields a 23- or 25-hour
 * "day" — the same rule Yuvomi's server/utils/timezone.js follows.
 */

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function keyToUtc(key: string): number | null {
  const match = KEY.exec(key);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // Reject keys that roll over, such as 2026-02-30.
  return new Date(ms).toISOString().slice(0, 10) === key ? ms : null;
}

export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && keyToUtc(value) !== null;
}

export function addDays(key: string, days: number): string {
  const ms = keyToUtc(key);
  if (ms === null) return key;
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number | null {
  const a = keyToUtc(from);
  const b = keyToUtc(to);
  return a === null || b === null ? null : Math.round((b - a) / DAY_MS);
}

/** Every key from `from` to `to` inclusive; empty for a reversed range. */
export function dateKeysInRange(from: string, to: string): string[] {
  const count = daysBetween(from, to);
  if (count === null || count < 0) return [];
  return Array.from({ length: count + 1 }, (_, index) => addDays(from, index));
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(key: string): number {
  const ms = keyToUtc(key) ?? 0;
  return (new Date(ms).getUTCDay() + 6) % 7;
}

export function startOfWeek(key: string): string {
  return addDays(key, -weekdayIndex(key));
}

export function monthBounds(key: string): { from: string; to: string } {
  const [year, month] = key.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

export function addMonths(key: string, months: number): string {
  const [year, month] = key.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return date.toISOString().slice(0, 10);
}

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function utcDate(key: string): Date {
  return new Date(keyToUtc(key) ?? 0);
}

export function formatDayMonth(key: string): string {
  return utcDate(key).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

export function formatLongDate(key: string): string {
  return utcDate(key).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatMonth(key: string): string {
  return utcDate(key).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return hours * 60 + minutes;
}
