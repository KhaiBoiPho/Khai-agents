/**
 * Find an event without knowing its date (Yuvomi #471). Matches title,
 * location and description; a series appears once, at its next occurrence
 * (or its last one, if it has ended).
 *
 * TODO(backend): Yuvomi searches a full-text index on the server.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { addDays, datePart, type DateKey } from "./dates";
import { expandEvents } from "./layout";
import type { CalendarEvent, Occurrence } from "./model";
import { nextOccurrence } from "./recurrence";

export const SEARCH_LIMIT = 50;

export function searchEvents(events: readonly CalendarEvent[], query: string, today: DateKey): Occurrence[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2) return [];
  const hits: Occurrence[] = [];
  for (const event of events) {
    const haystack = `${event.title}\n${event.location}\n${event.description}`.toLocaleLowerCase();
    if (!haystack.includes(needle)) continue;
    const start = datePart(event.start);
    let day = nextOccurrence(start, event.rrule, today, event.exdates) ?? start;
    if (event.rrule && day === start && start < today) {
      // Ended series: show its last occurrence within the past two years.
      const past = expandEvents([event], addDays(today, -730), addDays(today, -1));
      day = past.length ? past[past.length - 1]!.slot : start;
    }
    const occurrence = expandEvents([event], day, day).find((o) => o.slot === day);
    if (occurrence) hits.push(occurrence);
  }
  return hits.sort((a, b) => a.start.localeCompare(b.start));
}
