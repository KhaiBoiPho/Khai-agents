/**
 * The starting schedule and quick-start templates.
 */

import type { ScheduleState, ShiftColor, ShiftType } from "./model";

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

/** The starting schedule: the shift types, and no shifts yet. */
export function buildSeed(): ScheduleState {
  // A fresh schedule starts empty; only the shift types are offered.
  return {
    version: 1,
    types: TYPES,
    patterns: [],
    overrides: [],
    extras: [],
    settings: { weeklyHours: {}, overtimeEnabled: true },
  };
}
