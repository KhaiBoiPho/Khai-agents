import { describe, expect, it } from "vitest";

import { readCalendarTasks } from "./calendarFeed";
import { createSeed } from "./seed";
import {
  activeFilterCount,
  addSubtask,
  createTask,
  dueLabel,
  filterTasks,
  groupHistory,
  groupTasks,
  normalizeState,
  removeTask,
  renameTag,
  restoreTask,
  setStatus,
  sortTasks,
} from "./taskModel";
import { DEFAULT_FILTERS, type Task, type TasksState } from "./types";

// Tuesday, 2026-10-06, 12:00 local.
const NOW = new Date(2026, 9, 6, 12, 0);

function task(fields: Partial<Task> & { title: string }): Task {
  return createTask({ id: fields.title, ...fields }, NOW);
}

function state(...tasks: Task[]): TasksState {
  return { tasks, completions: [] };
}

describe("sorting and grouping", () => {
  const tasks = [
    task({ title: "later", dueDate: "2026-10-20" }),
    task({ title: "undated-low", priority: "low" }),
    task({ title: "overdue", dueDate: "2026-10-01" }),
    task({ title: "today-urgent", dueDate: "2026-10-06", priority: "urgent" }),
    task({ title: "today-plain", dueDate: "2026-10-06" }),
    task({ title: "undated-high", priority: "high" }),
    task({ title: "this-morning", dueDate: "2026-10-06", dueTime: "09:00" }),
  ];

  it("puts overdue first, then due moment, priority breaking ties, undated last", () => {
    expect(sortTasks(tasks, NOW).map((entry) => entry.title)).toEqual([
      "overdue",
      "this-morning",
      "today-urgent",
      "today-plain",
      "later",
      "undated-high",
      "undated-low",
    ]);
  });

  it("groups by calendar day with stable ids", () => {
    const groups = groupTasks(tasks, "due", NOW);
    expect(groups.map((group) => group.id)).toEqual(["overdue", "today", "later", "noDate"]);
    expect(groups[1]!.tasks.map((entry) => entry.title)).toEqual(["this-morning", "today-urgent", "today-plain"]);
  });

  it("groups by category in managed order", () => {
    const groups = groupTasks(
      [task({ title: "a", category: "misc" }), task({ title: "b", category: "backend" })],
      "category",
      NOW,
    );
    expect(groups.map((group) => group.label)).toEqual(["Backend", "Other"]);
  });

  it("reads due dates the way the row shows them", () => {
    expect(dueLabel(task({ title: "x", dueDate: "2026-10-01" }), NOW)).toEqual({
      label: "Overdue · Oct 1",
      tone: "overdue",
    });
    expect(dueLabel(task({ title: "x", dueDate: "2026-10-06" }), NOW)?.tone).toBe("today");
    expect(dueLabel(task({ title: "x", dueDate: "2026-10-07" }), NOW)?.label).toBe("Due tomorrow");
    expect(dueLabel(task({ title: "x", dueDate: "2026-10-01", status: "done" }), NOW)?.tone).toBe("plain");
  });
});

describe("filtering", () => {
  const tasks = [
    task({ title: "Open mine", assigneeIds: ["me"], priority: "high", tags: ["UI", "Desktop"] }),
    task({ title: "Doing", status: "in_progress", assigneeIds: ["agent"], priority: "medium", tags: ["UI"] }),
    task({ title: "Finished", status: "done" }),
    task({ title: "Filed", archivedAt: NOW.toISOString() }),
    task({ title: "Scheduled", startDate: "2026-10-20", description: "needle" }),
    task({ title: "Due earlier", dueDate: "2026-10-02" }),
  ];
  const titles = (list: Task[]) => list.map((entry) => entry.title);

  it("shows open and in-progress work by default, hiding the archive and scheduled tasks", () => {
    expect(titles(filterTasks(tasks, DEFAULT_FILTERS, "", NOW))).toEqual(["Open mine", "Doing", "Due earlier"]);
  });

  it("ORs values within an axis and ANDs tags", () => {
    const filters = { ...DEFAULT_FILTERS, priorities: ["high", "medium"] as Task["priority"][] };
    expect(titles(filterTasks(tasks, filters, "", NOW))).toEqual(["Open mine", "Doing"]);
    expect(titles(filterTasks(tasks, { ...DEFAULT_FILTERS, tags: ["ui", "desktop"] }, "", NOW))).toEqual([
      "Open mine",
    ]);
  });

  it("supports the archive, mine, scheduled, due-today and search", () => {
    expect(titles(filterTasks(tasks, { ...DEFAULT_FILTERS, statuses: ["archived"] }, "", NOW))).toEqual(["Filed"]);
    expect(titles(filterTasks(tasks, { ...DEFAULT_FILTERS, mine: true }, "", NOW))).toEqual(["Open mine"]);
    expect(titles(filterTasks(tasks, { ...DEFAULT_FILTERS, showScheduled: true }, "needle", NOW))).toEqual([
      "Scheduled",
    ]);
    expect(titles(filterTasks(tasks, { ...DEFAULT_FILTERS, dueToday: true }, "", NOW))).toEqual(["Due earlier"]);
  });

  it("lets the board ignore the status axis", () => {
    expect(filterTasks(tasks, DEFAULT_FILTERS, "", NOW, { ignoreStatus: true })).toHaveLength(5);
  });

  it("counts departures from the resting filters only", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, statuses: ["done"], tags: ["UI"] })).toBe(2);
  });
});

