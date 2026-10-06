/**
 * History — every question asked in this chat, newest last, with when it was
 * sent, how it ended and which model answered. Clicking one scrolls the
 * transcript to that turn. A selected activity ("Inspect details") still
 * shows its details above the list.
 */

import { CheckCircle2, CircleDashed, Clock3, XCircle } from "lucide-react";
import { useMemo } from "react";

import type { Item, Turn } from "../../generated/app-server";
import { DetailsPanel } from "./DetailsPanel";
import styles from "./HistoryPanel.module.css";

interface HistoryPanelProps {
  threadId: string | null;
  turns: Turn[];
  items: Item[];
  selected: Item | null;
  onSelectItem(itemId: string): void;
}

/** Drop what the composer appends to the typed prompt. */
function typedText(prompt: string): string {
  return prompt
    .split("\n\nAttached workspace context:")[0]
    .split("\n\nSearch the web with the available web-search tools")[0]
    .split("\n\nDeep research mode:")[0]
    .trim();
}

function when(turn: Turn): string {
  const stamp = turn.startedAt ?? turn.completedAt;
  if (!stamp) return "Queued";
  const date = new Date(stamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return date.toLocaleString(undefined, sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function StatusIcon({ status }: { status: Turn["status"] }) {
  if (status === "completed") return <CheckCircle2 size={14} className={styles.ok} />;
  if (status === "failed" || status === "interrupted") {
    return <XCircle size={14} className={styles.bad} />;
  }
  if (status === "queued") return <Clock3 size={14} className={styles.muted} />;
  return <CircleDashed size={14} className={styles.running} />;
}

export function HistoryPanel({
  threadId,
  turns,
  items,
  selected,
  onSelectItem,
}: HistoryPanelProps) {
  const history = useMemo(
    () =>
      turns
        .filter((turn) => turn.threadId === threadId && typedText(turn.prompt))
        .sort((left, right) => left.ordinal - right.ordinal),
    [threadId, turns],
  );

  const jump = (turnId: string) => {
    document
      .querySelector(`[data-turn-id="${CSS.escape(turnId)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className={styles.panel}>
      {selected ? (
        <section className={styles.selected}>
          <p className={styles.label}>Selected activity</p>
          <DetailsPanel selected={selected} items={items} onSelectItem={onSelectItem} />
        </section>
      ) : null}

      <header className={styles.header}>
        <h2>History</h2>
        <span>
          {history.length} {history.length === 1 ? "question" : "questions"}
        </span>
      </header>

      {history.length ? (
        <ol className={styles.list}>
          {history.map((turn, index) => (
            <li key={turn.id}>
              <button type="button" onClick={() => jump(turn.id)} title="Show in the chat">
                <span className={styles.index}>{index + 1}</span>
                <span className={styles.body}>
                  <span className={styles.prompt}>{typedText(turn.prompt)}</span>
                  <span className={styles.meta}>
                    <StatusIcon status={turn.status} />
                    {when(turn)}
                    {turn.executionProfile?.modelId ? (
                      <>
                        <i aria-hidden="true">·</i>
                        {turn.executionProfile.modelId.split("/").at(-1)}
                      </>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.empty}>No questions in this chat yet.</p>
      )}
    </div>
  );
}
