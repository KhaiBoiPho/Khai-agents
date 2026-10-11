import { useSyncExternalStore } from "react";

import { ThinkingDepthSelector } from "./effort/ThinkingDepthSelector";
import {
  THINKING_LEVELS,
  THINKING_MAX_LEVEL,
  type ThinkingLevel,
} from "./effort/useThinkingDepthSelector";

/**
 * The two effort levels every model is offered, whatever its provider:
 * Low (faster) and Medium (smarter). The server maps them onto each
 * provider's own reasoning controls (core/providers/reasoning.py).
 */
export const EFFORT_LEVELS = ["low", "medium"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** Older Sessions may carry other efforts; show them at the nearest stop. */
export function toEffortLevel(effort: string | null | undefined): EffortLevel {
  return effort === "medium" || effort === "high" || effort === "xhigh" || effort === "max"
    ? "medium"
    : "low";
}

const LABELS: Record<ThinkingLevel, string> = {
  fast: "Fast",
  light: "Light",
  balanced: "Balanced",
  medium: "Medium",
  deep: "Deep",
  smart: "Smart",
};

const DESCRIPTIONS: Record<ThinkingLevel, string> = {
  fast: "Answers right away with light reasoning.",
  light: "Quick answers with a little more care.",
  balanced: "A balance of speed and depth for everyday work.",
  medium: "Balanced depth for most tasks.",
  deep: "Takes more time on harder questions.",
  smart: "Thinks longer before answering: best on hard problems, slower and costs more.",
};

const HELP =
  "How long the model thinks before answering. Faster settings reply sooner; " +
  "Smarter ones reason longer on hard problems and cost more.";

/**
 * Only the last stop changes what is sent ("medium" effort); the five before
 * it are placeholders that all run as "low". The chosen stop is remembered
 * here so the rail and the composer's Effort chip agree and survive reloads.
 */
const STOP_KEY = "khai.effort.stop";
const SMART = THINKING_MAX_LEVEL;
const listeners = new Set<() => void>();

function readStop(): number {
  try {
    const value = Number(localStorage.getItem(STOP_KEY));
    return Number.isInteger(value) && value >= 0 && value < SMART ? value : 0;
  } catch {
    return 0;
  }
}

let stop = readStop();

function setStop(next: number): void {
  if (next === SMART || next === stop) return;
  stop = next;
  try {
    localStorage.setItem(STOP_KEY, String(next));
  } catch {
    // Storage can be unavailable; the stop then lasts for this page.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The stop shown for `value`: Smart when it runs "medium", else the remembered one. */
function useStop(value: EffortLevel): ThinkingLevel {
  const remembered = useSyncExternalStore(subscribe, () => stop);
  return THINKING_LEVELS[value === "medium" ? SMART : remembered];
}

/** The Effort chip's text for the session's current effort. */
export function useEffortLabel(value: EffortLevel): string {
  return LABELS[useStop(value)];
}

interface EffortSliderProps {
  value: EffortLevel;
  disabled?: boolean;
  onChange(level: EffortLevel): void;
}

/** Faster ↔ Smarter effort, drawn by Auraxis's ember rail. */
export function EffortSlider({ value, disabled, onChange }: EffortSliderProps) {
  const level = useStop(value);

  const change = (next: ThinkingLevel) => {
    const index = THINKING_LEVELS.indexOf(next);
    setStop(index);
    const effort: EffortLevel = index === SMART ? "medium" : "low";
    if (effort !== value) onChange(effort);
  };

  return (
    <ThinkingDepthSelector
      value={level}
      labels={LABELS}
      ariaLabel="Effort"
      title="Effort"
      help={HELP}
      recommended="medium"
      description={DESCRIPTIONS[level]}
      disabled={disabled}
      onChange={change}
    />
  );
}
