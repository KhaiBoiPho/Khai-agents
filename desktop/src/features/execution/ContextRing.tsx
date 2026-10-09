import { useEffect, useRef, useState } from "react";

import type { ContextUsage } from "../../app/workspaceState";
import { LoadingDots } from "../../components/Motion";
import type { Thread } from "../../generated/app-server";
import type { RpcTransport } from "../../rpc/contracts";
import { contextShare, formatTokens } from "./contextFormat";
import styles from "./ContextRing.module.css";

interface ContextRingProps {
  runtime: RpcTransport;
  thread: Thread | null;
  /** Latest measured fill of the thread's context, or null before any reply. */
  usage: ContextUsage | null;
  compacting: boolean;
  /** False while a Turn runs: the runner owns the history then. */
  canCompact: boolean;
  onCompact?: () => void;
  onOpenUsage?: () => void;
}

/** Share of the window at which the popover starts recommending `/compact`. */
const COMPACT_HINT_SHARE = 70;

/**
 * Context-usage ring beside the model picker. It shows how much of the
 * model's context window the open thread's conversation fills — the
 * provider's own prompt count for the latest reply, or an estimate right
 * after a compaction — with a popover to compact.
 */
export function ContextRing({
  runtime,
  thread,
  usage,
  compacting,
  canCompact,
  onCompact,
  onOpenUsage,
}: ContextRingProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const contextWindow = useContextWindow(runtime, thread);
  const used = usage?.usedTokens ?? 0;
  const share = contextWindow ? contextShare(used, contextWindow) : 0;
  const label = usage
    ? contextWindow
      ? `Context ${formatTokens(used)} of ${formatTokens(contextWindow)} tokens (${share}%)`
      : `Context ${formatTokens(used)} tokens`
    : "Context usage";

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const compactDisabled = !thread || !onCompact || compacting || !canCompact || !usage;

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.ring}
        data-level={share >= 90 ? "full" : share >= COMPACT_HINT_SHARE ? "high" : undefined}
        data-compacting={compacting || undefined}
        style={{ "--share": `${share}%` } as React.CSSProperties}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
      />
      {open ? (
        <section className={styles.popover} role="dialog" aria-label="Context usage">
          <div className={styles.row}>
            <strong>Context window</strong>
            <span>
              {usage ? formatTokens(used) : "—"}
              {contextWindow ? ` / ${formatTokens(contextWindow)}` : ""}
              {usage && contextWindow ? ` · ${share}%` : ""}
            </span>
          </div>
          <Bar value={share} />
          <p className={styles.note}>
            {!usage
              ? "Filled in after the first reply in this conversation."
              : usage.source === "estimate"
                ? "Estimated after compaction; the next reply reports the exact count."
                : "As reported by the model for its latest request."}
          </p>
          {usage && share >= COMPACT_HINT_SHARE ? (
            <p className={styles.hint}>
              The conversation is filling the window. Compact it to keep long
              work going; it also compacts automatically near the limit.
            </p>
          ) : null}
          <button
            type="button"
            className={styles.compact}
            disabled={compactDisabled}
            onClick={() => {
              setOpen(false);
              onCompact?.();
            }}
            title={
              canCompact
                ? "Summarize older turns into a short handoff to free context"
                : "Available when the current reply finishes"
            }
          >
            {compacting ? (
              <>
                Compacting <LoadingDots />
              </>
            ) : (
              "Compact conversation"
            )}
          </button>
          <small className={styles.tip}>
            Tip: <code>/compact focus on …</code> tells the summary what to keep.
          </small>
          <hr />
          <ApiSpend runtime={runtime} thread={thread} />
          {onOpenUsage ? (
            <>
              <hr />
              <button
                type="button"
                className={styles.heading}
                onClick={() => {
                  setOpen(false);
                  onOpenUsage();
                }}
              >
                Token usage
                <span aria-hidden="true">→</span>
              </button>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

interface Spend {
  /** Everything this Khai-Agents account has spent, since it was created. */
  accountUsd: number;
  unpricedRequests: number;
  /** The OpenRouter account's lifetime spend, when the chat uses OpenRouter. */
  openRouterUsd: number | null;
}

/** API money spent: by this account here, and on the OpenRouter account. */
function ApiSpend({ runtime, thread }: { runtime: RpcTransport; thread: Thread | null }) {
  const [spend, setSpend] = useState<Spend | null>(null);
  const threadId = thread?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const summary = await runtime
        .request("usage/summary", {
          days: 1,
          utcOffsetMinutes: -new Date().getTimezoneOffset(),
        })
        .catch(() => null);
      const connectionId = threadId
        ? ((await runtime.request("thread/execution/read", { threadId }).catch(() => null))
            ?.executionProfile.connectionId ?? null)
        : null;
      const balance = connectionId
        ? await runtime.request("provider/balance", { connectionId }).catch(() => null)
        : null;
      if (cancelled || !summary) return;
      setSpend({
        accountUsd: summary.allTime.costUsd,
        unpricedRequests: summary.allTime.unpricedRequests,
        openRouterUsd: balance?.supported ? (balance.totalUsage ?? null) : null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [runtime, threadId]);

  return (
    <>
      <div className={styles.row}>
        <strong>API spend</strong>
      </div>
      <div className={styles.row}>
        <span>This account, since it was created</span>
        <strong>{spend ? usd(spend.accountUsd) : "—"}</strong>
      </div>
      {spend?.openRouterUsd != null ? (
        <div className={styles.row}>
          <span>OpenRouter account, all time</span>
          <strong>{usd(spend.openRouterUsd)}</strong>
        </div>
      ) : null}
      {spend && spend.unpricedRequests > 0 ? (
        <p className={styles.note}>
          {spend.unpricedRequests} model calls have no known price and are not counted.
        </p>
      ) : null}
    </>
  );
}

function usd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/**
 * The effective window for the thread's current selection: the user's cap
 * when set, otherwise the model's published window. Re-resolved whenever the
 * selection changes, so a model switch updates the ring before the next Turn.
 */
function useContextWindow(runtime: RpcTransport, thread: Thread | null): number | null {
  const [resolved, setResolved] = useState<{ key: string; window: number } | null>(
    null,
  );
  const threadId = thread?.id ?? null;
  const key = thread
    ? `${thread.id}|${thread.connectionId ?? ""}|${thread.model ?? ""}|${thread.contextWindow ?? ""}`
    : "";
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    runtime
      .request("thread/execution/read", { threadId })
      .then((result) => {
        if (!cancelled) {
          setResolved({ key, window: result.executionProfile.contextWindow });
        }
      })
      .catch(() => {
        // No usable connection yet: fall back to the explicit cap, if any.
      });
    return () => {
      cancelled = true;
    };
  }, [key, runtime, threadId]);
  if (resolved && resolved.key === key) return resolved.window;
  return thread?.contextWindow ?? null;
}

function Bar({ value }: { value: number }) {
  return (
    <div className={styles.bar}>
      <span style={{ width: `${value}%` }} />
    </div>
  );
}
