/**
 * Preview data and quick-start templates.
 *
 * TODO(backend): preview data — replace with the planning service.
 */

import { addDays, startOfWeek } from "./dates";
import type { Pattern, PatternDay, ScheduleState, ShiftColor, ShiftType } from "./model";

interface Preset {
  key: string;
  name: string;
  shortCode: string;
  start: string | null;
  end: string | null;
  color: ShiftColor;
}

// Absences carry no times on purpose: an all-day type nobody works is how a
// day is marked "not here", without a separate concept.
const SHARED_PRESETS: Preset[] = [
  { key: "vacation", name: "Vacation", shortCode: "V", start: null, end: null, color: "slate" },
  { key: "sick", name: "Sick", shortCode: "S", start: null, end: null, color: "red" },
];

export const QUICKSTART_TEMPLATES: { key: string; label: string; presets: Preset[] }[] = [
  {
    key: "work",
    label: "Work",
    presets: [
      { key: "early", name: "Early shift", shortCode: "E", start: "06:00", end: "14:00", color: "teal" },
      { key: "late", name: "Late shift", shortCode: "L", start: "14:00", end: "22:00", color: "fuchsia" },
      { key: "night", name: "Night shift", shortCode: "N", start: "22:00", end: "06:00", color: "blue" },
      { key: "day", name: "Day shift", shortCode: "D", start: "08:00", end: "16:00", color: "green" },
      { key: "fullDay", name: "24-hour shift", shortCode: "24", start: "10:00", end: "10:00", color: "amber" },
      ...SHARED_PRESETS,
    ],
  },
  {
    key: "agent",
    label: "Agent ops",
    presets: [
      { key: "oncall", name: "On-call", shortCode: "OC", start: "18:00", end: "08:00", color: "rose" },
      { key: "focus", name: "Focus block", shortCode: "F", start: "10:00", end: "12:00", color: "violet" },
      { key: "maintenance", name: "Maintenance window", shortCode: "MW", start: "02:00", end: "04:00", color: "amber" },
      { key: "review", name: "Code review sweep", shortCode: "RV", start: "07:00", end: "08:00", color: "green" },
      ...SHARED_PRESETS,
    ],
  },
  {
    key: "school",
    label: "School",
    presets: [
      { key: "period1", name: "Period 1", shortCode: "P1", start: "08:00", end: "08:45", color: "blue" },
      { key: "period2", name: "Period 2", shortCode: "P2", start: "08:55", end: "09:40", color: "green" },
      { key: "period3", name: "Period 3", shortCode: "P3", start: "09:55", end: "10:40", color: "orange" },
      { key: "period4", name: "Period 4", shortCode: "P4", start: "10:50", end: "11:35", color: "rose" },
      { key: "exam", name: "Exam", shortCode: "EX", start: "09:00", end: "11:00", color: "amber" },
      ...SHARED_PRESETS,
    ],
  },
  {
    key: "university",
    label: "University",
    presets: [
      { key: "lecture", name: "Lecture", shortCode: "LE", start: "09:00", end: "10:30", color: "blue" },
      { key: "seminar", name: "Seminar", shortCode: "SE", start: "10:45", end: "12:15", color: "green" },
      { key: "lab", name: "Lab", shortCode: "LAB", start: "13:00", end: "15:00", color: "teal" },
      { key: "exam", name: "Exam", shortCode: "EX", start: "09:00", end: "11:00", color: "amber" },
      ...SHARED_PRESETS,
    ],
  },
];

export const ALL_PRESETS: Preset[] = [
  ...new Map(QUICKSTART_TEMPLATES.flatMap((template) => template.presets).map((preset) => [preset.key, preset])).values(),
];

const TYPES: ShiftType[] = [
  { id: "st-standup", name: "Standup", shortCode: "SU", start: "09:30", end: "09:45", color: "teal" },
  { id: "st-focus", name: "Focus block", shortCode: "F", start: "10:00", end: "12:00", color: "violet" },
  { id: "st-day", name: "Day shift", shortCode: "D", start: "09:00", end: "17:00", color: "green" },
  { id: "st-oncall", name: "On-call", shortCode: "OC", start: "18:00", end: "08:00", color: "rose" },
  { id: "st-early", name: "Early support", shortCode: "E", start: "06:00", end: "14:00", color: "teal" },
  { id: "st-late", name: "Late support", shortCode: "L", start: "14:00", end: "22:00", color: "fuchsia" },
  { id: "st-night", name: "Night watch", shortCode: "N", start: "22:00", end: "06:00", color: "blue" },
  { id: "st-maint", name: "Maintenance window", shortCode: "MW", start: "02:00", end: "04:00", color: "amber" },
  { id: "st-reindex", name: "Deep reindex", shortCode: "RX", start: "01:00", end: "05:00", color: "orange" },
  { id: "st-review", name: "Code review sweep", shortCode: "RV", start: "07:00", end: "08:00", color: "green" },
  { id: "st-vacation", name: "Vacation", shortCode: "V", start: null, end: null, color: "slate" },
  { id: "st-sick", name: "Sick", shortCode: "S", start: null, end: null, color: "red" },
];

