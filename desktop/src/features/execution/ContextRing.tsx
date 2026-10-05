import { useEffect, useRef, useState } from "react";

import {
  MOCK_CONTEXT_USED_TOKENS,
  MOCK_USAGE_LIMITS,
  percent,
} from "../../mocks/preview";
import styles from "./ContextRing.module.css";

interface ContextRingProps {
  /** The thread's context cap, or null when the model's own window applies. */
  contextWindow: number | null;
  onOpenUsage?: () => void;
}

/**
 * Context-usage ring beside the model picker, with a popover of context and
 * provider limits. The numbers are preview data until the App Server reports
 * token usage (see src/mocks/preview.ts).
 */
export function ContextRing({ contextWindow, onOpenUsage }: ContextRingProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const used = MOCK_CONTEXT_USED_TOKENS;
  const share = contextWindow ? percent(used, contextWindow) : 0;

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

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.ring}
        style={{ "--share": `${share}%` } as React.CSSProperties}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Context usage"
        title="Context usage"
      />
      {open ? (
        <section className={styles.popover} role="dialog" aria-label="Usage">
          <div className={styles.row}>
            <span>Context window</span>
            <span>
              {formatTokens(used)}
              {contextWindow ? ` / ${formatTokens(contextWindow)}` : ""}
            </span>
          </div>
          <Bar value={share} />
          <hr />
          <button
            type="button"
            className={styles.heading}
            onClick={() => {
              setOpen(false);
              onOpenUsage?.();
            }}
          >
            Provider limits <em>Preview</em>
            <span aria-hidden="true">→</span>
          </button>
          {MOCK_USAGE_LIMITS.map((limit) => (
            <div key={limit.label}>
              <div className={styles.row}>
                <strong>{limit.label}</strong>
                <span>
                  {limit.detail} · {percent(limit.used, limit.total)}%
                </span>
              </div>
              <Bar value={percent(limit.used, limit.total)} />
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function Bar({ value }: { value: number }) {
  return (
    <div className={styles.bar}>
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}
