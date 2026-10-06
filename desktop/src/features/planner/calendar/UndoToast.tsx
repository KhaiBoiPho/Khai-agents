/**
 * The status toast. A delete is applied at once and offered back here for a
 * few seconds (Yuvomi's scheduleUndoableDelete); Ctrl/Cmd+Z works while the
 * toast is up.
 */

import { RotateCcw, X } from "lucide-react";
import { useEffect } from "react";

import styles from "./CalendarPage.module.css";

export interface ToastState {
  id: number;
  message: string;
  undo?: () => void;
}

const UNDO_MS = 6000;
const PLAIN_MS = 2800;

export function UndoToast({ toast, onDone }: { toast: ToastState; onDone(): void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, toast.undo ? UNDO_MS : PLAIN_MS);
    const key = (event: KeyboardEvent) => {
      if (!toast.undo || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      toast.undo();
      onDone();
    };
    window.addEventListener("keydown", key);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", key);
    };
  }, [toast, onDone]);

  return (
    <div className={styles.toast} role="status" aria-live="polite" key={toast.id}>
      <span>{toast.message}</span>
      {toast.undo ? (
        <button
          type="button"
          className={styles.toastUndo}
          onClick={() => {
            toast.undo?.();
            onDone();
          }}
        >
          <RotateCcw size={13} /> Undo
        </button>
      ) : null}
      <button type="button" className={styles.iconButton} aria-label="Dismiss" onClick={onDone}>
        <X size={14} />
      </button>
    </div>
  );
}
