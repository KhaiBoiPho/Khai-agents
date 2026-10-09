import type { FileContent, FileEntry } from "../../generated/app-server";
import type { ClientRuntime } from "../../rpc/contracts";

/**
 * Files of the open session, kept in memory so reopening one is instant.
 *
 * One session at a time: opening another session (or a new chat) drops the
 * previous session's files. Readers show a cached copy at once and refresh
 * it in the background, so an agent's edits still arrive.
 */

export interface Listing {
  entries: FileEntry[];
  truncated: boolean;
}

interface SessionCache {
  threadId: string;
  /** Insertion order is recency: a read moves a file to the end. */
  files: Map<string, FileContent>;
  bytes: number;
  listing: Listing | null;
}

/** Past this, the least recently used files are dropped. */
const MAX_BYTES = 32 * 1024 * 1024;
/** Changed files read ahead when a session opens. */
const PREFETCH_FILES = 20;
export const READ_LIMIT_BYTES = 128 * 1024;

let cache: SessionCache | null = null;

function sessionFor(threadId: string): SessionCache {
  if (cache?.threadId !== threadId) {
    cache = { threadId, files: new Map(), bytes: 0, listing: null };
  }
  return cache;
}

/** Make `threadId` the cached session, dropping any other; null drops all. */
export function enterSession(threadId: string | null): void {
  if (threadId === null) cache = null;
  else sessionFor(threadId);
}

export function cachedFile(threadId: string, path: string): FileContent | null {
  if (cache?.threadId !== threadId) return null;
  const file = cache.files.get(path);
  if (!file) return null;
  cache.files.delete(path);
  cache.files.set(path, file);
  return file;
}

export function rememberFile(threadId: string, file: FileContent): void {
  if (cache?.threadId !== threadId) return;
  const session = cache;
  const previous = session.files.get(file.path);
  if (previous) {
    session.bytes -= previous.content.length;
    session.files.delete(file.path);
  }
  session.files.set(file.path, file);
  session.bytes += file.content.length;
  for (const [path, entry] of session.files) {
    if (session.bytes <= MAX_BYTES || path === file.path) break;
    session.files.delete(path);
    session.bytes -= entry.content.length;
  }
}

export function forgetFile(threadId: string, path: string): void {
  if (cache?.threadId !== threadId) return;
  const previous = cache.files.get(path);
  if (!previous) return;
  cache.bytes -= previous.content.length;
  cache.files.delete(path);
}

export function cachedListing(threadId: string): Listing | null {
  return cache?.threadId === threadId ? cache.listing : null;
}

export function rememberListing(threadId: string, listing: Listing): void {
  if (cache?.threadId === threadId) cache.listing = listing;
}

/**
 * Read ahead what the session is likely to open: its file tree and the
 * files it has changed. Best effort and sequential, so it never competes
 * with what the user is doing for long.
 */
export async function prefetchSession(
  runtime: ClientRuntime,
  threadId: string,
  stillCurrent: () => boolean,
): Promise<void> {
  enterSession(threadId);
  try {
    if (!cachedListing(threadId)) {
      const files = await runtime.request("file/list", { threadId, depth: 2, limit: 5000 });
      if (!stillCurrent()) return;
      rememberListing(threadId, { entries: files.entries, truncated: files.truncated });
    }
    const diff = await runtime
      .request("git/diff", { threadId, scope: "all" })
      .catch(() => null);
    const changed = (diff?.files ?? [])
      .filter((file) => !file.binary && file.status !== "deleted")
      .slice(0, PREFETCH_FILES);
    for (const file of changed) {
      if (!stillCurrent()) return;
      if (cachedFile(threadId, file.path)) continue;
      const result = await runtime
        .request("file/read", { threadId, path: file.path, maxBytes: READ_LIMIT_BYTES })
        .catch(() => null);
      if (result && stillCurrent()) rememberFile(threadId, result.file);
    }
  } catch {
    // Prefetching is an optimisation; the panel reads on demand anyway.
  }
}
