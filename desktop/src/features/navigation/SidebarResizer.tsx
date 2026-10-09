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

interface SidebarResizerProps {
  width: number;
  onResize(width: number): void;
}

export function SidebarResizer({ width, onResize }: SidebarResizerProps) {
  const [dragging, setDragging] = useState(false);

  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
    const move = (moveEvent: PointerEvent) => onResize(clamp(moveEvent.clientX));
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