describe("status transitions", () => {
  const recurring = task({
    title: "Audit",
    dueDate: "2026-09-28",
    startDate: "2026-09-26",
    recurrenceRule: "FREQ=WEEKLY",
    subtasks: [{ id: "s1", title: "npm audit", done: true }],
  });

  it("records the completion and creates one follow-up that catches up", () => {
    const result = setStatus(state(recurring), "Audit", "done", NOW, { doneById: "linh" });
    expect(result.nextDue).toBe("2026-10-12");
    const followUp = result.state.tasks.find((entry) => entry.recurrenceOriginId === "Audit")!;
    expect(followUp).toMatchObject({ status: "open", dueDate: "2026-10-12", startDate: "2026-10-10" });
    expect(followUp.subtasks[0]!.done).toBe(false);
    expect(result.state.completions).toHaveLength(1);
    expect(result.state.completions[0]).toMatchObject({ userId: "me", doneById: "linh", seriesId: "Audit" });
  });

  it("withdraws an untouched follow-up when the completion is undone", () => {
    const done = setStatus(state(recurring), "Audit", "done", NOW).state;
    const reopened = setStatus(done, "Audit", "open", NOW).state;
    expect(reopened.tasks).toHaveLength(1);
    expect(reopened.completions).toHaveLength(0);
  });

  it("keeps a follow-up somebody already worked on", () => {
    const done = setStatus(state(recurring), "Audit", "done", NOW).state;
    const followUpId = done.tasks[1]!.id;
    const worked = addSubtask(done, followUpId, "cargo audit", new Date(NOW.getTime() + 60_000));
    expect(setStatus(worked, "Audit", "open", NOW).state.tasks).toHaveLength(2);
  });

  it("undoes a delete with its completions", () => {
    const done = setStatus(state(task({ title: "One" })), "One", "done", NOW).state;
    const { state: without, removed } = removeTask(done, "One");
    expect(without.tasks).toHaveLength(0);
    expect(without.completions).toHaveLength(0);
    expect(restoreTask(without, removed!)).toEqual(done);
  });

  it("groups history by day, filtered by who did it", () => {
    const done = setStatus(state(task({ title: "One" })), "One", "done", NOW, { doneById: "linh" }).state;
    expect(groupHistory(done, "linh")[0]!.entries[0]!.task?.title).toBe("One");
    expect(groupHistory(done, "me")).toEqual([]);
  });
});

describe("tags and storage", () => {
  it("merges a renamed tag into an existing one under the typed spelling", () => {
    const merged = renameTag(state(task({ title: "a", tags: ["ui", "Desktop"] })), "desktop", "UI", NOW);
    expect(merged.tasks[0]!.tags).toEqual(["UI"]);
  });

  it("falls back to the seed for a foreign shape and repairs partial tasks", () => {
    const seed = () => state(task({ title: "seed" }));
    expect(normalizeState([1, 2], seed).tasks[0]!.title).toBe("seed");
    const repaired = normalizeState({ tasks: [{ id: "x", title: "Kept", priority: "bogus" }, { id: "y" }] }, seed);
    expect(repaired.tasks).toHaveLength(1);
    expect(repaired.tasks[0]).toMatchObject({ title: "Kept", priority: "none", status: "open", tags: [] });
  });
});

describe("calendar feed", () => {
  it("returns dated, unarchived tasks in range, in date order", () => {
    // No storage in this environment, so the feed reads the seed.
    const seed = createSeed();
    const dated = seed.tasks.filter((entry) => entry.dueDate).map((entry) => entry.dueDate!).sort();
    const feed = readCalendarTasks(dated[0]!, dated[dated.length - 1]!);
    expect(feed.length).toBe(dated.length);
    expect(feed.map((entry) => entry.dueDate)).toEqual(dated);
    const token = feed.find((entry) => entry.id === "seed-token-usage")!;
    expect(token).toMatchObject({ dueTime: "17:00", done: false, priority: "urgent", assigneeIds: ["me", "agent"] });
    expect(readCalendarTasks("1999-01-01", "1999-12-31")).toEqual([]);
  });
});
