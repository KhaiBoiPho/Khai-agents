import { describe, expect, it } from "vitest";

import { addDays, dateKeysInRange, daysBetween, monthBounds } from "./dates";
import type { Override, Pattern, ScheduleEntry, ScheduleState, ShiftType } from "./model";
import {
  buildLanes,
  clockLabel,
  collapsedMinutes,
  computeActiveHours,
  cycleDayNextDate,
  cyclePosition,
  groupConsecutive,
  overtimeInfo,
  patternDaysExceedingCycleLength,
  rangeDifference,
  resolveEntries,
  resolveWinningPatternId,
  scheduleData,
  shiftMinutes,
  statisticsSummary,
  windowsOverlap,
} from "./occurrences";
import {
  deleteShiftType,
  fillOverrides,
  normalizeState,
  ScheduleError,
  upsertPattern,
} from "./scheduleStore";
import { buildSeed } from "./seed";

const T = (id: string, start: string | null = null, end: string | null = null): ShiftType => ({
  id,
  name: id.toUpperCase(),
  shortCode: id.slice(0, 2).toUpperCase(),
  start,
  end,
  color: "teal",
});

const EARLY = T("early", "06:00", "14:00");
const LATE = T("late", "14:00", "22:00");
const NIGHT = T("night", "22:00", "06:00");
const MATH = T("math", "08:00", "08:45");
const ART = T("art", "09:00", "10:30");
const TYPES = new Map([EARLY, LATE, NIGHT, MATH, ART].map((type) => [type.id, type]));

