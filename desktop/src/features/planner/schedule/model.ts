/**
 * Schedule data model.
 *
 * One cycle model, not two features: a weekly timetable is a 7-day cycle
 * (or 14 for "week A / week B") anchored on a Monday, and a rotation is any
 * other cycle length. Both share the same arithmetic; `kind` only changes
 * how the editor labels the cycle days.
 */

export type ShiftColor =
  | "teal"
  | "blue"
  | "violet"
  | "fuchsia"
  | "rose"
  | "red"
  | "orange"
  | "amber"
  | "green"
  | "slate";

/** Light/dark pairs so every type reads on all themes. */
export const SHIFT_COLORS: Record<ShiftColor, string> = {
  teal: "light-dark(#0e7490, #22d3ee)",
  blue: "light-dark(#1d4ed8, #60a5fa)",
  violet: "light-dark(#6d28d9, #a78bfa)",
  fuchsia: "light-dark(#a21caf, #e879f9)",
  rose: "light-dark(#be123c, #fb7185)",
  red: "light-dark(#b91c1c, #f87171)",
  orange: "light-dark(#c2410c, #fb923c)",
  amber: "light-dark(#a16207, #fbbf24)",
  green: "light-dark(#15803d, #4ade80)",
  slate: "light-dark(#475569, #94a3b8)",
};

export const SHIFT_COLOR_NAMES = Object.keys(SHIFT_COLORS) as ShiftColor[];

export function shiftColor(color: string | undefined): string {
  return SHIFT_COLORS[color as ShiftColor] ?? SHIFT_COLORS.slate;
}

export interface ShiftType {
  id: string;
  name: string;
  /** At most 12 characters; the compact roster shows this. */
  shortCode: string;
  /** HH:MM; both or neither. `end <= start` crosses midnight. */
  start: string | null;
  end: string | null;
  color: ShiftColor;
}

export interface PatternDay {
  id: string;
  /** 0 … cycleLength-1. A position may carry several rows (a timetable). */
  position: number;
  /** null is a free day inside the cycle. */
  shiftTypeId: string | null;
}

export type PatternKind = "rotation" | "timetable";

export interface Pattern {
  id: string;
  memberId: string;
  name: string;
  kind: PatternKind;
  /** Day zero of the cycle; earlier days wrap backwards. */
  anchorDate: string;
  cycleLength: number;
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
  days: PatternDay[];
  /** Tie-break for overlapping patterns with the same validFrom. */
  createdAt: string;
}

export interface Override {
  id: string;
  memberId: string;
  date: string;
  /** null is an explicit free day, not a missing override. */
  shiftTypeId: string | null;
  note: string;
}

export interface ExtraShift {
  id: string;
  memberId: string;
  date: string;
  shiftTypeId: string;
  note: string;
}

export interface ScheduleSettings {
  /** Per-member weekly target for the overtime flag. */
  weeklyHours: Record<string, number>;
  overtimeEnabled: boolean;
}

export interface ScheduleState {
  version: 1;
  types: ShiftType[];
  patterns: Pattern[];
  overrides: Override[];
  extras: ExtraShift[];
  settings: ScheduleSettings;
}

export type EntrySource = "pattern" | "override" | "extra";

/** One resolved occurrence for one member on one day. */
export interface ScheduleEntry {
  key: string;
  memberId: string;
  date: string;
  source: EntrySource;
  patternId: string | null;
  position: number | null;
  shiftType: ShiftType | null;
  note: string;
  isFree: boolean;
  crossesMidnight: boolean;
}

export interface OverlapWarning {
  memberId: string;
  date: string;
  patternIds: string[];
}

export const DEFAULT_WEEKLY_HOURS = 40;
export const MAX_RANGE_DAYS = 731;
/** A fill writes real rows; sized for an absence, not a shadow pattern. */
export const MAX_FILL_DAYS = 100;
export const MAX_CYCLE_LENGTH = 366;
export const MAX_PATTERN_DAY_ROWS = 500;

export function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}
