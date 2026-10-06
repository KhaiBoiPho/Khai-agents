/**
 * Calendar events and view preferences in planner storage, and the edits
 * that change them.
 *
 * An edit is a list of changes, each the row before and after (null for
 * "did not exist" / "removed"). Undo replays them backwards by id rather than
 * restoring a snapshot, so an undo never discards an unrelated edit made
 * while its toast was showing.
 *
 * Series edits follow Yuvomi's three scopes (#489, #532, #1284):
 * - this: the slot becomes an EXDATE and a standalone event takes its place;
 * - following: the series ends the day before and a successor starts here;
 * - series: the whole row changes, shifted by however far this occurrence moved.
 *
 * TODO(backend): replace browser storage with the calendar service.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { useCallback, useMemo } from "react";

import { PLANNER_KEYS, usePersistentState } from "../shared/persistentState";
import {
  addDays,
  addMinutes,
  datePart,
  daysBetween,
  minutesBetween,
  timePart,
  type DateKey,
} from "./dates";
import { newEventId, sanitizeEvents, seedEvents, type CalendarEvent, type Occurrence } from "./model";
import { endRuleBefore, successorRule } from "./recurrence";

export type Scope = "this" | "following" | "series";

/** What the editor hands back: everything a user can set on an event. */
export type EventDraft = Omit<CalendarEvent, "id" | "exdates" | "createdBy">;

export interface Change {
  id: string;
  before: CalendarEvent | null;
  after: CalendarEvent | null;
}

export function applyChanges(events: readonly CalendarEvent[], changes: readonly Change[]): CalendarEvent[] {
  let next = [...events];
  for (const change of changes) {
    const index = next.findIndex((event) => event.id === change.id);
    if (change.after === null) {
      if (index >= 0) next = next.filter((_, i) => i !== index);
    } else if (index >= 0) {
      next[index] = change.after;
    } else {
      next.push(change.after);
    }
  }
  return next;
}

export function revertChanges(events: readonly CalendarEvent[], changes: readonly Change[]): CalendarEvent[] {
  return applyChanges(
    events,
    [...changes].reverse().map((change) => ({ id: change.id, before: change.after, after: change.before })),
  );
}

export function createChanges(draft: EventDraft, id = newEventId()): Change[] {
  return [{ id, before: null, after: { ...draft, id, exdates: [], createdBy: "me" } }];
}

/**
 * Move a series so that the occurrence the user edited lands where the draft
 * says, keeping the draft's duration. Editing "whole series" from its third
 * occurrence must not drag the series start to that occurrence.
 */
function shiftSeries(event: CalendarEvent, occurrence: Occurrence, draft: EventDraft): Pick<CalendarEvent, "start" | "end"> {
  const dayShift = daysBetween(datePart(occurrence.start), datePart(draft.start));
  const startDate = addDays(datePart(event.start), dayShift);
  if (draft.allDay) {
    const span = Math.max(0, daysBetween(datePart(draft.start), datePart(draft.end)));
    return { start: startDate, end: addDays(startDate, span) };
  }
  const time = timePart(draft.start) || "09:00";
  const duration = Math.max(0, minutesBetween(draft.start, draft.end));
  const end = addMinutes(startDate, time, duration);
  return { start: `${startDate}T${time}`, end: `${end.date}T${end.time}` };
}

export function updateChanges(
  events: readonly CalendarEvent[],
  occurrence: Occurrence,
  draft: EventDraft,
  scope: Scope,
): Change[] {
  const event = events.find((row) => row.id === occurrence.event.id);
  if (!event) return [];
  const firstSlot = datePart(event.start);

  if (!event.rrule || scope === "series" || (scope === "following" && occurrence.slot === firstSlot)) {
    const moved = event.rrule ? shiftSeries(event, occurrence, draft) : { start: draft.start, end: draft.end };
    const after: CalendarEvent = { ...event, ...draft, ...moved };
    // Dropping the rule drops the exceptions that belonged to it.
    if (!after.rrule) after.exdates = [];
    return [{ id: event.id, before: event, after }];
  }

  if (scope === "this") {
    const standalone: CalendarEvent = {
      ...draft,
      rrule: null,
      id: newEventId(),
      exdates: [],
      createdBy: event.createdBy,
    };
    return [
      { id: event.id, before: event, after: { ...event, exdates: [...event.exdates, occurrence.slot] } },
      { id: standalone.id, before: null, after: standalone },
    ];
  }

  const ruleUnchanged = draft.rrule === event.rrule;
  const successor: CalendarEvent = {
    ...draft,
    rrule: ruleUnchanged && event.rrule ? successorRule(firstSlot, event.rrule, occurrence.slot) : draft.rrule,
    id: newEventId(),
    exdates: event.exdates.filter((day) => day > occurrence.slot),
    createdBy: event.createdBy,
  };
  return [
    {
      id: event.id,
      before: event,
      after: {
        ...event,
        rrule: endRuleBefore(event.rrule, occurrence.slot),
        exdates: event.exdates.filter((day) => day < occurrence.slot),
      },
    },
    { id: successor.id, before: null, after: successor },
  ];
}

