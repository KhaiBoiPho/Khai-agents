import { HelpCircle } from "lucide-react";
import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import styles from "./EffortSlider.module.css";

/**
 * The two effort levels every model is offered, whatever its provider:
 * Low (faster) and Medium (smarter). The server maps them onto each
 * provider's own reasoning controls (core/providers/reasoning.py).
 */
export const EFFORT_LEVELS = ["low", "medium"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * The slider's three stops. The middle one is a placeholder for a future
 * level: it runs exactly like Fast ("low") and only remembers that the user
 * picked it, so the thumb stays there.
 */
const STOPS = [
  { name: "Fast", effort: "low" },
  { name: "Medium", effort: "low" },
  { name: "Smart", effort: "medium" },
] as const satisfies ReadonlyArray<{ name: string; effort: EffortLevel }>;
const MIDDLE = 1;
const LAST = STOPS.length - 1;
/** The stop marked "Recommended". */
const RECOMMENDED = MIDDLE;
const MIDDLE_KEY = "khai.effort.middle";

/** Older Sessions may carry other efforts; show them at the nearest stop. */
export function toEffortLevel(effort: string | null | undefined): EffortLevel {
  return effort === "medium" || effort === "high" || effort === "xhigh" || effort === "max"
    ? "medium"
    : "low";
}

function readMiddle(): boolean {
  try {
    return localStorage.getItem(MIDDLE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMiddle(on: boolean): void {
  try {
    localStorage.setItem(MIDDLE_KEY, on ? "1" : "0");
  } catch {
    // Storage can be unavailable; the stop then lasts for this page.
  }
}

interface EffortSliderProps {
  value: EffortLevel;
  disabled?: boolean;
  onChange(level: EffortLevel): void;
}

/** A Faster ↔ Smarter slider over a field of dots, like Claude's. */
export function EffortSlider({ value, disabled, onChange }: EffortSliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const [middle, setMiddle] = useState(readMiddle);
  const index = value === "medium" ? LAST : middle ? MIDDLE : 0;

  const select = (stop: number) => {
    if (stop === index) return;
    const onMiddle = stop === MIDDLE;
    setMiddle(onMiddle);
    writeMiddle(onMiddle);
    const effort = STOPS[stop].effort;
    if (effort !== value) onChange(effort);
  };

  const stopAt = (clientX: number): number => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width === 0) return index;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return Math.round(ratio * LAST);
  };

  const press = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture?.(event.pointerId);
    let current = stopAt(event.clientX);
    select(current);
    const move = (moveEvent: globalThis.PointerEvent) => {
      const next = stopAt(moveEvent.clientX);
      if (next !== current) {
        current = next;
        select(next);
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
    const target =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? index + 1
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? index - 1
          : event.key === "End"
            ? LAST
            : event.key === "Home"
              ? 0
              : null;
    if (target === null) return;
    event.preventDefault();
    select(Math.min(LAST, Math.max(0, target)));
  };

  const percent = (index / LAST) * 100;
  const atMax = index === LAST;
  return (
    <div
      className={styles.root}
      data-disabled={disabled || undefined}
      data-max={atMax || undefined}
    >
      <div className={styles.header}>
        <span className={styles.title}>Effort</span>
        <span className={styles.level}>{STOPS[index].name}</span>
        <span
          className={styles.help}
          title={
            "Faster answers quickly with light reasoning. Smarter thinks longer " +
            "before answering: better on hard problems, slower and costs more."
          }
          aria-label="About effort"
        >
          <HelpCircle size={14} />
        </span>
      </div>
      <div className={styles.ends} aria-hidden="true">
        <span data-active={index < LAST || undefined}>Faster</span>
        <span data-active={atMax || undefined}>Smarter</span>
      </div>
      <div
        ref={track}
        className={styles.track}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Effort"
        aria-valuemin={0}
        aria-valuemax={LAST}
        aria-valuenow={index}
        aria-valuetext={STOPS[index].name}
        aria-disabled={disabled || undefined}
        onPointerDown={press}
        onKeyDown={key}
      >
        <span className={styles.dots} />
        <span className={styles.lit} style={{ width: `${percent}%` }} />
        <span
          className={styles.thumb}
          style={
            {
              left: `${percent}%`,
              "--shift": index === 0 ? "0%" : atMax ? "-100%" : "-50%",
            } as CSSProperties
          }
        />
      </div>
      <div className={styles.marks} aria-hidden="true">
        <span style={{ left: `${(RECOMMENDED / LAST) * 100}%` }}>Recommended</span>
      </div>
    </div>
  );
}
