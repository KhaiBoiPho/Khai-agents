import { AlertTriangle, Archive, Trash2, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import styles from "./ConfirmDialog.module.css";

type Tone = "danger" | "neutral";

interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: Tone;
  /** Shown beside the title; defaults by tone. */
  icon?: "delete" | "archive" | "warning";
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

const ICONS: Record<NonNullable<ConfirmDialogProps["icon"]>, LucideIcon> = {
  delete: Trash2,
  archive: Archive,
  warning: AlertTriangle,
};

/**
 * A centred confirmation, as Claude asks before deleting a chat. Mounted to
 * open: it is a native modal <dialog>, so Escape cancels, focus is trapped
 * and starts on Cancel (the safe answer), and a click on the backdrop
 * dismisses it.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  tone = "neutral",
  icon,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const Icon = ICONS[icon ?? (tone === "danger" ? "delete" : "warning")];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    cancelRef.current?.focus();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      data-tone={tone}
      aria-labelledby="confirm-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> itself.
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className={styles.body}>
        <span className={styles.icon} aria-hidden="true">
          <Icon size={18} strokeWidth={1.9} />
        </span>
        <div className={styles.copy}>
          <h2 id="confirm-dialog-title">{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className={styles.actions}>
        <button type="button" ref={cancelRef} className={styles.cancel} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.confirm}
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