function pattern(partial: Partial<Pattern> & Pick<Pattern, "id" | "anchorDate" | "cycleLength">): Pattern {
  return {
    memberId: "linh",
    name: partial.id,
    kind: "rotation",
    validFrom: null,
    validUntil: null,
    active: true,
    days: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const rotation = pattern({
  id: "rot",
  anchorDate: "2026-10-05",
  cycleLength: 4,
  days: [
    { id: "d0", position: 0, shiftTypeId: "early" },
    { id: "d1", position: 1, shiftTypeId: "late" },
    { id: "d2", position: 2, shiftTypeId: "night" },
    // position 3 unset: a free day
  ],
});

function codes(entries: ScheduleEntry[]): (string | null)[] {
  return entries.map((entry) => entry.shiftType?.id ?? null);
}

function resolve(patterns: Pattern[], from: string, to: string, overrides: Override[] = []) {
  return resolveEntries({ from, to, memberId: "linh", patterns, overrides, types: TYPES });
}

describe("cyclePosition", () => {
  it("counts from the anchor and wraps", () => {
    expect(cyclePosition("2026-10-05", 4, "2026-10-05")).toBe(0);
    expect(cyclePosition("2026-10-05", 4, "2026-10-08")).toBe(3);
    expect(cyclePosition("2026-10-05", 4, "2026-10-09")).toBe(0);
    expect(cyclePosition("2026-10-05", 4, "2026-10-14")).toBe(1);
  });

  it("wraps backwards before the anchor", () => {
    expect(cyclePosition("2026-10-05", 4, "2026-10-04")).toBe(3);
    expect(cyclePosition("2026-10-05", 4, "2026-10-01")).toBe(0);
    expect(cyclePosition("2026-10-05", 4, "2025-10-05")).toBe(((-365 % 4) + 4) % 4);
  });

  it("rejects invalid input", () => {
    expect(cyclePosition("2026-10-05", 0, "2026-10-06")).toBeNull();
    expect(cyclePosition("2026-02-30", 4, "2026-10-06")).toBeNull();
  });
});

describe("rotation resolution", () => {
  it("emits one entry per day, with an explicit free day for unset positions", () => {
    const { entries, warnings } = resolve([rotation], "2026-10-05", "2026-10-12");
    expect(codes(entries)).toEqual(["early", "late", "night", null, "early", "late", "night", null]);
    expect(entries[3]!.isFree).toBe(true);
    expect(entries[2]!.crossesMidnight).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("follows the same rhythm backwards before the anchor", () => {
    const { entries } = resolve([rotation], "2026-09-29", "2026-10-04");
    // 2026-10-04 is position 3 (free), 10-03 is 2 (night), 09-29 is 2 again.
    expect(codes(entries)).toEqual(["night", null, "early", "late", "night", null]);
  });

  it("stays continuous across month boundaries and a leap day", () => {
    const leap = pattern({ ...rotation, id: "leap", anchorDate: "2028-01-30" });
    const { entries } = resolve([leap], "2028-02-27", "2028-03-02");
    expect(entries.map((entry) => entry.date)).toEqual(["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01", "2028-03-02"]);
    // 2028-01-30 + 28 days = 2028-02-27 → position 0.
    expect(entries.map((entry) => entry.position)).toEqual([0, 1, 2, 3, 0]);
  });

  it("is not shifted by daylight-saving changes", () => {
    const previous = process.env.TZ;
    process.env.TZ = "Europe/Berlin";
    try {
      const spring = resolve([rotation], "2026-03-28", "2026-03-31").entries.map((entry) => entry.position);
      const autumn = resolve([rotation], "2026-10-24", "2026-10-27").entries.map((entry) => entry.position);
      const step = (positions: (number | null)[]) =>
        positions.slice(1).every((position, index) => position === ((positions[index]! + 1) % 4));
      expect(step(spring)).toBe(true);
      expect(step(autumn)).toBe(true);
      expect(daysBetween("2026-03-28", "2026-03-31")).toBe(3);
      expect(dateKeysInRange("2026-10-24", "2026-10-27")).toHaveLength(4);
    } finally {
      process.env.TZ = previous;
    }
  });

  it("lets an override beat the pattern, including an explicit free day", () => {
    const overrides: Override[] = [
      { id: "o1", memberId: "linh", date: "2026-10-05", shiftTypeId: null, note: "Swap" },
      { id: "o2", memberId: "linh", date: "2026-10-08", shiftTypeId: "early", note: "" },
      { id: "o3", memberId: "minh", date: "2026-10-06", shiftTypeId: "night", note: "" },
    ];
    const { entries } = resolve([rotation], "2026-10-05", "2026-10-08", overrides);
    expect(codes(entries)).toEqual([null, "late", "night", "early"]);
    expect(entries[0]!.source).toBe("override");
    expect(entries[0]!.isFree).toBe(true);
    expect(entries[0]!.note).toBe("Swap");
    expect(entries[1]!.source).toBe("pattern");
  });

  it("respects validity bounds and ignores inactive patterns", () => {
    const bounded = pattern({ ...rotation, id: "b", validFrom: "2026-10-06", validUntil: "2026-10-07" });
    expect(resolve([bounded], "2026-10-05", "2026-10-08").entries.map((entry) => entry.date)).toEqual([
      "2026-10-06",
      "2026-10-07",
    ]);
    expect(resolve([{ ...rotation, active: false }], "2026-10-05", "2026-10-08").entries).toEqual([]);
  });

  it("lets the newest validFrom win and warns about the overlap", () => {
    const base = pattern({ ...rotation, id: "base" });
    const newer = pattern({
      id: "newer",
      anchorDate: "2026-10-07",
      cycleLength: 1,
      validFrom: "2026-10-07",
      validUntil: "2026-10-08",
      days: [{ id: "n0", position: 0, shiftTypeId: "late" }],
    });
    const { entries, warnings } = resolve([base, newer], "2026-10-06", "2026-10-09");
    expect(codes(entries)).toEqual(["late", "late", "late", "early"]);
    expect(entries[1]!.patternId).toBe("newer");
    expect(warnings.map((warning) => warning.date)).toEqual(["2026-10-07", "2026-10-08"]);
    expect(warnings[0]!.patternIds).toEqual(["newer", "base"]);
    expect(resolveWinningPatternId([base, newer], "linh", "2026-10-07")).toBe("newer");
    expect(resolveWinningPatternId([base, newer], "linh", "2026-10-06")).toBeNull();
  });
});

describe("weekly timetable expansion", () => {
  const week = pattern({
    id: "school",
    kind: "timetable",
    anchorDate: "2026-10-05", // a Monday
    cycleLength: 7,
    days: [
      { id: "m1", position: 0, shiftTypeId: "math" },
      { id: "m2", position: 0, shiftTypeId: "art" },
      { id: "w1", position: 2, shiftTypeId: "art" },
    ],
  });

  it("maps positions to weekdays and emits every row of a day", () => {
    const { entries } = resolve([week], "2026-10-12", "2026-10-18");
    const monday = entries.filter((entry) => entry.date === "2026-10-12");
    expect(codes(monday)).toEqual(["math", "art"]);
    expect(codes(entries.filter((entry) => entry.date === "2026-10-14"))).toEqual(["art"]);
    // Tuesday, Thursday–Sunday are free.
    expect(entries.filter((entry) => entry.isFree)).toHaveLength(5);
  });

  it("alternates week A and week B on a 14-day cycle", () => {
    const ab = pattern({
      id: "ab",
      kind: "timetable",
      anchorDate: "2026-10-05",
      cycleLength: 14,
      days: [
        { id: "a", position: 0, shiftTypeId: "math" },
        { id: "b", position: 7, shiftTypeId: "art" },
      ],
    });
    const mondays = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-09-28"].map(
      (date) => resolve([ab], date, date).entries[0]!.shiftType?.id,
    );
    expect(mondays).toEqual(["math", "art", "math", "art"]);
  });
});

describe("scheduleData", () => {
  const state: ScheduleState = {
    version: 1,
    types: [...TYPES.values()],
    patterns: [rotation],
    overrides: [],
    extras: [{ id: "x", memberId: "linh", date: "2026-10-06", shiftTypeId: "night", note: "On-call" }],
    settings: { weeklyHours: {}, overtimeEnabled: true },
  };

  it("adds extras on top of the resolved day", () => {
    const { entries } = scheduleData(state, "2026-10-06", "2026-10-06");
    expect(entries.map((entry) => entry.source)).toEqual(["pattern", "extra"]);
  });

  it("caps the window and handles a reversed range", () => {
    const capped = scheduleData(state, "2026-01-01", "2030-01-01").entries.filter((entry) => entry.source === "pattern");
    expect(capped).toHaveLength(731);
    expect(capped[capped.length - 1]!.date).toBe(addDays("2026-01-01", 730));
    expect(scheduleData(state, "2026-10-06", "2026-10-01").entries).toEqual([]);
  });

  it("resolves the seed for every member without throwing", () => {
    const seed = buildSeed("2026-10-06");
    const { entries, warnings } = scheduleData(seed, "2026-10-05", "2026-11-08");
    expect(entries.some((entry) => entry.memberId === "agent" && entry.shiftType?.id === "st-maint")).toBe(true);
    // Minh's release week overlaps the A/B timetable on purpose.
    expect(warnings.some((warning) => warning.memberId === "minh")).toBe(true);
  });
});

describe("durations and statistics", () => {
  it("treats end <= start as crossing midnight and end == start as 24 h", () => {
    expect(shiftMinutes(NIGHT)).toBe(480);
    expect(shiftMinutes(T("full", "10:00", "10:00"))).toBe(1440);
    expect(shiftMinutes(T("off"))).toBeNull();
    expect(clockLabel(NIGHT)).toBe("22:00–06:00 +1");
    expect(clockLabel(T("off"))).toBe("All day");
  });

  it("flags the worst rolling seven-day window", () => {
    const entries = resolve([pattern({ id: "all", anchorDate: "2026-10-01", cycleLength: 1, days: [{ id: "a", position: 0, shiftTypeId: "early" }] })], "2026-10-01", "2026-10-10").entries;
    // 7 × 8 h = 56 h against 40 h.
    expect(overtimeInfo(entries, 40)).toEqual({ over: true, excessMinutes: 16 * 60 });
    expect(overtimeInfo(entries, 60).over).toBe(false);
  });

  it("summarises counts, hours and free days", () => {
    const summary = statisticsSummary(resolve([rotation], "2026-10-05", "2026-10-12").entries);
    expect(summary.totalCount).toBe(6);
    expect(summary.freeDays).toBe(2);
    expect(summary.totalMinutes).toBe(6 * 480);
  });
});

describe("pattern helpers", () => {
  it("finds the next date of a cycle day in both directions", () => {
    expect(cycleDayNextDate("2026-10-05", 4, 1, "2026-10-06")).toBe("2026-10-09");
    expect(cycleDayNextDate("2026-10-05", 4, 2, "2026-10-06")).toBe("2026-10-06");
    expect(cycleDayNextDate("2026-10-20", 4, 1, "2026-10-06")).toBe("2026-10-08");
  });

  it("names the positions a shorter cycle would drop", () => {
    expect(patternDaysExceedingCycleLength([{ position: 1 }, { position: 5 }, { position: 7 }], 5)).toEqual({ from: 6, to: 8 });
    expect(patternDaysExceedingCycleLength([{ position: 1 }], 5)).toBeNull();
  });

  it("compares validity windows with open ends", () => {
    expect(windowsOverlap(null, null, "2026-01-01", "2026-01-02")).toBe(true);
    expect(windowsOverlap("2026-01-03", null, null, "2026-01-02")).toBe(false);
  });
});

describe("override grouping", () => {
  const rows: Override[] = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-09"].map((date, index) => ({
    id: `o${index}`,
    memberId: "linh",
    date,
    shiftTypeId: null,
    note: "Trip",
  }));

  it("merges consecutive days with the same type and note", () => {
    const groups = groupConsecutive(rows);
    expect(groups.map((group) => [group.from, group.to])).toEqual([
      ["2026-10-05", "2026-10-07"],
      ["2026-10-09", "2026-10-09"],
    ]);
  });

  it("computes what falls outside an edited span", () => {
    expect(rangeDifference("2026-10-01", "2026-10-10", "2026-10-03", "2026-10-08")).toEqual([
      { from: "2026-10-01", to: "2026-10-02" },
      { from: "2026-10-09", to: "2026-10-10" },
    ]);
    expect(rangeDifference("2026-10-03", "2026-10-05", "2026-10-01", "2026-10-10")).toEqual([]);
  });
});