export function deleteChanges(events: readonly CalendarEvent[], occurrence: Occurrence, scope: Scope): Change[] {
  const event = events.find((row) => row.id === occurrence.event.id);
  if (!event) return [];
  const firstSlot = datePart(event.start);
  if (!event.rrule || scope === "series" || (scope === "following" && occurrence.slot === firstSlot)) {
    return [{ id: event.id, before: event, after: null }];
  }
  if (scope === "this") {
    return [{ id: event.id, before: event, after: { ...event, exdates: [...event.exdates, occurrence.slot] } }];
  }
  return [
    {
      id: event.id,
      before: event,
      after: {
        ...event,
        rrule: endRuleBefore(event.rrule, occurrence.slot),
        exdates: event.exdates.filter((day) => day < occurrence.slot),
      },
    },
  ];
}

/** Move a single (non-series) occurrence to another day, keeping its times. */
export function moveChanges(events: readonly CalendarEvent[], occurrence: Occurrence, toDay: DateKey): Change[] {
  const event = events.find((row) => row.id === occurrence.event.id);
  if (!event || event.rrule) return [];
  const shift = daysBetween(datePart(event.start), toDay);
  if (!shift) return [];
  const move = (value: string) => {
    const date = addDays(datePart(value), shift);
    const time = timePart(value);
    return time ? `${date}T${time}` : date;
  };
  return [{ id: event.id, before: event, after: { ...event, start: move(event.start), end: move(event.end) } }];
}

export function useCalendarEvents(today: DateKey) {
  const [stored, setStored] = usePersistentState<CalendarEvent[]>(PLANNER_KEYS.calendar, () => seedEvents(today));
  const events = useMemo(() => sanitizeEvents(stored), [stored]);
  const commit = useCallback(
    (changes: readonly Change[]) => setStored((current) => applyChanges(sanitizeEvents(current), changes)),
    [setStored],
  );
  const revert = useCallback(
    (changes: readonly Change[]) => setStored((current) => revertChanges(sanitizeEvents(current), changes)),
    [setStored],
  );
  return { events, commit, revert };
}

// --- preferences ----------------------------------------------------------------

export type CalendarView = "month" | "week" | "day" | "agenda";

export interface CalendarPrefs {
  view: CalendarView;
  layers: { tasks: boolean; schedule: boolean; holidays: boolean; birthdays: boolean };
  /** Yuvomi's "Show shifts as time blocks": compact chips by default. */
  scheduleDisplay: "compact" | "blocks";
  /** 0 = Sunday, 1 = Monday. */
  weekStart: number;
  assignedToMe: boolean;
  /** Selected people; empty means everyone, never no one. */
  people: string[];
}

export const DEFAULT_PREFS: CalendarPrefs = {
  view: "month",
  layers: { tasks: true, schedule: true, holidays: true, birthdays: true },
  scheduleDisplay: "compact",
  weekStart: 1,
  assignedToMe: false,
  people: [],
};

const VIEWS: readonly CalendarView[] = ["month", "week", "day", "agenda"];

export function sanitizePrefs(value: unknown): CalendarPrefs {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<CalendarPrefs>;
  const layers = (raw.layers && typeof raw.layers === "object" ? raw.layers : {}) as Partial<CalendarPrefs["layers"]>;
  const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  return {
    view: VIEWS.includes(raw.view as CalendarView) ? (raw.view as CalendarView) : DEFAULT_PREFS.view,
    layers: {
      tasks: flag(layers.tasks, true),
      schedule: flag(layers.schedule, true),
      holidays: flag(layers.holidays, true),
      birthdays: flag(layers.birthdays, true),
    },
    scheduleDisplay: raw.scheduleDisplay === "blocks" ? "blocks" : "compact",
    weekStart: raw.weekStart === 0 ? 0 : 1,
    assignedToMe: flag(raw.assignedToMe, false),
    people: Array.isArray(raw.people) ? raw.people.filter((id) => typeof id === "string") : [],
  };
}

export function useCalendarPrefs() {
  const [stored, setStored] = usePersistentState<CalendarPrefs>(`${PLANNER_KEYS.calendar}.prefs`, DEFAULT_PREFS);
  const prefs = useMemo(() => sanitizePrefs(stored), [stored]);
  const update = useCallback(
    (patch: Partial<CalendarPrefs> | ((current: CalendarPrefs) => Partial<CalendarPrefs>)) =>
      setStored((current) => {
        const clean = sanitizePrefs(current);
        return { ...clean, ...(typeof patch === "function" ? patch(clean) : patch) };
      }),
    [setStored],
  );
  return [prefs, update] as const;
}

/** How many filters currently take something away — the number on the button. */
export function activeFilterCount(prefs: CalendarPrefs): number {
  let count = 0;
  if (prefs.assignedToMe) count++;
  if (prefs.people.length) count++;
  for (const on of Object.values(prefs.layers)) if (!on) count++;
  return count;
}

export const UNASSIGNED = "__unassigned";

/** Person filters. Empty selection means everyone; unassigned is its own entry. */
export function passesPeople(attendeeIds: readonly string[], prefs: CalendarPrefs, me = "me"): boolean {
  if (prefs.assignedToMe && !attendeeIds.includes(me)) return false;
  if (!prefs.people.length) return true;
  if (!attendeeIds.length) return prefs.people.includes(UNASSIGNED);
  return attendeeIds.some((id) => prefs.people.includes(id));
}
