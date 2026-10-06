/*
 * Original KhaiDocs code, MIT.
 *
 * Recently visited pages, like Notion's "Recents": kept on this device in
 * localStorage (Docmost has no visit history; its "recent" API lists recent
 * edits, which the home page uses to fill the list up).
 */

import { useSyncExternalStore } from "react";

export const RECENTS_KEY = "khaidocs:recent-pages";
export const RECENTS_LIMIT = 20;

export interface RecentPage {
  id: string;
  slugId: string;
  title: string;
  icon: string | null;
  spaceSlug: string;
  visitedAt: string;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecent(value: unknown): value is RecentPage {
  const v = value as RecentPage;
  return (
    !!v &&
    typeof v.id === "string" &&
    typeof v.slugId === "string" &&
    typeof v.spaceSlug === "string" &&
    typeof v.visitedAt === "string"
  );
}

export function loadRecents(storage: StorageLike | null = defaultStorage()): RecentPage[] {
  try {
    const raw = storage?.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(isRecent).map((r) => ({
          ...r,
          title: typeof r.title === "string" ? r.title : "",
          icon: typeof r.icon === "string" ? r.icon : null,
        }))
      : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
let snapshot: RecentPage[] | null = null;

function save(list: RecentPage[], storage: StorageLike | null) {
  try {
    storage?.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: recents are a convenience */
  }
  snapshot = list;
  listeners.forEach((listener) => listener());
}

/** Moves the page to the front (newest first), capped at RECENTS_LIMIT. */
export function withVisit(list: RecentPage[], page: Omit<RecentPage, "visitedAt">, now = new Date()): RecentPage[] {
  const entry: RecentPage = { ...page, visitedAt: now.toISOString() };
  return [entry, ...list.filter((r) => r.id !== page.id)].slice(0, RECENTS_LIMIT);
}

export function recordVisit(
  page: Omit<RecentPage, "visitedAt">,
  storage: StorageLike | null = defaultStorage(),
) {
  save(withVisit(loadRecents(storage), page), storage);
}

export function updateRecentPage(
  id: string,
  patch: Partial<Pick<RecentPage, "title" | "icon">>,
  storage: StorageLike | null = defaultStorage(),
) {
  const list = loadRecents(storage);
  if (!list.some((r) => r.id === id)) return;
  save(
    list.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    storage,
  );
}

/** Drops a page from Recents; `id` may be the page id or its slug id. */
export function removeRecentPage(id: string, storage: StorageLike | null = defaultStorage()) {
  const list = loadRecents(storage);
  if (!list.some((r) => r.id === id || r.slugId === id)) return;
  save(
    list.filter((r) => r.id !== id && r.slugId !== id),
    storage,
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  if (!snapshot) snapshot = loadRecents();
  return snapshot;
}

export function useRecentPages(): RecentPage[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Page ids checked (or being checked) this session, so each is asked once. */
const confirmed = new Set<string>();

/**
 * Drops Recents entries whose page has since gone to Trash or been deleted —
 * including ones recorded before trashing removed them, or trashed from
 * another device. `lookup` resolves a page id to its `deletedAt`, and
 * rejects when the page no longer exists.
 */
export async function pruneRecents(
  lookup: (id: string) => Promise<{ deletedAt?: unknown } | null | undefined>,
  storage: StorageLike | null = defaultStorage(),
): Promise<void> {
  const pending = loadRecents(storage).filter((r) => !confirmed.has(r.id));
  pending.forEach((r) => confirmed.add(r.id));
  await Promise.all(
    pending.map(async (recent) => {
      let gone = false;
      try {
        const page = await lookup(recent.id);
        gone = !page || Boolean(page.deletedAt);
      } catch (error) {
        const status = (error as { response?: { status?: number } })?.response?.status;
        gone = status === 404 || status === 403;
        // A network hiccup is not proof the page is gone: ask again later.
        if (!gone) confirmed.delete(recent.id);
      }
      if (gone) removeRecentPage(recent.id, storage);
    }),
  );
}
