import { Sparkles } from "lucide-react";
import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import styles from "./EffortSlider.module.css";

/**
 * The two effort levels every model is offered, whatever its provider:
 * Low (faster) and Medium (smarter). The server maps them onto each
 * provider's own reasoning controls (core/providers/reasoning.py).
 */
export const EFFORT_LEVELS = ["low", "medium"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

const LEVEL_NAMES: Record<EffortLevel, string> = { low: "Fast", medium: "Smart" };

/** Older Sessions may carry other efforts; show them at the nearest stop. */
export function toEffortLevel(effort: string | null | undefined): EffortLevel {
  return effort === "medium" || effort === "high" || effort === "xhigh" || effort === "max"
    ? "medium"
    : "low";
}

interface EffortSliderProps {
  value: EffortLevel;
  disabled?: boolean;
  onChange(level: EffortLevel): void;
}

/** A Faster ↔ Smarter slider; at the top stop its dots come alive. */
export function EffortSlider({ value, disabled, onChange }: EffortSliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const index = EFFORT_LEVELS.indexOf(value);
  const max = EFFORT_LEVELS.length - 1;

  const levelAt = (clientX: number): EffortLevel => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width === 0) return value;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return EFFORT_LEVELS[Math.round(ratio * max)];
  };

  const press = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture?.(event.pointerId);
    let current = levelAt(event.clientX);
    if (current !== value) onChange(current);
    const move = (moveEvent: globalThis.PointerEvent) => {
      const next = levelAt(moveEvent.clientX);
      if (next !== current) {
        current = next;
        onChange(next);
      }
    };
    const release = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", release);
      element.removeEventListener("pointercancel", release);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", release);
    element.addEventListener("pointercancel", release);
  };

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? -1
          : event.key === "End"
            ? max
            : event.key === "Home"
              ? -max
              : 0;
    if (!step) return;
    event.preventDefault();
    const next = EFFORT_LEVELS[Math.min(max, Math.max(0, index + step))];
    if (next !== value) onChange(next);
  };

  const atMax = index === max;
  const percent = (index / max) * 100;
  return (
    <div className={styles.root} data-disabled={disabled || undefined} data-max={atMax || undefined}>
      <div className={styles.header}>
        <span className={styles.title}>Effort</span>
        <span className={styles.level} data-max={atMax || undefined}>
          {atMax ? <Sparkles size={11} aria-hidden="true" /> : null}
          {LEVEL_NAMES[value]}
        </span>
      </div>
      <div
        ref={track}
        className={styles.track}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Effort"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={index}
        aria-valuetext={value === "low" ? "Low: faster" : "Medium: smarter"}
        aria-disabled={disabled || undefined}
        data-max={atMax || undefined}
        onPointerDown={press}
        onKeyDown={key}
      >
        <span className={styles.rail}>
          <span className={styles.fill} style={{ width: `${percent}%` }} />
          {EFFORT_LEVELS.map((level, stop) => (
            <span
              key={level}
              className={styles.stop}
              style={{ left: `${(stop / max) * 100}%` }}
            />
          ))}
        </span>
        <span className={styles.thumb} style={{ left: `${percent}%` }} />
      </div>
      <div className={styles.ends} aria-hidden="true">
        <span data-active={!atMax || undefined}>Faster</span>
        <span data-active={atMax || undefined}>Smarter</span>
      </div>
    </div>
  );
}
