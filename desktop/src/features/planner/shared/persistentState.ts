/**
 * Browser-storage state for the planner pages.
 *
 * Every planner module keeps its preview data under its own key here, so the
 * Calendar can read the Tasks and Schedule stores without importing their UI.
 * Storage can be unavailable or hold a stale shape, so every read falls back
 * to the seed and every write is best-effort.
 *
 * TODO(backend): replace with the planning service when one exists.
 */

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export const PLANNER_KEYS = {
  tasks: "khai-agents.planner.tasks",
  schedule: "khai-agents.planner.schedule",
  calendar: "khai-agents.planner.calendar",
  notes: "khai-agents.planner.notes",
} as const;

export function readStore<T>(key: string, seed: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return seed;
    const parsed: unknown = JSON.parse(raw);
    // Arrays stay arrays and objects stay objects; anything else is stale.
    if (Array.isArray(seed) !== Array.isArray(parsed)) return seed;
    if (parsed === null || typeof parsed !== typeof seed) return seed;
    return parsed as T;
  } catch {
    return seed;
  }
}

export function writeStore<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Preview storage only; the page still works for this session.
  }
}

/** useState that loads from and saves to one planner store key. */
export function usePersistentState<T>(
  key: string,
  seed: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() =>
    readStore(key, typeof seed === "function" ? (seed as () => T)() : seed),
  );
  useEffect(() => {
    writeStore(key, value);
  }, [key, value]);
  return [value, setValue];
}

/** Local calendar date as YYYY-MM-DD (not UTC, which shifts near midnight). */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