describe("week grid lanes", () => {
  it("continues an overnight shift on the next day and drops that day's free marker", () => {
    const { entries } = resolve([rotation], "2026-10-07", "2026-10-08");
    const columns = buildLanes(["2026-10-07", "2026-10-08"], ["linh"], entries);
    const nextDay = columns[1]!.lanes[0]!.entries;
    expect(nextDay).toHaveLength(1);
    expect(nextDay[0]!.continuation).toBe(true);
  });

  it("folds empty hours and places ends on the hour before", () => {
    const hours = computeActiveHours(resolve([rotation], "2026-10-07", "2026-10-07").entries);
    expect(hours).toEqual([0, 1, 2, 3, 4, 5, 22, 23]);
    expect(collapsedMinutes(6 * 60, hours)).toBe(6 * 60);
    expect(collapsedMinutes(22 * 60 + 30, hours)).toBe(6 * 60 + 30);
    expect(collapsedMinutes(12 * 60 + 15, hours)).toBeNull();
  });
});

describe("store rules", () => {
  const seed = buildSeed("2026-10-06");

  it("refuses to shorten a cycle past days that still have shifts", () => {
    const linh = seed.patterns.find((item) => item.id === "sp-linh-rotation")!;
    expect(() => upsertPattern(seed, { ...linh, cycleLength: 4 }, linh.id)).toThrow(ScheduleError);
    // Positions 6 and 7 are free, so trimming them is fine.
    const trimmed = upsertPattern(seed, { ...linh, cycleLength: 6 }, linh.id);
    expect(trimmed.patterns.find((item) => item.id === linh.id)!.cycleLength).toBe(6);
  });

  it("refuses to delete a shift type in use", () => {
    expect(() => deleteShiftType(seed, "st-early")).toThrow(ScheduleError);
  });

  it("fills an override range, replacing what was there, within the cap", () => {
    const next = fillOverrides(seed, "linh", "2026-10-20", "2026-10-22", null, "Off");
    expect(next.overrides.filter((row) => row.memberId === "linh" && row.date >= "2026-10-20" && row.date <= "2026-10-22")).toHaveLength(3);
    expect(() => fillOverrides(seed, "linh", "2026-01-01", "2026-12-31", null, "")).toThrow(/at most 100/);
  });

  it("falls back to the seed for a stale stored shape", () => {
    expect(normalizeState({ version: 0 }, seed)).toBe(seed);
    expect(normalizeState([], seed)).toBe(seed);
    const kept = normalizeState(JSON.parse(JSON.stringify(seed)), seed);
    expect(kept.patterns).toHaveLength(seed.patterns.length);
  });

  it("builds a seed whose month bounds behave", () => {
    expect(monthBounds("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
