import { useState, type PointerEvent as ReactPointerEvent } from "react";

import { DEFAULT_REVIEW_WIDTH, MIN_REVIEW_WIDTH } from "./useReviewWidth";

import styles from "./ReviewResizer.module.css";

/** What the conversation keeps, at least, beside the panel. */
const MIN_CONVERSATION = 460;

function clamp(width: number, sidebarWidth: number): number {
  const max = Math.max(MIN_REVIEW_WIDTH, window.innerWidth - sidebarWidth - MIN_CONVERSATION);
  return Math.round(Math.min(max, Math.max(MIN_REVIEW_WIDTH, width)));
}

const WIDTH_PROPERTY = "--review-width";

/** The nearest ancestor that sets the panel width inline (the app shell). */
function widthHost(handle: HTMLElement): HTMLElement | null {
  for (let element = handle.parentElement; element; element = element.parentElement) {
    if (element.style.getPropertyValue(WIDTH_PROPERTY)) return element;
  }
  return null;
}

interface ReviewResizerProps {
  width: number;
  sidebarWidth: number;
  onResize(width: number): void;
}

/**
 * The drag handle on the panel's left edge, as in Claude Desktop: drag to
 * resize, double-click to restore the default, arrow keys for fine steps.
 */
export function ReviewResizer({ width, sidebarWidth, onResize }: ReviewResizerProps) {
  const [dragging, setDragging] = useState(false);

  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
    // While dragging, paint the width straight onto the shell's custom
    // property instead of re-rendering the app on every pointermove; the
    // final width is committed to state (and storage) once, on release.
    const handle = event.currentTarget;
    const host = widthHost(handle);
    let pending: number | null = null;
    const move = (moveEvent: PointerEvent) => {
      const next = clamp(window.innerWidth - moveEvent.clientX, sidebarWidth);
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
      aria-label="Resize review panel"
      aria-valuenow={width}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={start}
      onDoubleClick={() => onResize(clamp(DEFAULT_REVIEW_WIDTH, sidebarWidth))}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 16;
        if (event.key === "ArrowLeft") onResize(clamp(width + step, sidebarWidth));
        else if (event.key === "ArrowRight") onResize(clamp(width - step, sidebarWidth));
        else return;
        event.preventDefault();
      }}
    />
  );
}
