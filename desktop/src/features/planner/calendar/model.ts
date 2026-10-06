/**
 * The Calendar's data model, colour palette and preview data.
 *
 * Mirrors Yuvomi's `calendar_events` row where it matters to the UI: a start
 * and end that are either a date (all-day, end inclusive) or a wall-clock
 * date-time, an optional RRULE with excluded dates, several assignees,
 * reminders as lead times, per-event visibility and a countdown flag.
 *
 * TODO(backend): sample data and browser storage stand in for a calendar
 * service; holidays and birthdays stand in for the holiday cache and the
 * contacts module.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { memberById } from "../shared/members";
import {
  addDays,
  endOfMonth,
  isDateKey,
  makeKey,
  yearOf,
  type DateKey,
} from "./dates";

export type Visibility = "all" | "assignees" | "private";

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  /** "YYYY-MM-DD" when all-day, else "YYYY-MM-DDTHH:MM" (local wall clock). */
  start: string;
  /** Same shape as `start`; an all-day end is inclusive. */
  end: string;
  /** Palette key, or null to borrow the first assignee's colour. */
  color: string | null;
  icon: string | null;
  attendeeIds: string[];
  rrule: string | null;
  /** Excluded occurrence days of a series (EXDATE). */
  exdates: DateKey[];
  /** Lead times in minutes before the start. */
  reminders: number[];
  visibility: Visibility;
  countdown: boolean;
  createdBy: string;
}

export type OccurrenceLayer = "event" | "holiday" | "birthday";

/** One concrete appearance of an event (or a layer entry) on the grid. */
export interface Occurrence {
  /** Unique per appearance: `${event.id}@${slot}`. */
  key: string;
  event: CalendarEvent;
  /** The series slot this occurrence fills (its original start day). */
  slot: DateKey;
  start: string;
  end: string;
  allDay: boolean;
  recurring: boolean;
  layer: OccurrenceLayer;
}

// --- colour ------------------------------------------------------------------

export interface PaletteColor {
  key: string;
  label: string;
  value: string;
}

/**
 * Yuvomi's muted jewel tones, each given a lighter twin for dark themes so the
 * edge and dot keep their weight there. Text never sits on these directly:
 * chips mix 35 % of the colour into the theme's text colour, which is what
 * keeps them legible across all palettes.
 */
export const EVENT_COLORS: readonly PaletteColor[] = [
  { key: "blue", label: "Blue", value: "light-dark(#4a6fc4, #8aa6ec)" },
  { key: "green", label: "Green", value: "light-dark(#2f8a57, #6fcf97)" },
  { key: "orange", label: "Orange", value: "light-dark(#c36f2b, #f0a35e)" },
  { key: "red", label: "Red", value: "light-dark(#b9434a, #ee8389)" },
  { key: "purple", label: "Purple", value: "light-dark(#7149b0, #b294e6)" },
  { key: "coral", label: "Coral", value: "light-dark(#c25a40, #f19a82)" },
  { key: "sky", label: "Sky Blue", value: "light-dark(#2f86b0, #7cc4e8)" },
  { key: "yellow", label: "Yellow", value: "light-dark(#9a7a1c, #e3c45a)" },
  { key: "gray", label: "Gray", value: "light-dark(#6c6d72, #a6a7ad)" },
  { key: "cyan", label: "Cyan", value: "light-dark(#1f8489, #5fcdd2)" },
];

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function paletteColor(key: string | null | undefined): string | null {
  if (!key) return null;
  const found = EVENT_COLORS.find((color) => color.key === key);
  if (found) return found.value;
  return HEX_RE.test(key) ? key : null;
}

/**
 * Own colour, else the first assignee's, else the module accent — the order
 * of Yuvomi's resolveEventColor(), minus the external-calendar step.
 */
export function eventColor(event: CalendarEvent): string {
  const own = paletteColor(event.color);
  if (own) return own;
  const firstAssignee = memberById(event.attendeeIds[0]);
  return firstAssignee?.color ?? "var(--module-calendar)";
}

export const HOLIDAY_COLOR = "light-dark(#b9434a, #ee8389)";
export const BIRTHDAY_COLOR = "light-dark(#7149b0, #b294e6)";

export function occurrenceColor(occurrence: Occurrence): string {
  if (occurrence.layer === "holiday") return HOLIDAY_COLOR;
  if (occurrence.layer === "birthday") return BIRTHDAY_COLOR;
  return eventColor(occurrence.event);
}

// --- validation ----------------------------------------------------------------

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

