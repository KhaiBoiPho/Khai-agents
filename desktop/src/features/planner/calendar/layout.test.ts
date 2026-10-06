import { describe, expect, it } from "vitest";

import {
  assignColumns,
  bandSegments,
  expandEvents,
  fitMonthRow,
  isAllDayLike,
  isBand,
  lastDay,
  multiDayPosition,
  segmentKind,
  timeRange,
} from "./layout";
import type { CalendarEvent, Occurrence } from "./model";
import { occurrenceTimeText, positionText } from "./text";
import { dayRange } from "./dates";

function event(partial: Partial<CalendarEvent> & Pick<CalendarEvent, "id" | "start" | "end">): CalendarEvent {
  return {
    title: partial.id,
    description: "",
    location: "",
    allDay: false,
    color: null,
    icon: null,
    attendeeIds: [],
    rrule: null,
    exdates: [],
    reminders: [],
    visibility: "all",
    countdown: false,
    createdBy: "me",
    ...partial,
  };
}

function occ(partial: Partial<CalendarEvent> & Pick<CalendarEvent, "id" | "start" | "end">): Occurrence {
  const ev = event(partial);
  return expandEvents([ev], ev.start.slice(0, 10), ev.end.slice(0, 10))[0]!;
}

describe("which days an event occupies", () => {
  it("does not spill a timed event ending at midnight into the next day (#804)", () => {
    const o = occ({ id: "late", start: "2026-10-09T21:00", end: "2026-10-10T00:00" });
    expect(lastDay(o)).toBe("2026-10-09");
    expect(isBand(o)).toBe(false);
    // ...but the block still runs a full three hours, to the end of the day (#1607).
    expect(timeRange(o, "2026-10-09")).toEqual({ start: 1260, end: 1440 });
  });

  it("keeps an inclusive all-day end", () => {
    const o = occ({ id: "trip", allDay: true, start: "2026-10-13", end: "2026-10-15" });
    expect(lastDay(o)).toBe("2026-10-15");
    expect(isBand(o)).toBe(true);
    expect(multiDayPosition(o, "2026-10-14")).toEqual({ day: 2, count: 3 });
    expect(positionText(o, "2026-10-15")).toBe("Day 3 of 3");
  });

  it("draws a short night event in both columns, not as a band (#1313)", () => {
    const o = occ({ id: "night", start: "2026-10-09T22:00", end: "2026-10-10T01:30" });
    expect(isAllDayLike(o)).toBe(false);
    expect(timeRange(o, "2026-10-09")).toEqual({ start: 1320, end: 1440 });
    expect(timeRange(o, "2026-10-10")).toEqual({ start: 0, end: 90 });
    expect(segmentKind(o, "2026-10-09")).toBe("start");
    expect(segmentKind(o, "2026-10-10")).toBe("end");
    expect(occurrenceTimeText(o, "2026-10-10")).toMatch(/^until /);
  });

  it("makes a 24-hour-plus timed event a band", () => {
    const o = occ({ id: "long", start: "2026-10-09T14:00", end: "2026-10-11T11:00" });
    expect(isAllDayLike(o)).toBe(true);
    expect(isBand(o)).toBe(true);
  });

  it("shows a multi-day occurrence that began before the window", () => {
    const ev = event({ id: "weekly-trip", allDay: true, start: "2026-09-28", end: "2026-10-02", rrule: "FREQ=WEEKLY" });
    const found = expandEvents([ev], "2026-10-01", "2026-10-03").map((o) => o.slot);
    expect(found).toEqual(["2026-09-28"]);
  });

  it("shifts every occurrence of a series by its slot", () => {
    const ev = event({ id: "standup", start: "2026-10-05T09:00", end: "2026-10-05T09:15", rrule: "FREQ=DAILY", exdates: ["2026-10-06"] });
    const list = expandEvents([ev], "2026-10-05", "2026-10-07");
    expect(list.map((o) => [o.key, o.start, o.end])).toEqual([
      ["standup@2026-10-05", "2026-10-05T09:00", "2026-10-05T09:15"],
      ["standup@2026-10-07", "2026-10-07T09:00", "2026-10-07T09:15"],
    ]);
    expect(list.every((o) => o.recurring)).toBe(true);
  });
});

