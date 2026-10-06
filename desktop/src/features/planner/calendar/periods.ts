/**
 * What each view shows and how far its arrows go — one answer for the
 * buttons, the shortcuts and their names (Yuvomi periodStepOf: "Next" in the
 * agenda jumped 30 days without saying so).
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import {
  addDays,
  addMonthsClamped,
  endOfMonth,
  formatDayMonth,
  formatMonthName,
  formatMonthYear,
  formatShortDate,
  formatWeekdayDate,
  isoWeek,
  monthGridSpan,
  startOfMonth,
  startOfWeek,
  yearOf,
  type DateKey,
} from "./dates";
import type { CalendarView } from "./eventStore";

export const AGENDA_SPAN = 31;
/** Days after the shown day that the day view's side rail lists. */
export const RAIL_SPAN = 7;

/** The days a view draws. */
export function visibleRange(view: CalendarView, cursor: DateKey, weekStart: number): { from: DateKey; to: DateKey } {
  if (view === "month") {
    const { from, to } = monthGridSpan(cursor, weekStart);
    return { from, to };
  }
  if (view === "week") {
    const from = startOfWeek(cursor, weekStart);
    return { from, to: addDays(from, 6) };
  }
  if (view === "agenda") return { from: cursor, to: addDays(cursor, AGENDA_SPAN - 1) };
  return { from: cursor, to: cursor };
}

/** The days whose data a view needs — the day view also feeds its rail. */
export function dataRange(view: CalendarView, cursor: DateKey, weekStart: number): { from: DateKey; to: DateKey } {
  const range = visibleRange(view, cursor, weekStart);
  return view === "day" ? { from: range.from, to: addDays(range.to, RAIL_SPAN) } : range;
}

/**
 * The cursor after one step. A month step lands on today when the new month
 * holds it, else on the 1st — counted from the 1st, never the cursor day, so
 * the 31st cannot overflow two months ahead.
 */
export function stepCursor(view: CalendarView, cursor: DateKey, dir: 1 | -1, today: DateKey): DateKey {
  if (view === "month") {
    const first = addMonthsClamped(startOfMonth(cursor), dir);
    return startOfMonth(today) === first ? today : first;
  }
  if (view === "week") return addDays(cursor, 7 * dir);
  if (view === "agenda") return addDays(cursor, 30 * dir);
  return addDays(cursor, dir);
}

export function stepLabels(view: CalendarView): { prev: string; next: string } {
  if (view === "month") return { prev: "Previous month", next: "Next month" };
  if (view === "week") return { prev: "Previous week", next: "Next week" };
  if (view === "agenda") return { prev: "Previous 30 days", next: "Next 30 days" };
  return { prev: "Previous day", next: "Next day" };
}

export function periodLabel(view: CalendarView, cursor: DateKey, weekStart: number): string {
  if (view === "month") return formatMonthYear(cursor);
  if (view === "week") {
    const from = startOfWeek(cursor, weekStart);
    return `W${isoWeek(addDays(from, 3))} · ${formatMonthName(cursor)} ${yearOf(cursor)}`;
  }
  if (view === "agenda") {
    const { from, to } = visibleRange(view, cursor, weekStart);
    return `${formatDayMonth(from)} - ${formatShortDate(to)}`;
  }
  return formatWeekdayDate(cursor, true);
}

/** Is today on screen? In the day view "today" is the day, not the range. */
export function todayInView(view: CalendarView, cursor: DateKey, weekStart: number, today: DateKey): boolean {
  if (view === "day") return cursor === today;
  if (view === "month") return startOfMonth(cursor) === startOfMonth(today);
  const { from, to } = visibleRange(view, cursor, weekStart);
  return today >= from && today <= to;
}

/** Suggested day for a new event nobody clicked a day for: today if shown, else the period's first day. */
export function newEventDay(view: CalendarView, cursor: DateKey, weekStart: number, today: DateKey): DateKey {
  if (view === "day") return cursor;
  const range =
    view === "month" ? { from: startOfMonth(cursor), to: endOfMonth(cursor) } : visibleRange(view, cursor, weekStart);
  return today >= range.from && today <= range.to ? today : range.from;
}
