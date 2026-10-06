/** Shared formatting for context and token-usage figures. */

/** Percent of the window filled; at least 1 once anything is used. */
export function contextShare(used: number, total: number): number {
  if (!total || used <= 0) return 0;
  return Math.min(100, Math.max(1, Math.round((used / total) * 100)));
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${trimZero((value / 1_000_000).toFixed(1))}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`;
  if (value >= 1_000) return `${trimZero((value / 1_000).toFixed(1))}K`;
  return String(value);
}

function trimZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}
