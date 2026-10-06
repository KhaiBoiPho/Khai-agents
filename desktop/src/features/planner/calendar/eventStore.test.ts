import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  applyChanges,
  createChanges,
  DEFAULT_PREFS,
  deleteChanges,
  moveChanges,
  passesPeople,
  revertChanges,
  sanitizePrefs,
  UNASSIGNED,
  updateChanges,
  type EventDraft,
} from "./eventStore";
import { expandEvents } from "./layout";
import { sanitizeEvents, seedEvents, type CalendarEvent } from "./model";

const series: CalendarEvent = {
  id: "standup",
  title: "Standup",
  description: "",
  location: "",
  allDay: false,
  start: "2026-10-05T09:00",
  end: "2026-10-05T09:15",
  color: null,
  icon: null,
  attendeeIds: ["me"],
  rrule: "FREQ=DAILY;COUNT=10",
  exdates: [],
  reminders: [],
  visibility: "all",
  countdown: false,
  createdBy: "me",
};

const single: CalendarEvent = { ...series, id: "demo", title: "Demo", rrule: null, start: "2026-10-08T14:00", end: "2026-10-08T15:00" };
const events = [series, single];

function occurrenceOn(list: CalendarEvent[], id: string, day: string) {
  return expandEvents(list, day, day).find((o) => o.event.id === id && o.slot === day)!;
}

function draftFrom(event: CalendarEvent, patch: Partial<EventDraft>): EventDraft {
  const { id: _id, exdates: _ex, createdBy: _by, ...rest } = event;
  void _id;
  void _ex;
  void _by;
  return { ...rest, ...patch };
}

const slots = (list: CalendarEvent[], from = "2026-10-01", to = "2026-10-31") =>
  expandEvents(list, from, to).map((o) => `${o.event.title}@${o.start}`);

describe("editing a series", () => {
  const occurrence = occurrenceOn(events, "standup", "2026-10-08");

  it("only this: excludes the slot and adds a standalone event", () => {
    const changes = updateChanges(events, occurrence, draftFrom(series, { title: "Standup (moved)", start: "2026-10-08T10:00", end: "2026-10-08T10:15" }), "this");
    const next = applyChanges(events, changes);
    expect(next.find((e) => e.id === "standup")!.exdates).toEqual(["2026-10-08"]);
    const list = slots(next, "2026-10-07", "2026-10-09");
    expect(list).toContain("Standup (moved)@2026-10-08T10:00");
    expect(list).not.toContain("Standup@2026-10-08T09:00");
    expect(list.filter((s) => s.startsWith("Standup@"))).toHaveLength(2);
  });

  it("this and following: ends the series and starts a successor with the remaining count", () => {
    const changes = updateChanges(
      events,
      occurrence,
      draftFrom(series, { title: "Daily sync", start: "2026-10-08T09:00", end: "2026-10-08T09:15" }),
      "following",
    );
    const next = applyChanges(events, changes);
    const list = slots(next);
    expect(list.filter((s) => s.startsWith("Standup@"))).toEqual([
      "Standup@2026-10-05T09:00",
      "Standup@2026-10-06T09:00",
      "Standup@2026-10-07T09:00",
    ]);
    // Ten in total before and after the split.
    const successor = list.filter((s) => s.startsWith("Daily sync@"));
    expect(successor).toHaveLength(7);
    expect(successor[0]).toBe("Daily sync@2026-10-08T09:00");
  });

  it("whole series from a later occurrence shifts the series, not drags its start", () => {
    const changes = updateChanges(events, occurrence, draftFrom(series, { start: "2026-10-09T09:30", end: "2026-10-09T10:00" }), "series");
    const updated = applyChanges(events, changes).find((e) => e.id === "standup")!;
    expect(updated.start).toBe("2026-10-06T09:30");
    expect(updated.end).toBe("2026-10-06T10:00");
  });

  it("edits a single event in place", () => {
    const o = occurrenceOn(events, "demo", "2026-10-08");
    const [change] = updateChanges(events, o, draftFrom(single, { title: "Demo day" }), "series");
    expect(change!.after!.title).toBe("Demo day");
    expect(change!.after!.id).toBe("demo");
  });
});

describe("deleting", () => {
  const occurrence = occurrenceOn(events, "standup", "2026-10-08");

  it("only this adds an EXDATE", () => {
    const next = applyChanges(events, deleteChanges(events, occurrence, "this"));
    expect(slots(next).filter((s) => s.startsWith("Standup"))).toHaveLength(9);
  });

  it("this and following truncates", () => {
    const next = applyChanges(events, deleteChanges(events, occurrence, "following"));
    expect(slots(next).filter((s) => s.startsWith("Standup"))).toHaveLength(3);
  });

  it("this and following from the first slot removes the series", () => {
    const first = occurrenceOn(events, "standup", "2026-10-05");
    const next = applyChanges(events, deleteChanges(events, first, "following"));
    expect(next.map((e) => e.id)).toEqual(["demo"]);
  });

  it("undo restores exactly what was removed, keeping later edits", () => {
    const changes = deleteChanges(events, occurrence, "series");
    const afterDelete = applyChanges(events, changes);
    const created = createChanges(draftFrom(single, { title: "New" }), "new-1");
    const afterCreate = applyChanges(afterDelete, created);
    const undone = revertChanges(afterCreate, changes);
    expect(undone.map((e) => e.id).sort()).toEqual(["demo", "new-1", "standup"]);
    expect(undone.find((e) => e.id === "standup")).toEqual(series);
  });
});

describe("moving", () => {
  it("moves a single event by whole days and ignores series", () => {
    const o = occurrenceOn(events, "demo", "2026-10-08");
    const [change] = moveChanges(events, o, "2026-10-12");
    expect(change!.after).toMatchObject({ start: "2026-10-12T14:00", end: "2026-10-12T15:00" });
    expect(moveChanges(events, occurrenceOn(events, "standup", "2026-10-08"), "2026-10-12")).toEqual([]);
  });
});

describe("filters and stored shapes", () => {
  it("reads an empty person selection as everyone", () => {
    expect(passesPeople([], DEFAULT_PREFS)).toBe(true);
    const prefs = { ...DEFAULT_PREFS, people: ["linh"] };
    expect(passesPeople(["linh", "me"], prefs)).toBe(true);
    expect(passesPeople(["me"], prefs)).toBe(false);
    expect(passesPeople([], prefs)).toBe(false);
    expect(passesPeople([], { ...prefs, people: [UNASSIGNED] })).toBe(true);
    expect(passesPeople(["linh"], { ...DEFAULT_PREFS, assignedToMe: true })).toBe(false);
  });

  it("counts only filters that remove something", () => {
    expect(activeFilterCount(DEFAULT_PREFS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_PREFS, scheduleDisplay: "blocks", weekStart: 0 })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_PREFS, people: ["me"], layers: { ...DEFAULT_PREFS.layers, tasks: false } })).toBe(2);
  });

  it("repairs stale stored data instead of failing", () => {
    expect(sanitizePrefs({ view: "year", weekStart: 3, layers: { tasks: "no" } })).toEqual(DEFAULT_PREFS);
    const cleaned = sanitizeEvents([{ id: 1 }, { id: "x", title: "X", start: "bad" }, { id: "ok", title: "OK", start: "2026-10-01" }]);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0]).toMatchObject({ id: "ok", end: "2026-10-01", exdates: [], visibility: "all" });
    expect(sanitizeEvents(seedEvents("2026-10-06"))).toHaveLength(seedEvents("2026-10-06").length);
  });
});