/** Drops stored rows whose shape no longer matches, instead of crashing on them. */
export function sanitizeEvents(value: unknown): CalendarEvent[] {
  if (!Array.isArray(value)) return [];
  const out: CalendarEvent[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Partial<CalendarEvent>;
    if (typeof row.id !== "string" || typeof row.title !== "string") continue;
    if (typeof row.start !== "string" || !DATETIME_RE.test(row.start)) continue;
    const end = typeof row.end === "string" && DATETIME_RE.test(row.end) ? row.end : row.start;
    out.push({
      id: row.id,
      title: row.title,
      description: typeof row.description === "string" ? row.description : "",
      location: typeof row.location === "string" ? row.location : "",
      allDay: Boolean(row.allDay),
      start: row.start,
      end,
      color: typeof row.color === "string" ? row.color : null,
      icon: typeof row.icon === "string" ? row.icon : null,
      attendeeIds: Array.isArray(row.attendeeIds) ? row.attendeeIds.filter((id) => typeof id === "string") : [],
      rrule: typeof row.rrule === "string" && row.rrule ? row.rrule : null,
      exdates: Array.isArray(row.exdates) ? row.exdates.filter(isDateKey) : [],
      reminders: Array.isArray(row.reminders)
        ? row.reminders.filter((n) => typeof n === "number" && n >= 0).slice(0, 5)
        : [],
      visibility: row.visibility === "assignees" || row.visibility === "private" ? row.visibility : "all",
      countdown: Boolean(row.countdown),
      createdBy: typeof row.createdBy === "string" ? row.createdBy : "me",
    });
  }
  return out;
}

