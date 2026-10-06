import { ChevronRight, Shrink, TriangleAlert } from "lucide-react";
import { useState } from "react";

import type { CompactionEntry } from "../../app/workspaceState";
import { LoadingDots, PopIn, ShimmerText } from "../../components/Motion";
import { formatTokens } from "../execution/contextFormat";
import { MarkdownContent } from "./MarkdownContent";
import styles from "./CompactionNotice.module.css";

/** One `/compact` in the timeline: running, finished with its summary, or failed. */
export function CompactionNotice({ entry }: { entry: CompactionEntry }) {
  const [expanded, setExpanded] = useState(false);

  if (entry.status === "running") {
    return (
      <div className={styles.notice} role="status" data-status="running">
        <Shrink size={14} aria-hidden="true" className={styles.icon} />
        <ShimmerText>Compacting conversation</ShimmerText>
        <LoadingDots className={styles.dots} />
        {entry.instructions ? (
          <span className={styles.focus}>· focus: {entry.instructions}</span>
        ) : null}
      </div>
    );
  }

  if (entry.status === "failed") {
    return (
      <div className={styles.notice} role="status" data-status="failed">
        <TriangleAlert size={14} aria-hidden="true" className={styles.icon} />
        <span>Compaction failed · {entry.message ?? "the conversation is unchanged"}</span>
      </div>
    );
  }

  const figures =
    entry.tokensBefore !== null && entry.tokensAfter !== null
      ? ` · ${formatTokens(entry.tokensBefore)} → ${formatTokens(entry.tokensAfter)} tokens`
      : "";
  return (
    <div className={styles.block} data-status="done">
      <button
        type="button"
        className={styles.notice}
        aria-expanded={entry.summary ? expanded : undefined}
        disabled={!entry.summary}
        onClick={() => setExpanded((current) => !current)}
      >
        <PopIn>
          <Shrink size={14} aria-hidden="true" className={styles.icon} />
        </PopIn>
        <span>
          Conversation compacted{figures}
        </span>
        {entry.summary ? (
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={styles.chevron}
            data-open={expanded || undefined}
          />
        ) : null}
      </button>
      {expanded && entry.summary ? (
        <div className={styles.summary}>
          {entry.instructions ? (
            <p className={styles.focusLine}>Focus: {entry.instructions}</p>
          ) : null}
          <MarkdownContent compact>{entry.summary}</MarkdownContent>
        </div>
      ) : null}
    </div>
  );
}
