/**
 * A floating panel beside the element that opened it — the desktop form of
 * Yuvomi's detail view and filter sheet. Closes on Escape (innermost layer
 * only), on a press outside, and hands focus back to its opener.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useEscapeLayer } from "../../../app/escapeLayer";
import styles from "./CalendarPage.module.css";
import type { AnchorRect } from "./visuals";

const GAP = 8;
const MARGIN = 12;

/** Beside the anchor where there is room, else below it; always on screen. */
function place(anchor: AnchorRect | null, width: number, height: number, side: "beside" | "below"): CSSProperties {
  const vw = window.innerWidth || 1024;
  const vh = window.innerHeight || 768;
  if (!anchor) {
    return { left: Math.max(MARGIN, (vw - width) / 2), top: Math.max(MARGIN, (vh - height) / 3) };
  }
  let left: number;
  let top: number;
  if (side === "beside" && anchor.right + GAP + width <= vw - MARGIN) {
    left = anchor.right + GAP;
    top = anchor.top;
  } else if (side === "beside" && anchor.left - GAP - width >= MARGIN) {
    left = anchor.left - GAP - width;
    top = anchor.top;
  } else {
    left = Math.min(anchor.left, vw - MARGIN - width);
    top = anchor.bottom + GAP;
    if (top + height > vh - MARGIN && anchor.top - GAP - height >= MARGIN) top = anchor.top - GAP - height;
  }
  return {
    left: Math.max(MARGIN, left),
    top: Math.max(MARGIN, Math.min(top, vh - MARGIN - height)),
  };
}

interface PopoverProps {
  anchor: AnchorRect | null;
  onClose(): void;
  label: string;
  width?: number;
  side?: "beside" | "below";
  className?: string;
  /** Element to refocus on close; defaults to whatever had focus on open. */
  returnFocus?: HTMLElement | null;
  /** Presses on this element are left to it (a toggle button closes by itself). */
  trigger?: HTMLElement | null;
  children: ReactNode;
}

export function Popover({
  anchor,
  onClose,
  label,
  width = 340,
  side = "beside",
  className,
  returnFocus,
  trigger,
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const [opener] = useState<HTMLElement | null>(() =>
    returnFocus ?? (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null),
  );

  useEscapeLayer(onClose);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight || 240;
    setStyle({ ...place(anchor, width, height, side), width });
  }, [anchor, width, side]);

  useEffect(() => {
    const panel = ref.current;
    const first = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel;
    first?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel?.contains(target) || trigger?.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener, trigger]);

  return createPortal(
    <div
      ref={ref}
      className={`${styles.popover} ${className ?? ""}`}
      style={style}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
    >
      {children}
    </div>,
    document.body,
  );
}
