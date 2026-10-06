/**
 * Per-device view choices for the Tasks page. Only folded groups and columns
 * are stored, so a new group always appears open.
 */

import { useEffect, useState } from "react";

import { PLANNER_KEYS, usePersistentState } from "../shared/persistentState";
import type { GroupMode, ViewMode } from "./types";

export interface TaskUiPrefs {
  view: ViewMode;
  groupMode: GroupMode;
  /** "<mode>:<group id>" — the mode belongs in the key, a category may share an id with a due group. */
  collapsedGroups: string[];
  collapsedColumns: string[];
  mine: boolean;
  showScheduled: boolean;
}

const DEFAULT_PREFS: TaskUiPrefs = {
  view: "list",
  groupMode: "due",
  collapsedGroups: [],
  collapsedColumns: [],
  mine: false,
  showScheduled: false,
};

const VIEWS: ViewMode[] = ["list", "board", "history"];

export function useTaskUiPrefs(): [TaskUiPrefs, (patch: Partial<TaskUiPrefs>) => void] {
  const [stored, setStored] = usePersistentState<TaskUiPrefs>(`${PLANNER_KEYS.tasks}.ui`, DEFAULT_PREFS);
  const prefs: TaskUiPrefs = {
    view: VIEWS.includes(stored.view) ? stored.view : "list",
    groupMode: stored.groupMode === "category" ? "category" : "due",
    collapsedGroups: Array.isArray(stored.collapsedGroups) ? stored.collapsedGroups : [],
    collapsedColumns: Array.isArray(stored.collapsedColumns) ? stored.collapsedColumns : [],
    mine: stored.mine === true,
    showScheduled: stored.showScheduled === true,
  };
  const update = (patch: Partial<TaskUiPrefs>) => setStored((current) => ({ ...DEFAULT_PREFS, ...current, ...patch }));
  return [prefs, update];
}

export function toggleIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

/** The clock overdue and today highlighting reads from; ticks once a minute. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
