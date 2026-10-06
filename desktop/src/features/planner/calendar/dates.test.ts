import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  addDays,
  addMinutes,
  addMonthsClamped,
  dayRange,
  daysBetween,
  isDateKey,
  isoWeek,
  localKey,
  minutesBetween,
  monthGridSpan,
  startOfWeek,
  weekdayOf,
} from "./dates";
import { expandEvents, timeRange } from "./layout";
import { seedEvents } from "./model";

// Day keys must not care about the device's zone or its DST switches.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Berlin";
});
afterAll(() => {
  process.env.TZ = originalTz;
});

describe("day-key arithmetic", () => {
  it("steps across month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-12-25", "2027-01-05")).toBe(11);
  });

  it("is unaffected by daylight-saving changes", () => {
    // Europe springs forward on 29 March and falls back on 25 October 2026.
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-25", "2026-10-26")).toBe(1);
    expect(dayRange("2026-03-27", "2026-03-31")).toHaveLength(5);
    process.env.TZ = "America/New_York";
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    process.env.TZ = "Europe/Berlin";
  });

  it("reads the local calendar day of an instant", () => {
    expect(localKey(new Date(2026, 2, 29, 0, 30))).toBe("2026-03-29");
    expect(localKey(new Date(2026, 9, 25, 23, 59))).toBe("2026-10-25");
  });

  it("clamps month steps to the last day", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonthsClamped("2026-01-10", -1)).toBe("2025-12-10");
  });

  it("validates keys", () => {
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2026-13-01")).toBe(false);
  });

  it("finds week starts and ISO weeks", () => {
    expect(weekdayOf("2026-10-06")).toBe(2);
    expect(startOfWeek("2026-10-06", 1)).toBe("2026-10-05");
    expect(startOfWeek("2026-10-06", 0)).toBe("2026-10-04");
    expect(isoWeek("2026-01-01")).toBe(1);
    expect(isoWeek("2027-01-01")).toBe(53);
    expect(isoWeek("2026-10-06")).toBe(41);
  });

  it("sizes the month grid to the weeks the month needs", () => {
    // September 2026 with Monday weeks fits in five rows, not six.
    expect(monthGridSpan("2026-09-15", 1)).toEqual({ from: "2026-08-31", to: "2026-10-04", weeks: 5 });
    // February 2026 starts on a Sunday: a perfect four weeks with Sunday starts.
    expect(monthGridSpan("2026-02-10", 0)).toEqual({ from: "2026-02-01", to: "2026-02-28", weeks: 4 });
    expect(monthGridSpan("2026-08-01", 1).weeks).toBe(6);
  });

  it("carries minutes past midnight onto the date", () => {
    expect(addMinutes("2026-03-28", "23:30", 90)).toEqual({ date: "2026-03-29", time: "01:00" });
    expect(addMinutes("2026-12-31", "22:00", 180)).toEqual({ date: "2027-01-01", time: "01:00" });
    expect(minutesBetween("2026-03-28T22:00", "2026-03-29T01:30")).toBe(210);
  });

  it("keeps a series at its wall-clock time across a DST change", () => {
    const [event] = seedEvents("2026-03-27").filter((e) => e.id === "seed-backup");
    const occurrences = expandEvents([{ ...event!, start: "2026-03-27T02:30", end: "2026-03-27T03:00" }], "2026-03-28", "2026-03-30");
    expect(occurrences.map((o) => o.start)).toEqual(["2026-03-28T02:30", "2026-03-29T02:30", "2026-03-30T02:30"]);
    expect(timeRange(occurrences[1]!, "2026-03-29")).toEqual({ start: 150, end: 180 });
  });
});
