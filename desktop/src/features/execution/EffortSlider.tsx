import { useState } from "react";

import { ThinkingDepthSelector } from "./effort/ThinkingDepthSelector";
import type { ThinkingLevel } from "./effort/useThinkingDepthSelector";

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
  low: "Fast",
  medium: "Medium",
  high: "Smart",
};

const DESCRIPTIONS: Record<ThinkingLevel, string> = {
  low: "Answers quickly with light reasoning. Good for everyday work.",
  medium: "Balanced depth for most tasks.",
  high: "Thinks longer before answering: better on hard problems, slower and costs more.",
};

/**
 * The selector's middle stop is a placeholder: it runs exactly like Fast
 * ("low") and only remembers that the user picked it, so the thumb stays.
 */
const MIDDLE_KEY = "khai.effort.middle";

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

/** Faster ↔ Smarter effort, drawn by Auraxis's ember rail. */
export function EffortSlider({ value, disabled, onChange }: EffortSliderProps) {
  const [middle, setMiddle] = useState(readMiddle);
  const level: ThinkingLevel = value === "medium" ? "high" : middle ? "medium" : "low";

  const change = (next: ThinkingLevel) => {
    const onMiddle = next === "medium";
    setMiddle(onMiddle);
    writeMiddle(onMiddle);
    const effort: EffortLevel = next === "high" ? "medium" : "low";
    if (effort !== value) onChange(effort);
  };

  return (
    <div style={{ padding: "8px 6px 10px" }}>
      <ThinkingDepthSelector
        value={level}
        labels={LABELS}
        ariaLabel="Effort"
        title="Effort"
        description={DESCRIPTIONS[level]}
        disabled={disabled}
        onChange={change}
      />
    </div>
  );
}