function days(patternId: string, layout: (string | null)[][]): PatternDay[] {
  return layout.flatMap((rows, position) =>
    rows.map((shiftTypeId, index) => ({ id: `${patternId}-d${position}-${index}`, position, shiftTypeId })),
  );
}

/** Seed relative to `today`, so the preview always shows a live week. */
export function buildSeed(today: string): ScheduleState {
  const week = startOfWeek(today);
  const pattern = (value: Omit<Pattern, "active" | "createdAt"> & Partial<Pattern>): Pattern => ({
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...value,
  });
  const patterns: Pattern[] = [
    pattern({
      id: "sp-me-week",
      memberId: "me",
      name: "Work week",
      kind: "timetable",
      anchorDate: week,
      cycleLength: 7,
      validFrom: null,
      validUntil: null,
      days: days("sp-me-week", [
        ["st-standup"],
        ["st-standup", "st-focus"],
        ["st-standup"],
        ["st-standup", "st-focus"],
        ["st-standup"],
        [],
        [],
      ]),
    }),
    pattern({
      id: "sp-linh-rotation",
      memberId: "linh",
      name: "Support rotation",
      kind: "rotation",
      // Anchored in the past: earlier days wrap backwards through the cycle.
      anchorDate: addDays(week, -10),
      cycleLength: 8,
      validFrom: null,
      validUntil: null,
      days: days("sp-linh-rotation", [
        ["st-early"],
        ["st-early"],
        ["st-late"],
        ["st-late"],
        ["st-night"],
        ["st-night"],
        [],
        [],
      ]),
    }),
    pattern({
      id: "sp-minh-ab",
      memberId: "minh",
      name: "Week A / week B",
      kind: "timetable",
      anchorDate: week,
      cycleLength: 14,
      validFrom: null,
      validUntil: null,
      days: days("sp-minh-ab", [
        ["st-day"], ["st-day"], ["st-day"], ["st-day"], ["st-day"], [], [],
        ["st-day"], ["st-day"], ["st-day"], ["st-oncall"], [], [], [],
      ]),
    }),
    pattern({
      id: "sp-minh-release",
      memberId: "minh",
      name: "Release week",
      kind: "rotation",
      anchorDate: addDays(week, 14),
      cycleLength: 5,
      validFrom: addDays(week, 14),
      validUntil: addDays(week, 18),
      createdAt: "2026-02-01T00:00:00.000Z",
      days: days("sp-minh-release", [["st-late"], ["st-late"], ["st-late"], ["st-late"], ["st-late"]]),
    }),
    pattern({
      id: "sp-agent-nightly",
      memberId: "agent",
      name: "Nightly maintenance",
      kind: "timetable",
      anchorDate: week,
      cycleLength: 7,
      validFrom: null,
      validUntil: null,
      days: days("sp-agent-nightly", [
        ["st-maint", "st-review"],
        ["st-maint", "st-review"],
        ["st-maint", "st-review"],
        ["st-maint", "st-review"],
        ["st-maint", "st-review"],
        ["st-maint"],
        ["st-reindex"],
      ]),
    }),
  ];
  return {
    version: 1,
    types: TYPES,
    patterns,
    overrides: [
      ...[15, 16, 17].map((offset) => ({
        id: `so-linh-${offset}`,
        memberId: "linh",
        date: addDays(week, offset),
        shiftTypeId: "st-vacation",
        note: "Trip to Da Nang",
      })),
      { id: "so-minh-sick", memberId: "minh", date: addDays(today, -1), shiftTypeId: "st-sick", note: "" },
      { id: "so-agent-freeze", memberId: "agent", date: addDays(week, 9), shiftTypeId: null, note: "Paused for model upgrade" },
    ],
    extras: [
      { id: "se-me-cover", memberId: "me", date: addDays(week, 4), shiftTypeId: "st-oncall", note: "Covering for Linh" },
      { id: "se-minh-oncall", memberId: "minh", date: addDays(week, 2), shiftTypeId: "st-oncall", note: "" },
    ],
    settings: { weeklyHours: {}, overtimeEnabled: true },
  };
}
