/**
 * Pure task logic: due-date reading, filtering, sorting, grouping and every
 * state transition. Kept free of React so the store, the Calendar feed and
 * the tests share one set of rules.
 */

import { isoDate } from "../shared/persistentState";
import { addDays, daysBetween, nextDueAfterCompletion, parseRule } from "./recurrence";
import {
  CATEGORIES,
  CURRENT_USER_ID,
  DEFAULT_FILTERS,
  FALLBACK_CATEGORY,
  PRIORITY_ORDER,
  categoryLabel,
  type Completion,
  type GroupMode,
  type Priority,
  type Subtask,
  type Task,
  type TaskFilters,
  type TaskStatus,
  type TasksState,
} from "./types";

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/* ---------- reading dates ---------- */

/** Wall-clock stamp "YYYY-MM-DDTHH:MM" — comparable as text with `effectiveDue`. */
export function nowStamp(now: Date): string {
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${isoDate(now)}T${hours}:${minutes}`;
}

/** The moment a task falls due; without a time, the end of its day. */
export function effectiveDue(task: Pick<Task, "dueDate" | "dueTime">): string | null {
  if (!task.dueDate) return null;
  return `${task.dueDate}T${task.dueTime ?? "23:59:59"}`;
}

export function isArchived(task: Task): boolean {
  return task.archivedAt !== null;
}

export function isOverdue(task: Task, now: Date): boolean {
  if (task.status === "done" || isArchived(task)) return false;
  const due = effectiveDue(task);
  return due !== null && due < nowStamp(now);
}

export type DueTone = "overdue" | "today" | "plain";

export function formatDay(key: string, now: Date): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!);
  return date.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    ...(year === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function formatTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date(2000, 0, 1, hours, minutes);
  return date.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
}

/** "Overdue · Oct 3", "Due today, 5:00 PM", "Due tomorrow", "Oct 12". Done tasks read neutral. */
export function dueLabel(
  task: Pick<Task, "dueDate" | "dueTime" | "status" | "archivedAt">,
  now: Date,
): { label: string; tone: DueTone } | null {
  if (!task.dueDate) return null;
  const today = isoDate(now);
  const time = task.dueTime ? formatTime(task.dueTime) : null;
  const full = time ? `${formatDay(task.dueDate, now)}, ${time}` : formatDay(task.dueDate, now);
  if (task.status === "done" || task.archivedAt) return { label: full, tone: "plain" };
  const due = effectiveDue(task)!;
  if (due < nowStamp(now)) return { label: `Overdue · ${full}`, tone: "overdue" };
  const diff = daysBetween(today, task.dueDate);
  if (diff === 0) return { label: time ? `Due today, ${time}` : "Due today", tone: "today" };
  if (diff === 1) return { label: time ? `Due tomorrow, ${time}` : "Due tomorrow", tone: "plain" };
  return { label: full, tone: "plain" };
}

/* ---------- sorting, filtering, grouping ---------- */

/** Overdue first, then by due moment, priority as the tie-breaker; undated last. */
export function compareTasks(a: Task, b: Task, stamp: string): number {
  const aDue = effectiveDue(a);
  const bDue = effectiveDue(b);
  const aOver = aDue !== null && aDue < stamp ? 1 : 0;
  const bOver = bDue !== null && bDue < stamp ? 1 : 0;
  if (aOver !== bOver) return bOver - aOver;
  const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (!aDue && !bDue) return byPriority || a.createdAt.localeCompare(b.createdAt);
  if (!aDue) return 1;
  if (!bDue) return -1;
  if (aDue !== bDue) return aDue < bDue ? -1 : 1;
  return byPriority;
}

export function sortTasks(tasks: Task[], now: Date): Task[] {
  const stamp = nowStamp(now);
  return [...tasks].sort((a, b) => compareTasks(a, b, stamp));
}

export function matchesSearch(task: Task, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return (
    task.title.toLocaleLowerCase().includes(needle) ||
    task.description.toLocaleLowerCase().includes(needle)
  );
}

export function isScheduledLater(task: Task, now: Date): boolean {
  return task.startDate !== null && task.startDate > isoDate(now);
}

/**
 * Axes combine with AND; values inside one axis with OR — except tags, which
 * a task can carry several of, so selected tags narrow. `ignoreStatus` is for
 * the board, whose columns are the status.
 */
export function filterTasks(
  tasks: Task[],
  filters: TaskFilters,
  query: string,
  now: Date,
  { ignoreStatus = false }: { ignoreStatus?: boolean } = {},
): Task[] {
  const today = isoDate(now);
  const tagKeys = filters.tags.map(tagKey);
  return tasks.filter((task) => {
    if (!ignoreStatus) {
      if (filters.dueToday) {
        if (isArchived(task) || task.status === "done") return false;
        if (!task.dueDate || task.dueDate > today) return false;
      } else if (isArchived(task)) {
        if (!filters.statuses.includes("archived")) return false;
      } else if (filters.statuses.length && !filters.statuses.includes(task.status)) {
        return false;
      }
    }
    if (!filters.showScheduled && isScheduledLater(task, now)) return false;
    if (filters.priorities.length && !filters.priorities.includes(task.priority)) return false;
    if (filters.categories.length && !filters.categories.includes(task.category)) return false;
    if (filters.people.length && !task.assigneeIds.some((id) => filters.people.includes(id))) {
      return false;
    }
    if (filters.mine && !task.assigneeIds.includes(CURRENT_USER_ID)) return false;
    if (tagKeys.length) {
      const own = task.tags.map(tagKey);
      if (!tagKeys.every((key) => own.includes(key))) return false;
    }
    return matchesSearch(task, query);
  });
}

/** How many filters depart from the resting state — drives the filter button's badge. */
export function activeFilterCount(filters: TaskFilters): number {
  const sameStatuses =
    filters.statuses.length === DEFAULT_FILTERS.statuses.length &&
    DEFAULT_FILTERS.statuses.every((status) => filters.statuses.includes(status));
  return (
    (sameStatuses ? 0 : 1) +
    filters.priorities.length +
    filters.people.length +
    filters.categories.length +
    filters.tags.length +
    (filters.mine ? 1 : 0) +
    (filters.showScheduled ? 1 : 0) +
    (filters.dueToday ? 1 : 0)
  );
}

export interface TaskGroup {
  /** Stable id, never the label — collapse state is stored by it. */
  id: string;
  label: string;
  tasks: Task[];
}

const DUE_GROUPS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "thisWeek", label: "This week" },
  { id: "nextWeek", label: "Next week" },
  { id: "later", label: "Later" },
  { id: "noDate", label: "No date" },
];

export function dueGroupOf(task: Task, now: Date): string {
  if (!task.dueDate) return "noDate";
  // Calendar days, not instants: a task due at 9:00 today stays under Today.
  const diff = daysBetween(isoDate(now), task.dueDate);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 3) return "thisWeek";
  if (diff <= 7) return "nextWeek";
  return "later";
}

export function groupTasks(tasks: Task[], mode: GroupMode, now: Date): TaskGroup[] {
  const sorted = sortTasks(tasks, now);
  const buckets = new Map<string, Task[]>();
  for (const task of sorted) {
    const key = mode === "due" ? dueGroupOf(task, now) : task.category || FALLBACK_CATEGORY;
    const bucket = buckets.get(key) ?? [];
    bucket.push(task);
    buckets.set(key, bucket);
  }
  if (mode === "due") {
    return DUE_GROUPS.filter((group) => buckets.has(group.id)).map((group) => ({
      ...group,
      tasks: buckets.get(group.id)!,
    }));
  }
  // Categories follow their managed order; unknown keys go last, by label.
  const order = (key: string) => {
    const index = CATEGORIES.findIndex((category) => category.id === key);
    return index === -1 ? CATEGORIES.length : index;
  };
  return [...buckets.keys()]
    .sort((a, b) => order(a) - order(b) || categoryLabel(a).localeCompare(categoryLabel(b)))
    .map((id) => ({ id, label: categoryLabel(id), tasks: buckets.get(id)! }));
}

export type BoardColumn = TaskStatus | "archived";

/** The archive trumps the status on the board. */
export function boardColumnOf(task: Task): BoardColumn {
  return isArchived(task) ? "archived" : task.status;
}

export function nextBoardStatus(status: TaskStatus): TaskStatus {
  if (status === "open") return "in_progress";
  if (status === "in_progress") return "done";
  return "open";
}

/* ---------- tags ---------- */

const MAX_TAGS = 32;
const MAX_TAG_LENGTH = 64;

export function tagKey(tag: string): string {
  return tag.normalize("NFC").toLocaleLowerCase();
}

/** Stable hue (0–5) per tag, so a label keeps its colour wherever it appears. */
export function tagHue(tag: string): number {
  let hash = 0;
  for (const char of tagKey(tag)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 6;
}

/** Trim, drop empties, cap, and fold case so "UI" and "ui" are one tag (first spelling wins). */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().slice(0, MAX_TAG_LENGTH);
    if (!tag || seen.has(tagKey(tag))) continue;
    seen.add(tagKey(tag));
    result.push(tag);
    if (result.length >= MAX_TAGS) break;
  }
  return result;
}

export function allTags(tasks: Task[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const task of tasks) {
    for (const tag of task.tags) {
      const entry = counts.get(tagKey(tag));
      if (entry) entry.count += 1;
      else counts.set(tagKey(tag), { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Renaming onto an existing tag merges the two under the typed spelling. */
export function renameTag(state: TasksState, from: string, to: string, now: Date): TasksState {
  const target = to.trim();
  if (!target) return state;
  const fromKey = tagKey(from);
  const targetKey = tagKey(target);
  return mapTasks(state, (task) => {
    const own = task.tags.map(tagKey);
    if (!own.includes(fromKey) && !own.includes(targetKey)) return task;
    if (!own.includes(fromKey)) {
      // Carries the target only: apply the typed spelling.
      return touch({ ...task, tags: task.tags.map((tag) => (tagKey(tag) === targetKey ? target : tag)) }, now);
    }
    const tags = task.tags.map((tag) => (tagKey(tag) === fromKey || tagKey(tag) === targetKey ? target : tag));
    return touch({ ...task, tags: normalizeTags(tags) }, now);
  });
}

export function deleteTag(state: TasksState, tag: string, now: Date): TasksState {
  const key = tagKey(tag);
  return mapTasks(state, (task) =>
    task.tags.some((own) => tagKey(own) === key)
      ? touch({ ...task, tags: task.tags.filter((own) => tagKey(own) !== key) }, now)
      : task,
  );
}

/* ---------- transitions ---------- */

function touch(task: Task, now: Date): Task {
  return { ...task, updatedAt: now.toISOString() };
}

function mapTasks(state: TasksState, fn: (task: Task) => Task): TasksState {
  let changed = false;
  const tasks = state.tasks.map((task) => {
    const next = fn(task);
    if (next !== task) changed = true;
    return next;
  });
  return changed ? { ...state, tasks } : state;
}

export function createTask(fields: Partial<Task> & { title: string }, now: Date): Task {
  const stamp = now.toISOString();
  return {
    id: newId(),
    description: "",
    status: "open",
    archivedAt: null,
    priority: "none",
    category: FALLBACK_CATEGORY,
    tags: [],
    dueDate: null,
    dueTime: null,
    startDate: null,
    assigneeIds: [],
    recurrenceRule: null,
    recurrenceFromCompletion: false,
    recurrenceOriginId: null,
    seriesId: null,
    points: 0,
    subtasks: [],
    comments: [],
    createdBy: CURRENT_USER_ID,
    createdAt: stamp,
    updatedAt: stamp,
    ...fields,
    title: fields.title.trim(),
  };
}

export function addTask(state: TasksState, task: Task): TasksState {
  return { ...state, tasks: [...state.tasks, task] };
}

export type TaskPatch = Partial<
  Omit<Task, "id" | "status" | "createdAt" | "createdBy" | "comments" | "subtasks">
>;

export function updateTask(state: TasksState, id: string, patch: TaskPatch, now: Date): TasksState {
  return mapTasks(state, (task) => {
    if (task.id !== id) return task;
    const next = { ...task, ...patch };
    if (patch.tags) next.tags = normalizeTags(patch.tags);
    if (!next.dueDate) next.dueTime = null;
    return touch(next, now);
  });
}

export interface StatusResult {
  state: TasksState;
  /** Due date of the follow-up a completed recurring task created. */
  nextDue: string | null;
  followUpCreated: boolean;
}

/**
 * Move a task to a status. Completing records who ticked it off (and who did
 * it) and, for a recurring task, creates the next occurrence once; reopening
 * deletes that record and withdraws the follow-up if nobody has touched it.
 */
export function setStatus(
  state: TasksState,
  id: string,
  status: TaskStatus,
  now: Date,
  { actorId = CURRENT_USER_ID, doneById = null }: { actorId?: string; doneById?: string | null } = {},
): StatusResult {
  const task = state.tasks.find((entry) => entry.id === id);
  if (!task || task.status === status) return { state, nextDue: null, followUpCreated: false };

  let next = mapTasks(state, (entry) => (entry.id === id ? touch({ ...entry, status }, now) : entry));
  const seriesId = task.seriesId ?? task.id;

  if (status === "done") {
    if (!next.completions.some((entry) => entry.taskId === id)) {
      const completion: Completion = {
        id: newId(),
        taskId: id,
        seriesId,
        userId: actorId,
        doneById: doneById && doneById !== actorId ? doneById : null,
        completedAt: now.toISOString(),
      };
      next = { ...next, completions: [...next.completions, completion] };
    }
    const followUp = task.recurrenceRule ? createFollowUp(next, task, now) : null;
    if (followUp) {
      next = addTask(next, followUp);
      return { state: next, nextDue: followUp.dueDate, followUpCreated: true };
    }
    return { state: next, nextDue: null, followUpCreated: false };
  }

  if (task.status === "done") {
    next = { ...next, completions: next.completions.filter((entry) => entry.taskId !== id) };
    next = withdrawFollowUp(next, id);
  }
  return { state: next, nextDue: null, followUpCreated: false };
}

function createFollowUp(state: TasksState, task: Task, now: Date): Task | null {
  // Idempotent: a completion never adds a second follow-up.
  if (state.tasks.some((entry) => entry.recurrenceOriginId === task.id)) return null;
  const rule = parseRule(task.recurrenceRule);
  if (!rule) return null;
  const nextDue = nextDueAfterCompletion({
    anchorDate: task.dueDate,
    rule: task.recurrenceRule!,
    completedOn: isoDate(now),
    fromCompletion: task.recurrenceFromCompletion,
  });
  if (!nextDue) return null;
  // Keep the head start between start date and due date.
  const startDate =
    task.startDate && task.dueDate ? addDays(nextDue, -daysBetween(task.startDate, task.dueDate)) : null;
  const stamp = now.toISOString();
  return {
    ...task,
    id: newId(),
    status: "open",
    archivedAt: null,
    dueDate: nextDue,
    startDate,
    recurrenceOriginId: task.id,
    seriesId: task.seriesId ?? task.id,
    // A checklist series keeps its steps, unticked.
    subtasks: task.subtasks.map((subtask) => ({ ...subtask, id: newId(), done: false })),
    comments: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** Only an untouched follow-up is withdrawn: still open and never edited. */
function withdrawFollowUp(state: TasksState, originId: string): TasksState {
  const followUp = state.tasks.find((entry) => entry.recurrenceOriginId === originId);
  if (!followUp || followUp.status !== "open" || followUp.updatedAt !== followUp.createdAt) return state;
  return { ...state, tasks: state.tasks.filter((entry) => entry.id !== followUp.id) };
}

export function setArchived(state: TasksState, id: string, archived: boolean, now: Date): TasksState {
  return mapTasks(state, (task) =>
    task.id === id && isArchived(task) !== archived
      ? touch({ ...task, archivedAt: archived ? now.toISOString() : null }, now)
      : task,
  );
}

export interface RemovedTask {
  task: Task;
  index: number;
  completions: Completion[];
}

/** Deleting a task deletes its completions too; the snapshot restores both. */
export function removeTask(state: TasksState, id: string): { state: TasksState; removed: RemovedTask | null } {
  const index = state.tasks.findIndex((task) => task.id === id);
  if (index === -1) return { state, removed: null };
  const task = state.tasks[index]!;
  return {
    state: {
      tasks: state.tasks.filter((entry) => entry.id !== id),
      completions: state.completions.filter((entry) => entry.taskId !== id),
    },
    removed: { task, index, completions: state.completions.filter((entry) => entry.taskId === id) },
  };
}

export function restoreTask(state: TasksState, removed: RemovedTask): TasksState {
  if (state.tasks.some((task) => task.id === removed.task.id)) return state;
  const tasks = [...state.tasks];
  tasks.splice(Math.min(removed.index, tasks.length), 0, removed.task);
  return { tasks, completions: [...state.completions, ...removed.completions] };
}

/* ---------- subtasks and comments ---------- */

function mapSubtasks(state: TasksState, taskId: string, now: Date, fn: (subtasks: Subtask[]) => Subtask[]) {
  return mapTasks(state, (task) => (task.id === taskId ? touch({ ...task, subtasks: fn(task.subtasks) }, now) : task));
}

export function addSubtask(state: TasksState, taskId: string, title: string, now: Date): TasksState {
  const clean = title.trim();
  if (!clean) return state;
  return mapSubtasks(state, taskId, now, (subtasks) => [...subtasks, { id: newId(), title: clean, done: false }]);
}

export function toggleSubtask(state: TasksState, taskId: string, subtaskId: string, now: Date): TasksState {
  return mapSubtasks(state, taskId, now, (subtasks) =>
    subtasks.map((subtask) => (subtask.id === subtaskId ? { ...subtask, done: !subtask.done } : subtask)),
  );
}

export function renameSubtask(state: TasksState, taskId: string, subtaskId: string, title: string, now: Date) {
  const clean = title.trim();
  if (!clean) return state;
  return mapSubtasks(state, taskId, now, (subtasks) =>
    subtasks.map((subtask) => (subtask.id === subtaskId ? { ...subtask, title: clean } : subtask)),
  );
}

export function removeSubtask(state: TasksState, taskId: string, subtaskId: string, now: Date): TasksState {
  return mapSubtasks(state, taskId, now, (subtasks) => subtasks.filter((subtask) => subtask.id !== subtaskId));
}

export function subtaskProgress(task: Task): { done: number; total: number } | null {
  if (!task.subtasks.length) return null;
  return { done: task.subtasks.filter((subtask) => subtask.done).length, total: task.subtasks.length };
}

const MAX_COMMENT = 5000;

export function addComment(state: TasksState, taskId: string, text: string, now: Date): TasksState {
  const clean = text.trim().slice(0, MAX_COMMENT);
  if (!clean) return state;
  // Comments are conversation, not definition: they don't bump `updatedAt`,
  // so a follow-up stays "untouched" for the undo of its predecessor.
  return mapTasks(state, (task) =>
    task.id === taskId
      ? {
          ...task,
          comments: [
            ...task.comments,
            { id: newId(), authorId: CURRENT_USER_ID, text: clean, createdAt: now.toISOString(), updatedAt: null },
          ],
        }
      : task,
  );
}

export function editComment(state: TasksState, taskId: string, commentId: string, text: string, now: Date) {
  const clean = text.trim().slice(0, MAX_COMMENT);
  if (!clean) return state;
  return mapTasks(state, (task) =>
    task.id === taskId
      ? {
          ...task,
          comments: task.comments.map((comment) =>
            comment.id === commentId && comment.text !== clean
              ? { ...comment, text: clean, updatedAt: now.toISOString() }
              : comment,
          ),
        }
      : task,
  );
}

export function deleteComment(state: TasksState, taskId: string, commentId: string): TasksState {
  return mapTasks(state, (task) =>
    task.id === taskId ? { ...task, comments: task.comments.filter((comment) => comment.id !== commentId) } : task,
  );
}

/* ---------- history ---------- */

export interface HistoryDay {
  day: string;
  entries: Array<{ completion: Completion; task: Task | null }>;
}

/** Completions grouped by local calendar day, newest first. */
export function groupHistory(state: TasksState, personId: string | null): HistoryDay[] {
  const byId = new Map(state.tasks.map((task) => [task.id, task]));
  const entries = state.completions
    .filter((entry) => !personId || (entry.doneById ?? entry.userId) === personId)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const days: HistoryDay[] = [];
  for (const completion of entries) {
    const day = isoDate(new Date(completion.completedAt));
    const last = days[days.length - 1];
    const entry = { completion, task: byId.get(completion.taskId) ?? null };
    if (last && last.day === day) last.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }
  return days;
}

export function seriesCompletions(state: TasksState, task: Task): Completion[] {
  const seriesId = task.seriesId ?? task.id;
  return state.completions
    .filter((entry) => entry.seriesId === seriesId)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

export function dayHeading(day: string, now: Date): string {
  const diff = daysBetween(isoDate(now), day);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, month! - 1, date!).toLocaleDateString("en", {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(year === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/* ---------- storage shape ---------- */

const STATUSES_SET = new Set<TaskStatus>(["open", "in_progress", "done"]);
const PRIORITY_SET = new Set<Priority>(["none", "low", "medium", "high", "urgent"]);

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** Storage may hold an older or foreign shape; keep what reads as a task. */
export function normalizeState(raw: unknown, seed: () => TasksState): TasksState {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as TasksState).tasks)) return seed();
  const source = raw as { tasks: unknown[]; completions?: unknown };
  const tasks: Task[] = [];
  for (const entry of source.tasks) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    const title = str(value.title).trim();
    const id = str(value.id);
    if (!title || !id) continue;
    const createdAt = str(value.createdAt, new Date(0).toISOString());
    tasks.push({
      id,
      title,
      description: str(value.description),
      status: STATUSES_SET.has(value.status as TaskStatus) ? (value.status as TaskStatus) : "open",
      archivedAt: strOrNull(value.archivedAt),
      priority: PRIORITY_SET.has(value.priority as Priority) ? (value.priority as Priority) : "none",
      category: str(value.category, FALLBACK_CATEGORY) || FALLBACK_CATEGORY,
      tags: normalizeTags(strings(value.tags)),
      dueDate: strOrNull(value.dueDate),
      dueTime: strOrNull(value.dueTime),
      startDate: strOrNull(value.startDate),
      assigneeIds: strings(value.assigneeIds),
      recurrenceRule: strOrNull(value.recurrenceRule),
      recurrenceFromCompletion: value.recurrenceFromCompletion === true,
      recurrenceOriginId: strOrNull(value.recurrenceOriginId),
      seriesId: strOrNull(value.seriesId),
      points: typeof value.points === "number" && value.points > 0 ? Math.round(value.points) : 0,
      subtasks: Array.isArray(value.subtasks)
        ? (value.subtasks as Array<Record<string, unknown>>)
            .filter((subtask) => subtask && typeof subtask.id === "string" && typeof subtask.title === "string")
            .map((subtask) => ({ id: subtask.id as string, title: subtask.title as string, done: subtask.done === true }))
        : [],
      comments: Array.isArray(value.comments)
        ? (value.comments as Array<Record<string, unknown>>)
            .filter((comment) => comment && typeof comment.id === "string" && typeof comment.text === "string")
            .map((comment) => ({
              id: comment.id as string,
              authorId: str(comment.authorId, CURRENT_USER_ID),
              text: comment.text as string,
              createdAt: str(comment.createdAt, createdAt),
              updatedAt: strOrNull(comment.updatedAt),
            }))
        : [],
      createdBy: str(value.createdBy, CURRENT_USER_ID),
      createdAt,
      updatedAt: str(value.updatedAt, createdAt),
    });
  }
  const completions: Completion[] = Array.isArray(source.completions)
    ? (source.completions as Array<Record<string, unknown>>)
        .filter((entry) => entry && typeof entry.taskId === "string" && typeof entry.completedAt === "string")
        .map((entry) => ({
          id: str(entry.id) || newId(),
          taskId: entry.taskId as string,
          seriesId: str(entry.seriesId, entry.taskId as string),
          userId: str(entry.userId, CURRENT_USER_ID),
          doneById: strOrNull(entry.doneById),
          completedAt: entry.completedAt as string,
        }))
    : [];
  return { tasks, completions };
}
