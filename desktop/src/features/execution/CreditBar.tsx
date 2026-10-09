import { useEffect, useState } from "react";

import type { ProviderBalanceResult } from "../../generated/app-server";
import type { RpcTransport } from "../../rpc/contracts";
import styles from "./CreditBar.module.css";

interface CreditBarProps {
  runtime: RpcTransport;
  /** The conversation, when one is open: its connection and its cost. */
  threadId?: string | null;
  /** The connection a new chat would use, when no conversation is open. */
  connectionId?: string | null;
  /** Changes whenever a model response is recorded, to refresh the numbers. */
  refreshKey?: string | number | null;
}

interface Snapshot {
  key: string;
  balance: ProviderBalanceResult;
  chatCostUsd: number | null;
}

/** Below this many dollars left, the bar turns red. */
const LOW_BALANCE_USD = 1;

/**
 * The OpenRouter key's remaining credit, as a bar that shrinks as it is spent.
 *
 * Shown whenever the selected connection is OpenRouter, in every chat and on
 * a new one: the balance belongs to the key, not the conversation. It is
 * read from OpenRouter after each model response, so it always matches the
 * account, including spending elsewhere. An open conversation also shows
 * what it has cost so far.
 */
export function CreditBar({ runtime, threadId, connectionId, refreshKey }: CreditBarProps) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const key = `${threadId ?? ""}|${connectionId ?? ""}|${refreshKey ?? ""}`;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const connection = threadId
        ? ((await runtime
            .request("thread/execution/read", { threadId })
            .catch(() => null))?.executionProfile.connectionId ?? null)
        : (connectionId ?? null);
      const [balance, usage] = connection
        ? await Promise.all([
            runtime.request("provider/balance", { connectionId: connection }).catch(() => null),
            threadId
              ? runtime.request("thread/usage", { threadId }).catch(() => null)
              : Promise.resolve(null),
          ])
        : [null, null];
      if (cancelled) return;
      if (!balance?.supported) {
        setSnapshot(null);
        return;
      }
      const spent = usage?.connections
        .filter((entry) => entry.connectionId === connection)
        .reduce((sum, entry) => sum + entry.costUsd, 0);
      setSnapshot({ key, balance, chatCostUsd: usage ? (spent ?? 0) : null });
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId, key, runtime, threadId]);

  if (!snapshot) return null;
  const { balance, chatCostUsd } = snapshot;
  const remaining = balance.remainingUsd ?? null;
  // The bar's full width is what the key started with: the account's
  // credits, or the key's own limit when that is all OpenRouter reports.
  const total =
    balance.totalCredits ?? (remaining !== null ? remaining + (balance.totalUsage ?? 0) : null);
  const share =
    remaining !== null && total ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 100;
  const low = remaining !== null && remaining < LOW_BALANCE_USD;
  const details = [
    remaining !== null ? `OpenRouter credit left: ${usd(remaining)}` : null,
    balance.totalCredits != null && balance.totalUsage != null
      ? `Used ${usd(balance.totalUsage)} of ${usd(balance.totalCredits)} on this account`
      : null,
    balance.keyLimitRemaining != null
      ? `This key's own limit has ${usd(balance.keyLimitRemaining)} left`
      : null,
    chatCostUsd !== null ? `This chat so far: ${usd(chatCostUsd)}` : null,
    balance.error ? `Balance unavailable: ${balance.error}` : null,
  ].filter(Boolean);

  return (
    <div
      className={styles.bar}
      role="meter"
      aria-label="OpenRouter credit left"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share)}
      title={details.join("\n")}
      data-low={low || undefined}
    >
      <span className={styles.amount}>
        OpenRouter <strong>{remaining !== null ? usd(remaining) : "—"}</strong>
        {total ? ` / ${usd(total)}` : null}
      </span>
      <span className={styles.track}>
        <span className={styles.fill} style={{ width: `${share}%` }} />
      </span>
      {chatCostUsd !== null ? (
        <span className={styles.chat}>chat {usd(chatCostUsd)}</span>
      ) : null}
    </div>
  );
}

/** Dollars with enough digits for sub-cent model calls. */
function usd(value: number): string {
  if (value === 0) return "$0.00";
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
  if (Math.abs(value) < 100) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}
