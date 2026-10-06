import { describe, expect, it } from "vitest";

import {
  buildRRule,
  describeRRule,
  endRuleBefore,
  expandSeries,
  nextOccurrence,
  occurrenceIndex,
  parseRRule,
  recurrenceFromRule,
  ruleEndsBeforeStart,
  ruleFromRecurrence,
  successorRule,
} from "./recurrence";

describe("parse and build", () => {
  it("round-trips the supported subset", () => {
    const rule = "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231T235959Z";
    expect(parseRRule(rule)).toEqual({
      freq: "WEEKLY",
      interval: 2,
      byday: ["MO", "WE"],
      until: "2026-12-31",
      count: null,
      lastDay: false,
    });
    expect(buildRRule(parseRRule(rule))).toBe(rule);
    expect(parseRRule("RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3")).toMatchObject({ freq: "MONTHLY", lastDay: true, count: 3 });
    expect(buildRRule(parseRRule(""))).toBeNull();
  });

  it("keeps BYMONTHDAY only under MONTHLY and BYDAY only under WEEKLY", () => {
    expect(buildRRule({ freq: "DAILY", interval: 1, byday: ["MO"], until: "", count: null, lastDay: true })).toBe("FREQ=DAILY");
  });

  it("describes a rule for the detail view", () => {
    expect(describeRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE")).toBe("Every 2 weeks (Mo, We)");
    expect(describeRRule("FREQ=DAILY;COUNT=1")).toBe("Daily · 1 occurrence");
    expect(describeRRule("FREQ=MONTHLY;BYMONTHDAY=-1")).toBe("Monthly (on the last day of the month)");
    expect(describeRRule(null)).toBe("");
  });

  it("maps to and from the editor's state", () => {
    const state = recurrenceFromRule("FREQ=WEEKLY;BYDAY=TU;COUNT=4");
    expect(state).toMatchObject({ freq: "WEEKLY", endMode: "count", count: 4, byday: ["TU"] });
    expect(ruleFromRecurrence({ ...state, endMode: "never" })).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(ruleFromRecurrence({ ...state, freq: "" })).toBeNull();
  });
});

describe("expansion", () => {
  it("steps daily with an interval", () => {
    expect(expandSeries("2026-10-01", "FREQ=DAILY;INTERVAL=3", "2026-10-01", "2026-10-12")).toEqual([
      "2026-10-01",
      "2026-10-04",
      "2026-10-07",
      "2026-10-10",
    ]);
  });

  it("expands weekly on chosen days, every other week", () => {
    // 2026-10-05 is a Monday.
    expect(expandSeries("2026-10-05", "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH", "2026-10-01", "2026-10-31")).toEqual([
      "2026-10-05",
      "2026-10-08",
      "2026-10-19",
      "2026-10-22",
    ]);
  });

  it("uses the start's weekday when no days are given", () => {
    expect(expandSeries("2026-10-07", "FREQ=WEEKLY", "2026-10-01", "2026-10-25")).toEqual([
      "2026-10-07",
      "2026-10-14",
      "2026-10-21",
    ]);
  });

  it("never starts before the series start even when the week does", () => {
    expect(expandSeries("2026-10-07", "FREQ=WEEKLY;BYDAY=MO,FR", "2026-10-01", "2026-10-13")).toEqual([
      "2026-10-09",
      "2026-10-12",
    ]);
  });

  it("clamps the 31st into short months instead of skipping them", () => {
    expect(expandSeries("2026-01-31", "FREQ=MONTHLY", "2026-01-01", "2026-05-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
  });

  it("follows the last day of the month", () => {
    expect(expandSeries("2026-01-15", "FREQ=MONTHLY;BYMONTHDAY=-1", "2026-01-01", "2026-03-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("puts a 29 February yearly series on the 28th in common years", () => {
    expect(expandSeries("2028-02-29", "FREQ=YEARLY", "2028-01-01", "2032-12-31")).toEqual([
      "2028-02-29",
      "2029-02-28",
      "2030-02-28",
      "2031-02-28",
      "2032-02-29",
    ]);
  });

  it("ends inclusively at UNTIL", () => {
    expect(expandSeries("2026-10-01", "FREQ=DAILY;UNTIL=20261003T235959Z", "2026-09-01", "2026-12-31")).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });

  it("counts excluded occurrences towards COUNT", () => {
    expect(expandSeries("2026-10-01", "FREQ=DAILY;COUNT=4", "2026-10-01", "2026-10-31", ["2026-10-02"])).toEqual([
      "2026-10-01",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("windows a long-running series without losing COUNT", () => {
    expect(expandSeries("2026-01-01", "FREQ=WEEKLY;COUNT=10", "2026-03-01", "2026-03-31")).toEqual([
      "2026-03-05",
    ]);
  });

  it("treats a missing rule as a single event", () => {
    expect(expandSeries("2026-10-01", null, "2026-10-01", "2026-10-31")).toEqual(["2026-10-01"]);
    expect(expandSeries("2026-10-01", null, "2026-10-02", "2026-10-31")).toEqual([]);
  });

  it("finds the next occurrence and the slot index", () => {
    expect(nextOccurrence("2026-01-31", "FREQ=MONTHLY", "2026-02-01")).toBe("2026-02-28");
    expect(nextOccurrence("2026-10-01", "FREQ=DAILY;COUNT=2", "2026-10-05")).toBeNull();
    expect(occurrenceIndex("2026-10-05", "FREQ=WEEKLY;BYDAY=MO,TH", "2026-10-19")).toBe(4);
  });
});

describe("splitting a series", () => {
  it("ends the old part the day before", () => {
    expect(endRuleBefore("FREQ=WEEKLY;COUNT=10", "2026-10-15")).toBe("FREQ=WEEKLY;UNTIL=20261014T235959Z");
  });

  it("hands the successor only the occurrences that were left", () => {
    // Slots: 1, 8, 15 (index 2), 22, 29 October.
    expect(successorRule("2026-10-01", "FREQ=WEEKLY;COUNT=5", "2026-10-15")).toBe("FREQ=WEEKLY;COUNT=3");
    expect(successorRule("2026-10-01", "FREQ=WEEKLY", "2026-10-15")).toBe("FREQ=WEEKLY");
  });

  it("flags an end before the start", () => {
    expect(ruleEndsBeforeStart("FREQ=DAILY;UNTIL=20260930T235959Z", "2026-10-01")).toBe(true);
    expect(ruleEndsBeforeStart("FREQ=DAILY;UNTIL=20261001T235959Z", "2026-10-01")).toBe(false);
  });
});