describe("overlap columns", () => {
  it("splits overlapping blocks and lets touching ones share a column", () => {
    const a = { id: "a", r: { start: 540, end: 600 } };
    const b = { id: "b", r: { start: 570, end: 630 } };
    const c = { id: "c", r: { start: 600, end: 660 } };
    const d = { id: "d", r: { start: 720, end: 780 } };
    const layout = assignColumns([a, b, c, d], (x) => x.r);
    expect(layout.get(a)).toEqual({ column: 0, columns: 2 });
    expect(layout.get(b)).toEqual({ column: 1, columns: 2 });
    // c starts exactly when a ends: half-open, so it reuses a's column.
    expect(layout.get(c)).toEqual({ column: 0, columns: 2 });
    expect(layout.get(d)).toEqual({ column: 0, columns: 1 });
  });
});

describe("bands across a week row", () => {
  const week = dayRange("2026-10-05", "2026-10-11");

  it("clamps to the row and marks the open ends", () => {
    const fromBefore = occ({ id: "x", allDay: true, start: "2026-10-03", end: "2026-10-06" });
    const intoNext = occ({ id: "y", allDay: true, start: "2026-10-10", end: "2026-10-13" });
    const row = bandSegments(week, [fromBefore, intoNext]);
    expect(row.bands.map((b) => [b.occurrence.event.id, b.first, b.last, b.lane, b.continuesBefore, b.continuesAfter])).toEqual([
      ["x", 0, 1, 0, true, false],
      ["y", 5, 6, 0, false, true],
    ]);
    expect(row.laneCount).toBe(1);
  });

  it("stacks overlapping bands into lanes, longer first", () => {
    const short = occ({ id: "short", allDay: true, start: "2026-10-06", end: "2026-10-07" });
    const long = occ({ id: "long", allDay: true, start: "2026-10-06", end: "2026-10-09" });
    const later = occ({ id: "later", allDay: true, start: "2026-10-08", end: "2026-10-09" });
    const single = occ({ id: "single", allDay: true, start: "2026-10-06", end: "2026-10-06" });
    const row = bandSegments(week, [short, long, later, single]);
    const lanes = Object.fromEntries(row.bands.map((b) => [b.occurrence.event.id, b.lane]));
    expect(lanes).toEqual({ long: 0, short: 1, later: 1 });
    expect(row.depth).toEqual([0, 2, 2, 2, 2, 0, 0]);
    expect(row.keys.has(single.key)).toBe(false);
  });
});

describe("month overflow", () => {
  it("shows everything when it fits", () => {
    const fit = fitMonthRow([{ chips: 2, bandLanes: [0], depth: 1 }, { chips: 0, bandLanes: [], depth: 0 }], 1, 4);
    expect(fit).toEqual({ lanesShown: 1, cells: [{ visibleChips: 2, more: 0 }, { visibleChips: 0, more: 0 }] });
  });

  it("keeps a line for +N and counts what it hides", () => {
    const fit = fitMonthRow([{ chips: 6, bandLanes: [], depth: 0 }], 0, 4);
    expect(fit.cells[0]).toEqual({ visibleChips: 3, more: 3 });
  });

  it("shrinks band lanes for the whole row and counts hidden bands", () => {
    const fit = fitMonthRow(
      [
        { chips: 0, bandLanes: [0, 1, 2], depth: 3 },
        { chips: 1, bandLanes: [0, 1, 2], depth: 3 },
      ],
      3,
      3,
    );
    expect(fit.lanesShown).toBe(2);
    expect(fit.cells[0]).toEqual({ visibleChips: 0, more: 1 });
    expect(fit.cells[1]).toEqual({ visibleChips: 0, more: 2 });
  });

  it("never leaves a cell with chips looking empty", () => {
    const fit = fitMonthRow([{ chips: 5, bandLanes: [], depth: 0 }], 0, 1);
    expect(fit.cells[0]).toEqual({ visibleChips: 1, more: 4 });
  });
});
