/**
 * A native modal <dialog> whose Escape and backdrop press go through the
 * caller (so the editor can ask before discarding), and through the app's
 * escape-layer stack so Escape closes exactly one thing.
 */

import { useEffect, useRef, type ReactNode } from "react";

import { useEscapeLayer } from "../../../app/escapeLayer";
import styles from "./EventEditor.module.css";

interface DialogProps {
  label: string;
  onDismiss(): void;
  className?: string;
  children: ReactNode;
}

export function Dialog({ label, onDismiss, className, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEscapeLayer(onDismiss);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${className ?? ""}`}
      aria-label={label}
      // The escape layer owns Escape; the native cancel would close behind its back.
      onCancel={(event) => event.preventDefault()}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      {children}
    </dialog>
  );
}
