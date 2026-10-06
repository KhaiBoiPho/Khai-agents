import { useEffect, useState } from "react";

const KEY = "khai-agents.review-width";
export const DEFAULT_REVIEW_WIDTH = 640;
export const MIN_REVIEW_WIDTH = 320;

function readWidth(): number {
  try {
    const value = Number(localStorage.getItem(KEY));
    return Number.isFinite(value) && value >= MIN_REVIEW_WIDTH ? value : DEFAULT_REVIEW_WIDTH;
  } catch {
    return DEFAULT_REVIEW_WIDTH;
  }
}

/** The review panel's width, remembered across launches. */
export function useReviewWidth() {
  const [width, setWidth] = useState(readWidth);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(width));
    } catch {
      // Only the remembering is lost.
    }
  }, [width]);
  return [width, setWidth] as const;
}
