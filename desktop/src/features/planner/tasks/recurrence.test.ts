import { describe, expect, it } from "vitest";

import {
  buildRule,
  describeRule,
  nextDueAfterCompletion,
  nextOccurrence,
  nextOccurrenceAfter,
  parseRule,
} from "./recurrence";

describe("parseRule / buildRule", () => {
  it("round-trips the rules the form writes", () => {
    const rule = "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;UNTIL=20261231";
    const parsed = parseRule(rule)!;
    expect(parsed).toMatchObject({ freq: "WEEKLY", interval: 2, byday: [1, 4], until: "2026-12-31" });
    expect(buildRule(parsed)).toBe(rule);
  });

  it("accepts the RRULE: prefix and rejects unknown frequencies", () => {
    expect(parseRule("RRULE:FREQ=DAILY")?.freq).toBe("DAILY");
    expect(parseRule("FREQ=HOURLY")).toBeNull();
    expect(parseRule(null)).toBeNull();
  });

  it("describes a rule in words", () => {
    expect(describeRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH")).toBe("Every 2 weeks (Mon, Thu)");
    expect(describeRule("FREQ=MONTHLY;BYMONTHDAY=-1", true)).toBe(
      "Monthly (last day of the month) · from completion",
    );
  });
});

describe("nextOccurrence", () => {
  it("steps daily, weekly and yearly", () => {
    expect(nextOccurrence("2026-10-06", "FREQ=DAILY;INTERVAL=3")).toBe("2026-10-09");
    expect(nextOccurrence("2026-10-06", "FREQ=WEEKLY")).toBe("2026-10-13");
    expect(nextOccurrence("2028-02-29", "FREQ=YEARLY")).toBe("2029-02-28");
  });

  it("finds the next listed weekday, skipping weeks by the interval", () => {
    // 2026-10-06 is a Tuesday.
    expect(nextOccurrence("2026-10-06", "FREQ=WEEKLY;BYDAY=MO,TH")).toBe("2026-10-08");
    expect(nextOccurrence("2026-10-08", "FREQ=WEEKLY;BYDAY=MO,TH")).toBe("2026-10-12");
    expect(nextOccurrence("2026-10-08", "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH")).toBe("2026-10-19");
    // Sunday ends the ISO week.
    expect(nextOccurrence("2026-10-10", "FREQ=WEEKLY;BYDAY=SU")).toBe("2026-10-11");
  });

  it("clamps a 31st to short months instead of rolling over", () => {
    expect(nextOccurrence("2026-01-31", "FREQ=MONTHLY")).toBe("2026-02-28");
    expect(nextOccurrence("2026-01-15", "FREQ=MONTHLY;BYMONTHDAY=-1")).toBe("2026-01-31");
    expect(nextOccurrence("2026-01-31", "FREQ=MONTHLY;BYMONTHDAY=-1")).toBe("2026-02-28");
  });

  it("ends at UNTIL", () => {
    expect(nextOccurrence("2026-10-06", "FREQ=WEEKLY;UNTIL=20261010")).toBeNull();
  });
});

describe("catching up and completion anchors", () => {
  it("catches an overdue series up to the first occurrence on or after today", () => {
    expect(nextOccurrenceAfter("2026-01-05", "FREQ=WEEKLY", "2026-10-06")).toBe("2026-10-12");
    expect(nextOccurrenceAfter("2020-01-01", "FREQ=DAILY", "2026-10-06")).toBe("2026-10-06");
  });

  it("keeps the due-date grid by default", () => {
    // Weekly, due Saturday Oct 3, ticked off Monday Oct 5 → Saturday Oct 10.
    expect(
      nextDueAfterCompletion({ anchorDate: "2026-10-03", rule: "FREQ=WEEKLY", completedOn: "2026-10-05" }),
    ).toBe("2026-10-10");
  });

  it("counts from the completion day when asked to", () => {
    expect(
      nextDueAfterCompletion({
        anchorDate: "2026-10-03",
        rule: "FREQ=WEEKLY",
        completedOn: "2026-10-05",
        fromCompletion: true,
      }),
    ).toBe("2026-10-12");
  });

  it("advances from the due date when ticked off early", () => {
    expect(
      nextDueAfterCompletion({ anchorDate: "2026-10-09", rule: "FREQ=WEEKLY", completedOn: "2026-10-06" }),
    ).toBe("2026-10-16");
  });
});
