/**
 * Pinned and favorite chats.
 *
 * TODO(backend): threads carry no pin/favorite fields yet, so the marks live
 * in this browser's storage. Move them to thread metadata when the App
 * Server grows one; the hook's shape can stay the same.
 */

import { useCallback, useSyncExternalStore } from "react";

interface Marks {
  pinned: string[];
  favorites: string[];
}

const KEY = "khai-agents.thread-marks";
const listeners = new Set<() => void>();
let state: Marks = read();

function read(): Marks {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    };
  } catch {
    return { pinned: [], favorites: [] };
  }
}

function commit(next: Marks): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // The marks then last for this page only.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [id, ...list];
}

export function useThreadMarks() {
  const marks = useSyncExternalStore(subscribe, () => state, () => state);
  const togglePin = useCallback(
    (id: string) => commit({ ...state, pinned: toggle(state.pinned, id) }),
    [],
  );
  const toggleFavorite = useCallback(
    (id: string) => commit({ ...state, favorites: toggle(state.favorites, id) }),
    [],
  );
  const forget = useCallback(
    (id: string) =>
      commit({
        pinned: state.pinned.filter((entry) => entry !== id),
        favorites: state.favorites.filter((entry) => entry !== id),
      }),
    [],
  );
  return { ...marks, togglePin, toggleFavorite, forget };
}
