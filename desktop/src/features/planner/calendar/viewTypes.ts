/**
 * What the page hands each view: the filtered items per day and the actions
 * a view may trigger. Views never touch storage themselves.
 */

import type { ScheduleOccurrence } from "../schedule/calendarFeed";
import type { CalendarTask } from "../tasks/calendarFeed";
import type { DateKey } from "./dates";
import type { Occurrence } from "./model";

export interface DayItems {
  occurrences: Occurrence[];
  tasks: CalendarTask[];
  schedule: ScheduleOccurrence[];
}

export interface ViewActions {
  openOccurrence(occurrence: Occurrence, anchor: HTMLElement | null, day?: DateKey): void;
  openTask(task: CalendarTask, anchor: HTMLElement | null): void;
  openSchedule(entry: ScheduleOccurrence, anchor: HTMLElement | null): void;
  create(day: DateKey, time?: string): void;
  openDay(day: DateKey): void;
  showMore(day: DateKey, anchor: HTMLElement | null): void;
  move(occurrence: Occurrence, day: DateKey): void;
  /** Move the page to another period while keeping keyboard focus in the grid. */
  jumpTo(day: DateKey): void;
}

export interface ViewProps {
  cursor: DateKey;
  today: DateKey;
  /** Minutes since local midnight, for the now line. */
  nowMinutes: number;
  weekStart: number;
  scheduleDisplay: "compact" | "blocks";
  itemsOn(day: DateKey): DayItems;
  /** The occurrence the detail view currently shows, highlighted in place. */
  selectedKey: string | null;
  actions: ViewActions;
}
