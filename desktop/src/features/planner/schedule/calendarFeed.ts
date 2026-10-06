/**
 * What the Calendar shows of Schedule: computed shift and timetable
 * occurrences, drawn as an overlay layer.
 *
 * CONTRACT — the Calendar imports this signature; the Schedule module owns
 * the body and must keep the signature stable.
 */

import { daysBetween, isDateKey } from "./dates";
import { shiftColor } from "./model";
import { scheduleData } from "./occurrences";
import { loadScheduleState } from "./scheduleStore";

export interface ScheduleOccurrence {
  id: string;
  /** YYYY-MM-DD, local. */
  date: string;
  /** Short label, e.g. "Early shift" or "Math". */
  label: string;
  /** HH:MM, local; both absent for an all-day entry such as "Off". */
  start?: string;
  end?: string;
  /** CSS colour for the overlay chip. */
  color: string;
  memberId: string | null;
}

/** Occurrences between `from` and `to` inclusive (YYYY-MM-DD). */
export function readScheduleOccurrences(from: string, to: string): ScheduleOccurrence[] {
  if (!isDateKey(from) || !isDateKey(to) || (daysBetween(from, to) ?? -1) < 0) return [];
  const { entries } = scheduleData(loadScheduleState(), from, to);
  // Free days stay off the overlay, as in Yuvomi's calendar: only typed
  // entries (including all-day ones such as Vacation) are shown. Overnight
  // shifts stay on their start day.
  return entries
    .filter((entry) => entry.shiftType)
    .map((entry) => {
      const type = entry.shiftType!;
      const occurrence: ScheduleOccurrence = {
        id: `schedule:${entry.key}`,
        date: entry.date,
        label: type.name,
        color: shiftColor(type.color),
        memberId: entry.memberId,
      };
      if (type.start && type.end) {
        occurrence.start = type.start;
        occurrence.end = type.end;
      }
      return occurrence;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? ""));
}
