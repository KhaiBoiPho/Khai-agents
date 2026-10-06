/** The Tasks data model, after Yuvomi's `tasks`, `task_comments` and `task_completions` tables. */

export type TaskStatus = "open" | "in_progress" | "done";
export type Priority = "none" | "low" | "medium" | "high" | "urgent";
/** The status filter also knows the archive, which is its own axis on the task. */
export type StatusFilter = TaskStatus | "archived";
export type GroupMode = "due" | "category";
export type ViewMode = "list" | "board" | "history";

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface TaskComment {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
  /** Null until edited — only a corrected comment carries the mark. */
  updatedAt: string | null;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  /** ISO timestamp; null means the task is in play. Independent of `status`. */
  archivedAt: string | null;
  priority: Priority;
  category: string;
  tags: string[];
  /** YYYY-MM-DD, local. */
  dueDate: string | null;
  /** HH:MM, local. */
  dueTime: string | null;
  /** Tasks starting in the future stay out of the default list. */
  startDate: string | null;
  assigneeIds: string[];
  /** iCal RRULE body, e.g. "FREQ=WEEKLY;BYDAY=MO". */
  recurrenceRule: string | null;
  /** Count the next interval from the day it was ticked off, not from the due date. */
  recurrenceFromCompletion: boolean;
  /** The completed occurrence whose completion created this one. */
  recurrenceOriginId: string | null;
  /** First occurrence of the series; survives deleting earlier occurrences. */
  seriesId: string | null;
  points: number;
  subtasks: Subtask[];
  comments: TaskComment[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Ticking a task off is an event, not just a state. */
export interface Completion {
  id: string;
  taskId: string;
  seriesId: string;
  /** Who ticked it off. */
  userId: string;
  /** Who did it, when somebody else was named. */
  doneById: string | null;
  completedAt: string;
}

export interface TasksState {
  tasks: Task[];
  completions: Completion[];
}

export interface TaskFilters {
  statuses: StatusFilter[];
  priorities: Priority[];
  people: string[];
  categories: string[];
  /** AND-combined: a task must carry every selected tag. */
  tags: string[];
  mine: boolean;
  showScheduled: boolean;
  dueToday: boolean;
}

export const DEFAULT_FILTERS: TaskFilters = {
  statuses: ["open", "in_progress"],
  priorities: [],
  people: [],
  categories: [],
  tags: [],
  mine: false,
  showScheduled: false,
  dueToday: false,
};

export const PRIORITIES: ReadonlyArray<{ id: Priority; label: string }> = [
  { id: "urgent", label: "Urgent" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
  { id: "none", label: "None" },
];

export const PRIORITY_ORDER: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export const STATUSES: ReadonlyArray<{ id: TaskStatus; label: string }> = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "done", label: "Done" },
];

/** A fixed set of drawers; Yuvomi's are household ones, these fit building the app. */
export const CATEGORIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "feature", label: "Feature" },
  { id: "backend", label: "Backend" },
  { id: "ui", label: "Interface" },
  { id: "i18n", label: "Localization" },
  { id: "infra", label: "Infrastructure" },
  { id: "misc", label: "Other" },
];

export const FALLBACK_CATEGORY = "misc";

export function categoryLabel(id: string): string {
  return CATEGORIES.find((category) => category.id === id)?.label ?? id;
}

export function priorityLabel(id: Priority): string {
  return PRIORITIES.find((priority) => priority.id === id)?.label ?? id;
}

export function statusLabel(id: TaskStatus): string {
  return STATUSES.find((status) => status.id === id)?.label ?? id;
}

/** The person using the app; assignee "me" in `members.ts`. */
export const CURRENT_USER_ID = "me";
