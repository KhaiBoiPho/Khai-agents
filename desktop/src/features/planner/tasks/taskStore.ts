/**
 * The Tasks store: one object under PLANNER_KEYS.tasks holding the tasks and
 * their completion history. The Calendar reads the same key through
 * `calendarFeed.ts`.
 *
 * TODO(backend): replace with the planning service; completions would then
 * also credit reward points to assignees (Yuvomi's reward ledger).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PLANNER_KEYS, readStore, writeStore } from "../shared/persistentState";
import { createSeed } from "./seed";
import * as model from "./taskModel";
import type { Task, TasksState, TaskStatus } from "./types";

/** The current store contents, normalized; the seed when nothing is stored. */
export function readTaskState(): TasksState {
  return model.normalizeState(readStore<unknown>(PLANNER_KEYS.tasks, null), createSeed);
}

export interface TaskActions {
  add(fields: Partial<Task> & { title: string }): Task;
  update(id: string, patch: model.TaskPatch): void;
  setStatus(id: string, status: TaskStatus, doneById?: string | null): model.StatusResult;
  setArchived(id: string, archived: boolean): void;
  remove(id: string): model.RemovedTask | null;
  restore(removed: model.RemovedTask): void;
  addSubtask(taskId: string, title: string): void;
  toggleSubtask(taskId: string, subtaskId: string): void;
  renameSubtask(taskId: string, subtaskId: string, title: string): void;
  removeSubtask(taskId: string, subtaskId: string): void;
  addComment(taskId: string, text: string): void;
  editComment(taskId: string, commentId: string, text: string): void;
  deleteComment(taskId: string, commentId: string): void;
  renameTag(from: string, to: string): void;
  deleteTag(tag: string): void;
}

export function useTaskStore(): [TasksState, TaskActions] {
  const [state, setState] = useState<TasksState>(readTaskState);
  // Mirrors the latest committed state, so an action can compute its result
  // synchronously and hand it back (the follow-up's due date, the undo snapshot).
  const latest = useRef(state);

  useEffect(() => {
    writeStore(PLANNER_KEYS.tasks, state);
  }, [state]);

  const commit = useCallback((next: TasksState) => {
    if (next === latest.current) return;
    latest.current = next;
    setState(next);
  }, []);

  const actions = useMemo<TaskActions>(() => {
    const apply = (fn: (current: TasksState, now: Date) => TasksState) => commit(fn(latest.current, new Date()));
    return {
      add(fields) {
        const task = model.createTask(fields, new Date());
        apply((current) => model.addTask(current, task));
        return task;
      },
      update: (id, patch) => apply((current, now) => model.updateTask(current, id, patch, now)),
      setStatus(id, status, doneById = null) {
        const result = model.setStatus(latest.current, id, status, new Date(), { doneById });
        commit(result.state);
        return result;
      },
      setArchived: (id, archived) => apply((current, now) => model.setArchived(current, id, archived, now)),
      remove(id) {
        const result = model.removeTask(latest.current, id);
        commit(result.state);
        return result.removed;
      },
      restore: (removed) => apply((current) => model.restoreTask(current, removed)),
      addSubtask: (taskId, title) => apply((current, now) => model.addSubtask(current, taskId, title, now)),
      toggleSubtask: (taskId, subtaskId) =>
        apply((current, now) => model.toggleSubtask(current, taskId, subtaskId, now)),
      renameSubtask: (taskId, subtaskId, title) =>
        apply((current, now) => model.renameSubtask(current, taskId, subtaskId, title, now)),
      removeSubtask: (taskId, subtaskId) =>
        apply((current, now) => model.removeSubtask(current, taskId, subtaskId, now)),
      addComment: (taskId, text) => apply((current, now) => model.addComment(current, taskId, text, now)),
      editComment: (taskId, commentId, text) =>
        apply((current, now) => model.editComment(current, taskId, commentId, text, now)),
      deleteComment: (taskId, commentId) => apply((current) => model.deleteComment(current, taskId, commentId)),
      renameTag: (from, to) => apply((current, now) => model.renameTag(current, from, to, now)),
      deleteTag: (tag) => apply((current, now) => model.deleteTag(current, tag, now)),
    };
  }, [commit]);

  return [state, actions];
}
