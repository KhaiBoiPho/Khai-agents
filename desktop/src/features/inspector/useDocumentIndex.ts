import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  RagDocumentStatus,
  RagStatusResult,
} from "../../generated/app-server";
import type { ClientRuntime } from "../../rpc/contracts";

export type DocumentIndexState = RagDocumentStatus["status"];

export interface DocumentIndexController {
  status: RagStatusResult | null;
  /** Index state per workspace-relative path, for tree badges. */
  byPath: ReadonlyMap<string, DocumentIndexState>;
  busy: boolean;
  error: string | null;
  reindex(force?: boolean): Promise<void>;
}

const POLL_MS = 1500;
const EMPTY = new Map<string, DocumentIndexState>();

function message(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * The document-search index of one Thread workspace (`rag/status`), polled
 * while indexing runs. `refreshKey` changes when the file listing does, so
 * an upload shows up as pending and then indexed without a manual refresh.
 */
export function useDocumentIndex(
  runtime: ClientRuntime,
  threadId: string | null,
  refreshKey: unknown,
): DocumentIndexController {
  // Tagged with its Thread so a switch never shows the previous workspace.
  const [snapshot, setSnapshot] = useState<{
    threadId: string;
    result: RagStatusResult;
  } | null>(null);
  const status = snapshot && snapshot.threadId === threadId ? snapshot.result : null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    runtime
      .request("rag/status", { threadId })
      .then((result) => {
        if (cancelled) return;
        setSnapshot({ threadId, result });
        setError(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        // An older service without document search: show nothing.
        setSnapshot(null);
        setError(message(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, threadId, refreshKey, tick]);

  const indexing = status?.state === "indexing";
  useEffect(() => {
    if (!indexing) return;
    const timer = window.setTimeout(() => setTick((value) => value + 1), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [indexing, status]);

  const reindex = useCallback(
    async (force = false) => {
      if (!threadId) return;
      setBusy(true);
      try {
        const result = await runtime.request("rag/index", { threadId, force });
        setSnapshot({ threadId, result });
        setError(null);
      } catch (reason) {
        setError(message(reason));
      } finally {
        setBusy(false);
      }
    },
    [runtime, threadId],
  );

  const byPath = useMemo(
    () =>
      status
        ? new Map(status.documents.map((document) => [document.path, document.status]))
        : EMPTY,
    [status],
  );

  return {
    status,
    byPath,
    busy,
    error,
    reindex,
  };
}
