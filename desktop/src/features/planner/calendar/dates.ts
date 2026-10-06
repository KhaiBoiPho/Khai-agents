/**
 * Calendar-day arithmetic on YYYY-MM-DD keys.
 *
 * A key is a calendar day, not an instant. Every step goes through UTC
 * midnights so a daylight-saving change (a 23- or 25-hour local day) can never
 * turn "one day later" into the same day or two days later — the bug class
 * Yuvomi fixed in its own daysBetween(). Times are wall-clock "HH:MM" strings
 * for the same reason: an appointment at 09:00 stays at 09:00 across DST.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

export type DateKey = string;

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== "string") return false;
  const match = KEY_RE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!));
  return date.getUTCDate() === +match[3]! && date.getUTCMonth() === +match[2]! - 1;
}

function utcMs(key: DateKey): number {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function fromUtcMs(ms: number): DateKey {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** The key as a Date at UTC midnight — only for Intl formatting with timeZone UTC. */
export function keyToUtcDate(key: DateKey): Date {
  return new Date(utcMs(key));
}

export function makeKey(year: number, monthIndex: number, day: number): DateKey {
  return fromUtcMs(Date.UTC(year, monthIndex, day));
}

/** Local calendar day of an instant (not UTC, which shifts near midnight). */
export function localKey(date: Date): DateKey {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function addDays(key: DateKey, n: number): DateKey {
  return fromUtcMs(utcMs(key) + n * DAY_MS);
}

/** Whole calendar days from a to b (b - a). */
export function daysBetween(a: DateKey, b: DateKey): number {
  return Math.round((utcMs(b) - utcMs(a)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key: DateKey): number {
  return new Date(utcMs(key)).getUTCDay();
}

export function yearOf(key: DateKey): number {
  return Number(key.slice(0, 4));
}

/** 0-based month. */
export function monthOf(key: DateKey): number {
  return Number(key.slice(5, 7)) - 1;
}

export function dayOf(key: DateKey): number {
  return Number(key.slice(8, 10));
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function startOfMonth(key: DateKey): DateKey {
  return `${key.slice(0, 7)}-01`;
}

export function endOfMonth(key: DateKey): DateKey {
  return makeKey(yearOf(key), monthOf(key), daysInMonth(yearOf(key), monthOf(key)));
}

/** Month step with the day clamped: the 31st becomes the month's last day. */
export function addMonthsClamped(key: DateKey, n: number): DateKey {
  const total = yearOf(key) * 12 + monthOf(key) + n;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  return makeKey(year, month, Math.min(dayOf(key), daysInMonth(year, month)));
}

export function startOfWeek(key: DateKey, weekStart: number): DateKey {
  return addDays(key, -((weekdayOf(key) - weekStart + 7) % 7));
}

/** Weekday indices (0 = Sunday) in display order for a week start. */
export function weekdayOrder(weekStart: number): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}

/**
 * The month grid: where it starts and how many week rows the month needs —
 * four to six, not always six (a fixed 42 days drew a whole row of the next
 * month in September 2026).
 */
export function monthGridSpan(
  key: DateKey,
  weekStart: number,
): { from: DateKey; to: DateKey; weeks: number } {
  const first = startOfMonth(key);
  const lead = (weekdayOf(first) - weekStart + 7) % 7;
  const weeks = Math.ceil((lead + daysInMonth(yearOf(key), monthOf(key))) / 7);
  const from = addDays(first, -lead);
  return { from, to: addDays(from, weeks * 7 - 1), weeks };
}

/** Keys from `from` to `to` inclusive. */
export function dayRange(from: DateKey, to: DateKey): DateKey[] {
  const count = daysBetween(from, to) + 1;
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(from, i));
}

/** ISO-8601 week number: week 1 holds the year's first Thursday. */
export function isoWeek(key: DateKey): number {
  const thursday = addDays(key, 3 - ((weekdayOf(key) + 6) % 7));
  const jan4 = `${thursday.slice(0, 4)}-01-04`;
  const firstThursday = addDays(jan4, 3 - ((weekdayOf(jan4) + 6) % 7));
  return 1 + Math.round(daysBetween(firstThursday, thursday) / 7);
}

export function isWeekend(key: DateKey): boolean {
  const day = weekdayOf(key);
  return day === 0 || day === 6;
}

// --- wall-clock times --------------------------------------------------------

export function timeToMinutes(time: string | undefined | null): number {
  if (!time) return 0;
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime(minutes: number): string {
  const clamped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}`;
}

/** Add minutes to a date + time, carrying past midnight onto the date. */
export function addMinutes(
  date: DateKey,
  time: string,
  minutes: number,
): { date: DateKey; time: string } {
  const total = timeToMinutes(time) + minutes;
  const dayShift = Math.floor(total / 1440);
  return { date: dayShift ? addDays(date, dayShift) : date, time: minutesToTime(total) };
}

/** "YYYY-MM-DD" part of a stored start/end. */
export function datePart(value: string): DateKey {
  return value.slice(0, 10);
}

/** "HH:MM" part of a stored start/end, or "" for a date-only value. */
export function timePart(value: string): string {
  return value.length > 10 ? value.slice(11, 16) : "";
}

export function joinDateTime(date: DateKey, time: string): string {
  return time ? `${date}T${time}` : date;
}

/** Minutes between two stored values (date-only counts as 00:00). */
export function minutesBetween(a: string, b: string): number {
  return daysBetween(datePart(a), datePart(b)) * 1440 + timeToMinutes(timePart(b)) - timeToMinutes(timePart(a));
}

/** Next half hour today, or 09:00 for other days (Yuvomi's default). */
export function defaultStartTime(date: DateKey, today: DateKey, now: Date): string {
  if (date !== today) return "09:00";
  const hour = now.getHours();
  const minute = now.getMinutes();
  const next = minute < 30 ? { hour, minute: 30 } : { hour: hour + 1, minute: 0 };
  return next.hour > 23 ? "09:00" : `${pad2(next.hour)}:${pad2(next.minute)}`;
}

// --- formatting ---------------------------------------------------------------

function format(key: DateKey, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(
    keyToUtcDate(key),
  );
}

export function formatMonthYear(key: DateKey): string {
  return format(key, { month: "long", year: "numeric" });
}

export function formatMonthName(key: DateKey): string {
  return format(key, { month: "long" });
}

export function formatDayMonth(key: DateKey): string {
  return format(key, { day: "numeric", month: "short" });
}

export function formatShortDate(key: DateKey): string {
  return format(key, { day: "numeric", month: "short", year: "numeric" });
}

export function formatWeekdayDate(key: DateKey, long = false): string {
  return format(
    key,
    long
      ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      : { weekday: "short", day: "numeric", month: "short" },
  );
}

export function weekdayName(weekday: number, style: "short" | "long" | "narrow" = "short"): string {
  // 2026-10-04 is a Sunday; weekday 0 maps onto it.
  return format(addDays("2026-10-04", weekday), { weekday: style });
}

export function formatClock(time: string): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, 0, 1, h || 0, m || 0)));
}

export function formatHour(hour: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, 0, 1, hour)),
  );
}

/** "13 to 15 October", with the year when it crosses one. */
export function spokenDateSpan(from: DateKey, to: DateKey): string {
  const withYear = from.slice(0, 4) !== to.slice(0, 4);
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}) };
  return `${format(from, options)} to ${format(to, options)}`;
}
