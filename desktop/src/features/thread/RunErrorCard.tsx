import {
  AlertTriangle,
  Check,
  ChevronDown,
  CloudOff,
  Copy,
  Gauge,
  KeyRound,
  PlugZap,
  RotateCcw,
  SearchX,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import type { RunErrorKind, RunErrorView } from "./runErrors";
import styles from "./RunErrorCard.module.css";

const ICONS: Record<RunErrorKind, LucideIcon> = {
  overloaded: CloudOff,
  rate_limited: Gauge,
  quota: Gauge,
  auth: KeyRound,
  not_found: SearchX,
  context: ScrollText,
  network: PlugZap,
  restarted: RotateCcw,
  unknown: AlertTriangle,
};

interface RunErrorCardProps {
  error: RunErrorView;
  busy: boolean;
  onRetry?: () => void;
}

/** Why a turn failed, in plain words, with the provider's message on demand. */
export function RunErrorCard({ error, busy, onRetry }: RunErrorCardProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const Icon = ICONS[error.kind];
  const transient = ["overloaded", "rate_limited", "network", "restarted"].includes(error.kind);

  const copy = () => {
    void navigator.clipboard?.writeText(error.raw).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className={styles.card} role="alert" data-tone={transient ? "warning" : "danger"}>
      <span className={styles.icon} aria-hidden="true">
        <Icon size={16} strokeWidth={2} />
      </span>
      <div className={styles.body}>
        <div className={styles.titleRow}>
          <strong>{error.title}</strong>
          {error.code ? <code className={styles.code}>{error.code}</code> : null}
        </div>
        <p className={styles.hint}>{error.hint}</p>
        {open && error.detail ? <p className={styles.detail}>{error.detail}</p> : null}
        <div className={styles.actions}>
          {onRetry ? (
            <button type="button" className={styles.primary} onClick={onRetry} disabled={busy}>
              <RotateCcw size={13} />
              Retry
            </button>
          ) : null}
          {error.detail ? (
            <button
              type="button"
              className={styles.ghost}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? "Hide details" : "Details"}
              <ChevronDown size={13} data-open={open || undefined} className={styles.chevron} />
            </button>
          ) : null}
          <button type="button" className={styles.ghost} onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
