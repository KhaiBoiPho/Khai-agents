import { useState, type PointerEvent as ReactPointerEvent } from "react";

import { DEFAULT_REVIEW_WIDTH, MIN_REVIEW_WIDTH } from "./useReviewWidth";

import styles from "./ReviewResizer.module.css";

/** What the conversation keeps, at least, beside the panel. */
const MIN_CONVERSATION = 460;

function clamp(width: number, sidebarWidth: number): number {
  const max = Math.max(MIN_REVIEW_WIDTH, window.innerWidth - sidebarWidth - MIN_CONVERSATION);
  return Math.round(Math.min(max, Math.max(MIN_REVIEW_WIDTH, width)));
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
    const move = (moveEvent: PointerEvent) =>
      onResize(clamp(window.innerWidth - moveEvent.clientX, sidebarWidth));
    const stop = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
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
