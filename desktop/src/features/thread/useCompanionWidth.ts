import { useEffect, useState } from "react";

const KEY = "khai-agents.companion-width";
export const DEFAULT_COMPANION_WIDTH = 420;
export const MIN_COMPANION_WIDTH = 280;

function readWidth(): number {
  try {
    const value = Number(localStorage.getItem(KEY));
    return Number.isFinite(value) && value >= MIN_COMPANION_WIDTH ? value : DEFAULT_COMPANION_WIDTH;
  } catch {
    return DEFAULT_COMPANION_WIDTH;
  }
}

/** Remember the companion pane width independently of the Review pane. */
export function useCompanionWidth() {
  const [width, setWidth] = useState(readWidth);
  useEffect(() => {
    try { localStorage.setItem(KEY, String(width)); } catch { /* remembering is optional */ }
  }, [width]);
  return [width, setWidth] as const;
}
