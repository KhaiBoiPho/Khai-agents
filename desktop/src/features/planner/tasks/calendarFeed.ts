/**
 * What the Calendar shows of Tasks: every task with a due date.
 *
 * CONTRACT — the Calendar imports this signature; the Tasks module owns the
 * body and must keep the signature stable.
 */

import { readTaskState } from "./taskStore";

export interface CalendarTask {
  id: string;
  title: string;
  /** YYYY-MM-DD, local. */
  dueDate: string;
  /** HH:MM, local; absent for an all-day deadline. */
  dueTime?: string;
  done: boolean;
  priority: "none" | "low" | "medium" | "high" | "urgent";
  assigneeIds: string[];
}

/** Tasks due between `from` and `to` inclusive (YYYY-MM-DD). */
export function readCalendarTasks(from: string, to: string): CalendarTask[] {
  const result: CalendarTask[] = [];
  for (const task of readTaskState().tasks) {
    // Filed-away tasks are out of play, as on every other list.
    if (task.archivedAt || !task.dueDate) continue;
    if (task.dueDate < from || task.dueDate > to) continue;
    result.push({
      id: task.id,
      title: task.title,
      dueDate: task.dueDate,
      ...(task.dueTime ? { dueTime: task.dueTime } : {}),
      done: task.status === "done",
      priority: task.priority,
      assigneeIds: [...task.assigneeIds],
    });
  }
  return result.sort((a, b) =>
    a.dueDate !== b.dueDate
      ? a.dueDate.localeCompare(b.dueDate)
      : (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99"),
  );
}
