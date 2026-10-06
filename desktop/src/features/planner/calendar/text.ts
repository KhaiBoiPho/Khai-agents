/**
 * One way of saying each time, used by every view: "17:00 - 18:30", "from
 * 22:00", "until 01:30", "Day 2 of 3". Yuvomi had three spellings of the same
 * span before it settled on one (Critique 2026-09-24).
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import {
  datePart,
  formatClock,
  formatShortDate,
  formatWeekdayDate,
  timePart,
  type DateKey,
} from "./dates";
import { isMultiDay, lastDay, multiDayPosition, segmentKind } from "./layout";
import type { Occurrence, Visibility } from "./model";

type Span = Pick<Occurrence, "start" | "end" | "allDay">;

export function timeSpanText(start: string, end: string): string {
  const a = formatClock(timePart(start));
  const b = timePart(end) ? formatClock(timePart(end)) : "";
  return b ? `${a} - ${b}` : a;
}

/** The time of an occurrence on the day it is drawn. */
export function occurrenceTimeText(o: Span, day: DateKey | null = null): string {
  const kind = day ? segmentKind(o, day) : o.allDay ? "all-day" : "single";
  if (kind === "all-day" || kind === "middle") return "All day";
  if (kind === "start") return `from ${formatClock(timePart(o.start))}`;
  if (kind === "end") return `until ${formatClock(timePart(o.end))}`;
  return timeSpanText(o.start, o.end);
}

export function positionText(o: Span, day: DateKey): string {
  const position = multiDayPosition(o, day);
  return position ? `Day ${position.day} of ${position.count}` : "";
}

/**
 * The "When" line of the detail view. A multi-day timed event names both
 * days; ending at 00:00 names the real end instant, not the last grid day
 * (#1102, #1114).
 */
export function whenText(o: Span): string {
  const startDay = datePart(o.start);
  if (o.allDay) {
    const dates = isMultiDay(o)
      ? `${formatShortDate(startDay)} - ${formatShortDate(lastDay(o))}`
      : formatWeekdayDate(startDay, true);
    return `${dates} · All day`;
  }
  if (!isMultiDay(o)) return `${formatWeekdayDate(startDay, true)}, ${timeSpanText(o.start, o.end)}`;
  return `${formatShortDate(startDay)} ${formatClock(timePart(o.start))} - ${formatShortDate(datePart(o.end))} ${formatClock(timePart(o.end))}`;
}

export const REMINDER_PRESETS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 0, label: "At event time" },
  { minutes: 15, label: "15 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 2880, label: "2 days before" },
  { minutes: 10080, label: "1 week before" },
  { minutes: 20160, label: "2 weeks before" },
];

export type ReminderUnit = "minutes" | "hours" | "days" | "weeks";
export const UNIT_MINUTES: Record<ReminderUnit, number> = { minutes: 1, hours: 60, days: 1440, weeks: 10080 };

/** Largest whole unit, for showing a custom lead time back. */
export function splitMinutes(minutes: number): { amount: number; unit: ReminderUnit } {
  for (const unit of ["weeks", "days", "hours"] as const) {
    if (minutes > 0 && minutes % UNIT_MINUTES[unit] === 0) return { amount: minutes / UNIT_MINUTES[unit], unit };
  }
  return { amount: minutes, unit: "minutes" };
}

export function reminderLabel(minutes: number): string {
  const preset = REMINDER_PRESETS.find((p) => p.minutes === minutes);
  if (preset) return preset.label;
  const { amount, unit } = splitMinutes(minutes);
  const name = amount === 1 ? unit.slice(0, -1) : unit;
  return `${amount} ${name} before`;
}

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  all: "Everyone in the workspace",
  assignees: "Assignees only",
  private: "Only me",
};

export function mapUrl(location: string): string {
  const query = location.trim();
  return query ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}` : "";
}

/** One reminder line in the editor. */
export interface ReminderRow {
  id: string;
  /** A preset's minutes as text, or "custom". */
  choice: string;
  amount: number;
  unit: ReminderUnit;
}

export function reminderRowMinutes(row: ReminderRow): number {
  return row.choice === "custom" ? row.amount * UNIT_MINUTES[row.unit] : Number(row.choice);
}
