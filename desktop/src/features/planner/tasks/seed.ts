/**
 * Preview tasks about building this app. Dates are relative to today so the
 * page always shows something overdue, due today and coming up.
 *
 * TODO(backend): drop once tasks come from the planning service.
 */

import { isoDate } from "../shared/persistentState";
import { addDays } from "./recurrence";
import type { Completion, Task, TasksState } from "./types";

export function createSeed(now: Date = new Date()): TasksState {
  const today = isoDate(now);
  const day = (offset: number) => addDays(today, offset);
  const at = (offset: number, hours: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    date.setHours(hours, 0, 0, 0);
    return date.toISOString();
  };
  const created = at(-14, 9);

  const base = (id: string, title: string): Task => ({
    id,
    title,
    description: "",
    status: "open",
    archivedAt: null,
    priority: "none",
    category: "feature",
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
    createdBy: "me",
    createdAt: created,
    updatedAt: created,
  });

  const tasks: Task[] = [
    {
      ...base("seed-split-view", "Split view for multiple chats"),
      description:
        "Two or three threads side by side, each with its own composer.\n\n- [ ] Resizable dividers\n- [ ] Keyboard focus between panes",
      priority: "high",
      tags: ["UI", "Desktop"],
      dueDate: day(2),
      assigneeIds: ["me"],
      points: 5,
      subtasks: [
        { id: "seed-sv-1", title: "Pane layout and resizing", done: true },
        { id: "seed-sv-2", title: "Per-pane composer state", done: false },
        { id: "seed-sv-3", title: "Restore panes on relaunch", done: false },
      ],
    },
    {
      ...base("seed-inline-comments", "Inline comments on diffs"),
      priority: "medium",
      tags: ["Review"],
      dueDate: day(6),
      assigneeIds: ["agent"],
    },
    {
      ...base("seed-vietnamese", "Vietnamese interface"),
      category: "i18n",
      priority: "low",
      tags: ["i18n"],
      assigneeIds: ["linh"],
    },
    {
      ...base("seed-token-usage", "Real token usage in the context ring"),
      category: "backend",
      status: "in_progress",
      priority: "urgent",
      tags: ["Sidecar"],
      dueDate: today,
      dueTime: "17:00",
      assigneeIds: ["me", "agent"],
      points: 3,
      comments: [
        {
          id: "seed-c-1",
          authorId: "agent",
          text: "The sidecar already reports usage per turn — @Khai want me to wire it into the ring?",
          createdAt: at(-1, 15),
          updatedAt: null,
        },
      ],
    },
    {
      ...base("seed-crash-reports", "Review sidecar crash reports"),
      category: "backend",
      priority: "high",
      dueDate: day(-2),
      assigneeIds: ["minh"],
    },
    {
      ...base("seed-dependency-audit", "Weekly dependency audit"),
      category: "infra",
      priority: "medium",
      tags: ["Security"],
      dueDate: day(-1),
      assigneeIds: ["agent"],
      recurrenceRule: "FREQ=WEEKLY",
      seriesId: "seed-dependency-audit",
      subtasks: [
        { id: "seed-da-1", title: "npm audit", done: false },
        { id: "seed-da-2", title: "cargo audit", done: false },
      ],
    },
    {
      ...base("seed-worktrees", "Clean up stale worktrees"),
      category: "infra",
      dueDate: day(4),
      assigneeIds: ["agent"],
      recurrenceRule: "FREQ=WEEKLY;INTERVAL=2",
      recurrenceFromCompletion: true,
    },
    {
      ...base("seed-release-notes", "Write 0.2 release notes"),
      category: "misc",
      priority: "medium",
      startDate: day(5),
      dueDate: day(9),
      assigneeIds: ["me"],
    },
    {
      ...base("seed-plain-chats", "Plain chats without a project"),
      status: "done",
      tags: ["UI"],
      assigneeIds: ["me"],
    },
    {
      ...base("seed-settings", "Settings in the desktop style"),
      category: "ui",
      status: "done",
      assigneeIds: ["linh"],
    },
  ];

  const completions: Completion[] = [
    {
      id: "seed-done-1",
      taskId: "seed-plain-chats",
      seriesId: "seed-plain-chats",
      userId: "me",
      doneById: null,
      completedAt: at(0, 10),
    },
    {
      id: "seed-done-2",
      taskId: "seed-settings",
      seriesId: "seed-settings",
      userId: "me",
      doneById: "linh",
      completedAt: at(-1, 16),
    },
  ];

  return { tasks, completions };
}
