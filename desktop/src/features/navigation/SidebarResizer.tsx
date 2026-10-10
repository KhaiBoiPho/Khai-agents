import { useState, type PointerEvent as ReactPointerEvent } from "react";

import styles from "./SidebarResizer.module.css";

export const DEFAULT_SIDEBAR_WIDTH = 264;
export const MIN_SIDEBAR_WIDTH = 208;
export const MAX_SIDEBAR_WIDTH = 420;

function clamp(width: number): number {
  return Math.round(
    Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)),
  );
}

const WIDTH_PROPERTY = "--sidebar-width";

/** The nearest ancestor that sets the sidebar width inline (the app shell). */
function widthHost(handle: HTMLElement): HTMLElement | null {
  for (let element = handle.parentElement; element; element = element.parentElement) {
    if (element.style.getPropertyValue(WIDTH_PROPERTY)) return element;
  }
  return null;
}

interface SidebarResizerProps {
  width: number;
  onResize(width: number): void;
}

export function SidebarResizer({ width, onResize }: SidebarResizerProps) {
  const [dragging, setDragging] = useState(false);

  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
    // Like ReviewResizer: paint the width onto the shell's custom property
    // while dragging and commit it to state (and storage) once, on release,
    // instead of re-rendering the app on every pointermove.
    const handle = event.currentTarget;
    const host = widthHost(handle);
    let pending: number | null = null;
    const move = (moveEvent: PointerEvent) => {
      const next = clamp(moveEvent.clientX);
      if (!host) {
        onResize(next);
        return;
      }
      pending = next;
      host.style.setProperty(WIDTH_PROPERTY, `${next}px`);
      handle.setAttribute("aria-valuenow", String(next));
    };
    const stop = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      if (pending !== null) onResize(pending);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
    <div
      className={styles.handle}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={start}
      onDoubleClick={() => onResize(DEFAULT_SIDEBAR_WIDTH)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 16;
        if (event.key === "ArrowLeft") onResize(clamp(width - step));
        else if (event.key === "ArrowRight") onResize(clamp(width + step));
        else return;
        event.preventDefault();
      }}
    />
  );
}