export function newEventId(): string {
  return `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- preview data ----------------------------------------------------------------

function base(partial: Partial<CalendarEvent> & Pick<CalendarEvent, "id" | "title" | "start" | "end">): CalendarEvent {
  return {
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

/**
 * The agent-workspace flavour of the old preview page — runs, reviews and
 * deadlines — rebuilt around today so every view has something to show.
 * TODO(backend): replace with scheduled runs and connected calendars.
 */
export function seedEvents(today: DateKey): CalendarEvent[] {
  const day = (offset: number) => addDays(today, offset);
  const at = (offset: number, time: string) => `${day(offset)}T${time}`;
  return [
    base({
      id: "seed-review",
      title: "Daily code review run",
      start: at(0, "09:00"),
      end: at(0, "09:30"),
      icon: "bot",
      attendeeIds: ["agent"],
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      reminders: [0],
      description: "The agent reviews yesterday's merged pull requests and files findings.",
    }),
    base({
      id: "seed-sync",
      title: "Sync with team",
      start: at(0, "15:30"),
      end: at(0, "16:15"),
      location: "Zoom",
      attendeeIds: ["me", "linh", "minh"],
      rrule: "FREQ=WEEKLY",
      reminders: [15],
      icon: "users",
    }),
    base({
      id: "seed-audit",
      title: "Dependency audit run",
      start: at(1, "10:00"),
      end: at(1, "10:45"),
      attendeeIds: ["agent"],
      icon: "shield",
      color: "cyan",
    }),
    base({
      id: "seed-ship",
      title: "Ship settings redesign",
      start: at(2, "17:00"),
      end: at(2, "17:30"),
      color: "red",
      icon: "flag",
      attendeeIds: ["me"],
      reminders: [60, 1440],
    }),
    base({
      id: "seed-eval",
      title: "Model eval batch",
      start: at(3, "22:00"),
      end: at(4, "01:30"),
      attendeeIds: ["agent"],
      color: "purple",
      description: "Overnight benchmark sweep on the new prompts.",
    }),
    base({
      id: "seed-demo",
      title: "Demo prep",
      start: at(4, "14:00"),
      end: at(4, "15:30"),
      attendeeIds: ["me", "linh"],
      location: "Room 3B",
    }),
    base({
      id: "seed-report",
      title: "Weekly report draft",
      start: at(6, "09:00"),
      end: at(6, "09:45"),
      attendeeIds: ["agent"],
      rrule: "FREQ=WEEKLY;INTERVAL=2",
      icon: "file-text",
    }),
    base({
      id: "seed-freeze",
      title: "Release freeze",
      allDay: true,
      start: day(7),
      end: day(9),
      color: "orange",
      visibility: "assignees",
      attendeeIds: ["me", "minh"],
    }),
    base({
      id: "seed-paper",
      title: "Paper2Code submission",
      start: at(9, "23:00"),
      end: at(9, "23:59"),
      color: "red",
      countdown: true,
      icon: "flag",
      reminders: [1440, 10080],
    }),
    base({
      id: "seed-offsite",
      title: "Offsite: roadmap planning",
      allDay: true,
      start: day(12),
      end: day(14),
      color: "purple",
      location: "Da Lat",
      attendeeIds: ["me", "linh", "minh"],
    }),
    base({
      id: "seed-retro",
      title: "Sprint retro",
      start: at(-2, "11:00"),
      end: at(-2, "12:00"),
      attendeeIds: ["me", "linh", "minh"],
      rrule: "FREQ=WEEKLY;INTERVAL=2",
    }),
    base({
      id: "seed-scan",
      title: "Security scan run",
      start: at(-5, "09:00"),
      end: at(-5, "09:20"),
      attendeeIds: ["agent"],
      rrule: "FREQ=MONTHLY",
      color: "cyan",
      icon: "shield",
    }),
    base({
      id: "seed-1on1",
      title: "1:1 with Linh",
      start: at(0, "11:00"),
      end: at(0, "11:30"),
      attendeeIds: ["me", "linh"],
      visibility: "private",
    }),
    base({
      id: "seed-backup",
      title: "Backup snapshot",
      start: at(0, "11:15"),
      end: at(0, "11:45"),
      attendeeIds: ["agent"],
      rrule: "FREQ=DAILY",
      color: "gray",
    }),
    base({
      id: "seed-billing",
      title: "Invoice API usage",
      allDay: true,
      start: endOfMonth(today),
      end: endOfMonth(today),
      rrule: "FREQ=MONTHLY;BYMONTHDAY=-1",
      color: "yellow",
    }),
  ];
}

// --- layers -------------------------------------------------------------------------

export interface LayerEntry {
  id: string;
  title: string;
  date: DateKey;
  layer: "holiday" | "birthday";
}

/** Anonymous Gregorian computus (Meeus/Jones/Butcher). */
function easterSunday(year: number): DateKey {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
  return makeKey(year, month - 1, dayOfMonth);
}

/** TODO(backend): Yuvomi reads these from a per-region holiday cache. */
export function holidaysForYear(year: number): LayerEntry[] {
  const easter = easterSunday(year);
  const fixed: Array<[number, number, string]> = [
    [0, 1, "New Year's Day"],
    [4, 1, "Labour Day"],
    [11, 24, "Christmas Eve"],
    [11, 25, "Christmas Day"],
    [11, 26, "Boxing Day"],
    [11, 31, "New Year's Eve"],
  ];
  return [
    ...fixed.map(([month, d, title]) => ({
      id: `holiday-${year}-${month}-${d}`,
      title,
      date: makeKey(year, month, d),
      layer: "holiday" as const,
    })),
    { id: `holiday-${year}-gf`, title: "Good Friday", date: addDays(easter, -2), layer: "holiday" },
    { id: `holiday-${year}-em`, title: "Easter Monday", date: addDays(easter, 1), layer: "holiday" },
  ];
}

/** TODO(backend): Yuvomi mirrors these from the contacts module. */
const BIRTHDAYS: Array<{ name: string; month: number; day: number }> = [
  { name: "Linh", month: 2, day: 14 },
  { name: "Minh", month: 9, day: 19 },
  { name: "Khai", month: 6, day: 2 },
];

export function birthdaysForYear(year: number): LayerEntry[] {
  return BIRTHDAYS.map(({ name, month, day: d }) => ({
    id: `birthday-${name}-${year}`,
    title: `${name}'s birthday`,
    date: makeKey(year, month, d),
    layer: "birthday" as const,
  }));
}

/** Layer entries as occurrences, so the grid draws them like events. */
export function layerOccurrences(from: DateKey, to: DateKey, include: { holidays: boolean; birthdays: boolean }): Occurrence[] {
  const out: Occurrence[] = [];
  for (let year = yearOf(from); year <= yearOf(to); year++) {
    const entries = [
      ...(include.holidays ? holidaysForYear(year) : []),
      ...(include.birthdays ? birthdaysForYear(year) : []),
    ];
    for (const entry of entries) {
      if (entry.date < from || entry.date > to) continue;
      const event = base({
        id: entry.id,
        title: entry.title,
        start: entry.date,
        end: entry.date,
        allDay: true,
        icon: entry.layer === "birthday" ? "cake" : "flag",
        createdBy: "system",
      });
      out.push({
        key: `${entry.id}@${entry.date}`,
        event,
        slot: entry.date,
        start: entry.date,
        end: entry.date,
        allDay: true,
        recurring: false,
        layer: entry.layer,
      });
    }
  }
  return out;
}
