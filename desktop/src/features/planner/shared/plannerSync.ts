/**
 * Keeps the planner documents in step with the server (/api/planner).
 *
 * localStorage stays the synchronous copy every page reads at first paint.
 * This module, on first use:
 *  - pulls the server documents into localStorage and tells mounted stores to
 *    reload (`usePlannerReload`); a document only this browser has is uploaded,
 *    so nothing typed before the server existed is lost;
 *  - pushes each write (debounced) with the version it was based on; the
 *    server refuses a stale write and its copy then wins locally;
 *  - polls the versions while the tab is visible, which is how a change the
 *    agent made appears in an open Calendar, Tasks, Schedule or Notes page.
 *
 * Outside a browser with the App Server (tests, offline) every call is a no-op.
 */

import { useEffect, useRef } from "react";

/** localStorage key -> server document key. */
const SERVER_KEYS: Record<string, string> = {
  "khai-agents.planner.v2.tasks": "tasks",
  "khai-agents.planner.v2.calendar": "calendar",
  "khai-agents.planner.v2.schedule": "schedule",
  "khai-agents.planner.v2.notes": "notes",
};
const LOCAL_KEYS = Object.fromEntries(Object.entries(SERVER_KEYS).map(([local, server]) => [server, local]));

const PUSH_DELAY_MS = 600;
const POLL_MS = 5000;
const RELOAD_EVENT = "khai:planner-reload";

/**
 * JSON with object keys sorted. Postgres jsonb does not keep key order, so a
 * plain stringify would see every round trip as a change and two tabs would
 * push the same document back and forth.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );
}

interface Known {
  version: number | null;
  json: string | null;
}

const known = new Map<string, Known>();
const pending = new Map<string, { value: unknown; timer: number }>();
let started: Promise<void> | null = null;
let pollTimer: number | null = null;

function enabled(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof fetch === "function" &&
    typeof window.location?.origin === "string" &&
    window.location.origin.startsWith("http") &&
    import.meta.env.MODE !== "test"
  );
}

async function api<T>(path: string, body: unknown): Promise<{ status: number; data: T | null; raw: unknown }> {
  const response = await fetch(`/api/planner/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw: unknown = await response.json().catch(() => null);
  const data = raw && typeof raw === "object" && "data" in raw ? (raw as { data: T }).data : null;
  return { status: response.status, data, raw };
}

interface ServerDocument {
  value: unknown;
  version: number;
}

function applyRemote(serverKey: string, document: ServerDocument): void {
  const local = LOCAL_KEYS[serverKey];
  if (!local) return;
  const json = stableJson(document.value);
  known.set(serverKey, { version: document.version, json });
  // A local edit waiting to be pushed is newer than what the server sent.
  if (pending.has(serverKey)) return;
  let current: string | null = null;
  try {
    const raw = localStorage.getItem(local);
    current = raw === null ? null : stableJson(JSON.parse(raw));
  } catch {
    // No storage or a corrupt copy: the server's copy replaces it.
  }
  if (current === json) return;
  try {
    localStorage.setItem(local, JSON.stringify(document.value));
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent(RELOAD_EVENT, { detail: { key: local } }));
}

async function pull(keys?: string[]): Promise<void> {
  const result = await api<{ documents: Record<string, ServerDocument> }>("read", keys ? { keys } : {});
  if (result.status !== 200 || !result.data) return;
  const documents = result.data.documents ?? {};
  for (const [serverKey, document] of Object.entries(documents)) applyRemote(serverKey, document);
  // First sync: upload what only this browser has.
  for (const serverKey of keys ?? Object.values(SERVER_KEYS)) {
    if (documents[serverKey] || known.has(serverKey)) continue;
    known.set(serverKey, { version: null, json: null });
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(LOCAL_KEYS[serverKey]);
    } catch {
      raw = null;
    }
    if (raw !== null) {
      try {
        schedulePush(serverKey, JSON.parse(raw));
      } catch {
        // A corrupt local copy is not worth uploading.
      }
    }
  }
}

async function poll(): Promise<void> {
  if (document.visibilityState !== "visible") return;
  const result = await api<{ versions: Record<string, number> }>("versions", {});
  if (result.status !== 200 || !result.data) return;
  const changed = Object.entries(result.data.versions ?? {})
    .filter(([key, version]) => known.get(key)?.version !== version && !pending.has(key))
    .map(([key]) => key);
  if (changed.length) await pull(changed);
}

function start(): void {
  if (started || !enabled()) return;
  started = pull().catch(() => undefined);
  pollTimer = window.setInterval(() => void poll().catch(() => undefined), POLL_MS);
  window.addEventListener("focus", () => void poll().catch(() => undefined));
}

async function push(serverKey: string, value: unknown): Promise<void> {
  pending.delete(serverKey);
  const json = stableJson(value);
  const base = known.get(serverKey);
  if (base?.json === json) return;
  const result = await api<ServerDocument>("write", {
    key: serverKey,
    value,
    baseVersion: base?.version ?? null,
  });
  if (result.status === 200 && result.data) {
    known.set(serverKey, { version: result.data.version, json });
  } else if (result.status === 409) {
    // Someone (usually the agent) changed it first: their copy wins here.
    const current = (result.raw as { current?: ServerDocument } | null)?.current;
    if (current && current.version) applyRemote(serverKey, current);
    else await pull([serverKey]);
  }
}

function schedulePush(serverKey: string, value: unknown): void {
  const waiting = pending.get(serverKey);
  if (waiting) window.clearTimeout(waiting.timer);
  const timer = window.setTimeout(() => {
    void (started ?? Promise.resolve())
      .then(() => push(serverKey, value))
      .catch(() => pending.delete(serverKey));
  }, PUSH_DELAY_MS);
  pending.set(serverKey, { value, timer });
}

/** Queue a write of one planner document to the server (no-op for other keys). */
export function pushPlannerDocument(localKey: string, value: unknown): void {
  const serverKey = SERVER_KEYS[localKey];
  if (!serverKey || !enabled()) return;
  start();
  const base = known.get(serverKey);
  if (base?.json === stableJson(value)) return;
  schedulePush(serverKey, value);
}

/** Run `reload` whenever the server brings a newer copy of `localKey`. */
export function usePlannerReload(localKey: string, reload: () => void): void {
  const latest = useRef(reload);
  useEffect(() => {
    latest.current = reload;
  });
  useEffect(() => {
    if (!SERVER_KEYS[localKey] || !enabled()) return;
    start();
    const onReload = (event: Event) => {
      if ((event as CustomEvent<{ key: string }>).detail?.key === localKey) latest.current();
    };
    window.addEventListener(RELOAD_EVENT, onReload);
    return () => window.removeEventListener(RELOAD_EVENT, onReload);
  }, [localKey]);
}

/** For tests: forget everything this module learned. */
export function resetPlannerSyncForTests(): void {
  known.clear();
  pending.forEach(({ timer }) => window.clearTimeout(timer));
  pending.clear();
  started = null;
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = null;
}
