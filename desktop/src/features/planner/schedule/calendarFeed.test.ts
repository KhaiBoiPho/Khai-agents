import { afterEach, describe, expect, it, vi } from "vitest";

import { PLANNER_KEYS } from "../shared/persistentState";
import { readScheduleOccurrences } from "./calendarFeed";
import { addDays, startOfWeek } from "./dates";
import type { ScheduleState } from "./model";
import { todayKey } from "./scheduleStore";

function fakeStorage(entries: Record<string, string>) {
  return {
    getItem: (key: string) => entries[key] ?? null,
    setItem: (key: string, value: string) => {
      entries[key] = value;
    },
    removeItem: (key: string) => {
      delete entries[key];
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readScheduleOccurrences", () => {
  it("falls back to the seed when storage is empty or unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    const week = startOfWeek(todayKey());
    const occurrences = readScheduleOccurrences(week, addDays(week, 6));
    expect(occurrences.length).toBeGreaterThan(0);
    expect(occurrences.some((item) => item.memberId === "agent" && item.label === "Maintenance window")).toBe(true);
  });

  it("returns only dates inside the inclusive range, sorted, without free days", () => {
    vi.stubGlobal("localStorage", fakeStorage({}));
    const from = todayKey();
    const to = addDays(from, 3);
    const occurrences = readScheduleOccurrences(from, to);
    expect(occurrences.every((item) => item.date >= from && item.date <= to)).toBe(true);
    expect(new Set(occurrences.map((item) => item.date)).has(to)).toBe(true);
    const sorted = [...occurrences].sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? ""));
    expect(occurrences).toEqual(sorted);
    expect(occurrences.every((item) => item.label && item.color.startsWith("light-dark("))).toBe(true);
    expect(new Set(occurrences.map((item) => item.id)).size).toBe(occurrences.length);
  });

  it("reads what the store wrote and keeps overnight shifts on their start day", () => {
    const state: ScheduleState = {
      version: 1,
      types: [
        { id: "n", name: "Night watch", shortCode: "N", start: "22:00", end: "06:00", color: "blue" },
        { id: "v", name: "Vacation", shortCode: "V", start: null, end: null, color: "slate" },
      ],
      patterns: [
        {
          id: "p",
          memberId: "linh",
          name: "Nights",
          kind: "rotation",
          anchorDate: "2026-10-01",
          cycleLength: 2,
          validFrom: null,
          validUntil: null,
          active: true,
          days: [{ id: "d", position: 0, shiftTypeId: "n" }],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      overrides: [{ id: "o", memberId: "linh", date: "2026-10-05", shiftTypeId: "v", note: "" }],
      extras: [],
      settings: { weeklyHours: {}, overtimeEnabled: true },
    };
    vi.stubGlobal("localStorage", fakeStorage({ [PLANNER_KEYS.schedule]: JSON.stringify(state) }));
    const occurrences = readScheduleOccurrences("2026-10-01", "2026-10-05");
    expect(occurrences.map((item) => [item.date, item.label, item.start, item.end])).toEqual([
      ["2026-10-01", "Night watch", "22:00", "06:00"],
      ["2026-10-03", "Night watch", "22:00", "06:00"],
      ["2026-10-05", "Vacation", undefined, undefined],
    ]);
    expect(occurrences[2]).not.toHaveProperty("start");
  });

  it("returns nothing for a reversed or malformed range", () => {
    expect(readScheduleOccurrences("2026-10-05", "2026-10-01")).toEqual([]);
    expect(readScheduleOccurrences("soon", "2026-10-01")).toEqual([]);
  });
});
