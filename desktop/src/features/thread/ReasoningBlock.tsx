import { BrainCircuit, ChevronRight } from "lucide-react";
import { memo, useEffect, useState } from "react";

import { LoadingDots, ShimmerText } from "../../components/Motion";
import { decodeReasoningPayload } from "../../app/reasoningPayload";
import type { Item } from "../../generated/app-server";
import { MarkdownContent } from "./MarkdownContent";
import type { TranscriptMode } from "./transcriptMode";
import styles from "./ReasoningBlock.module.css";

interface ReasoningBlockProps {
  item: Item;
  mode: TranscriptMode;
  forceCollapsed?: boolean;
  forceOpen?: boolean;
}

interface DisclosureOverride {
  key: string;
  open: boolean;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}${remainder ? ` ${remainder} ${remainder === 1 ? "second" : "seconds"}` : ""}`;
}

function useReasoningDuration(
  stored: number | null,
  createdAt: string,
  updatedAt: string,
  active: boolean,
): number | null {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);

  if (stored !== null) return stored;
  const start = new Date(createdAt).getTime();
  const end = active ? now : new Date(updatedAt).getTime();
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, end - start)
    : null;
}

interface ReasoningTitleProps {
  active: boolean;
  effort: string;
  storedDurationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The "Thinking · 12 seconds" label. It owns the one-second ticker so only
 * this label re-renders while reasoning streams, not the block's Markdown.
 */
const ReasoningTitle = memo(function ReasoningTitle({
  active,
  effort,
  storedDurationMs,
  createdAt,
  updatedAt,
}: ReasoningTitleProps) {
  const duration = useReasoningDuration(storedDurationMs, createdAt, updatedAt, active);
  const durationLabel = duration === null ? null : formatDuration(duration);
  const title = active
    ? ["Thinking", effort !== "auto" ? effort : null, durationLabel]
        .filter(Boolean)
        .join(" · ")
      : durationLabel
      ? `Thought for ${durationLabel}`
      : "Thinking completed";
  return <ShimmerText active={active}>{title}</ShimmerText>;
});

export function ReasoningBlock({ item, mode, forceCollapsed = false, forceOpen = false }: ReasoningBlockProps) {
  const active = item.status === "in_progress";
  const payload = decodeReasoningPayload(item.payload);
  const effort = payload.effort ?? "auto";
  const summary = payload.summaryText;
  const trace = payload.traceText;
  const opaque = payload.availability === "opaque";
  const disclosureKey = `${item.id}:${item.status}:${mode}`;
  const [manualOverride, setManualOverride] =
    useState<DisclosureOverride | null>(null);
  const open = forceCollapsed
    ? false
    : forceOpen
      ? true
      : manualOverride?.key === disclosureKey
      ? manualOverride.open
      : active || mode === "verbose";

  return (
    <details
      className={styles.reasoning}
      data-active={active}
      data-status={item.status}
      open={open}
    >
      <summary
        onClick={(event) => {
          event.preventDefault();
          setManualOverride({ key: disclosureKey, open: !open });
        }}
      >
        {active ? (
          <LoadingDots className={styles.dots} />
        ) : (
          <BrainCircuit size={16} aria-hidden="true" />
        )}
        <span>
          <strong>
            <ReasoningTitle
              active={active}
              effort={effort}
              storedDurationMs={payload.durationMs}
              createdAt={item.createdAt}
              updatedAt={item.updatedAt}
            />
          </strong>
        </span>
        <ChevronRight className={styles.chevron} size={14} aria-hidden="true" />
      </summary>
      <div
        className={styles.content}
        aria-live={active ? "polite" : undefined}
      >
        {opaque && !summary && !trace ? (
          <p>This model completed reasoning without returning displayable details.</p>
        ) : null}
        {summary ? <MarkdownContent compact>{summary}</MarkdownContent> : null}
        {trace && (!summary || mode === "verbose") ? (
          <section className={styles.trace}>
            {summary ? <h4>Provider reasoning details</h4> : null}
            <MarkdownContent compact>{trace}</MarkdownContent>
          </section>
        ) : null}
        {trace && summary && mode === "normal" ? (
          <details className={styles.traceDisclosure}>
            <summary>Provider reasoning details</summary>
            <MarkdownContent compact>{trace}</MarkdownContent>
          </details>
        ) : null}
        {active && !summary && !trace ? (
          <p className={styles.waiting}>Waiting for reasoning details…</p>
        ) : null}
      </div>
    </details>
  );
}
