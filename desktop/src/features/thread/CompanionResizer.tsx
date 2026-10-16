import { useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { DEFAULT_COMPANION_WIDTH, MIN_COMPANION_WIDTH } from "./useCompanionWidth";
import styles from "./CompanionResizer.module.css";

/** What the main chat keeps, at least, beside the panel (as for Review). */
const MIN_CHAT_WIDTH = 460;

function clamp(width: number, available: number): number {
  // No fixed ceiling: like the Review panel, the companion can take all the
  // room the main chat does not need.
  const max = Math.max(MIN_COMPANION_WIDTH, available - MIN_CHAT_WIDTH);
  return Math.round(Math.min(max, Math.max(MIN_COMPANION_WIDTH, width)));
}

interface Props {
  width: number;
  onResize(width: number): void;
}

export function CompanionResizer({ width, onResize }: Props) {
  const [dragging, setDragging] = useState(false);

  const reset = (handle: HTMLElement) => {
    const host = handle.closest<HTMLElement>("[data-workspace-shell='true']");
    onResize(clamp(DEFAULT_COMPANION_WIDTH, host?.clientWidth ?? DEFAULT_COMPANION_WIDTH + MIN_CHAT_WIDTH));
  };

  const resizeByKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const host = event.currentTarget.closest<HTMLElement>("[data-workspace-shell='true']");
    const max = host ? clamp(Number.POSITIVE_INFINITY, host.clientWidth) : width + step;
    if (event.key === "ArrowLeft") onResize(Math.min(max, width + step));
    else if (event.key === "ArrowRight") onResize(Math.max(MIN_COMPANION_WIDTH, width - step));
    else return;
    event.preventDefault();
  };

  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
    const handle = event.currentTarget;
    const host = handle.closest<HTMLElement>("[data-workspace-shell='true']");
    if (!host) { setDragging(false); return; }
    let pending: number | null = null;
    const move = (moveEvent: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const next = clamp(rect.right - moveEvent.clientX, rect.width);
      pending = next;
      host.style.setProperty("--companion-width", `${next}px`);
      handle.setAttribute("aria-valuenow", String(next));
    };
    const stop = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      host.style.removeProperty("--companion-width");
      if (pending !== null) onResize(pending);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  return <div
    className={styles.handle}
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize companion panel"
    aria-valuemin={MIN_COMPANION_WIDTH}
    aria-valuenow={width}
    tabIndex={0}
    data-dragging={dragging || undefined}
    onPointerDown={start}
    onDoubleClick={(event) => reset(event.currentTarget)}
    onKeyDown={resizeByKeyboard}
  />;
}
