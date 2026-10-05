/**
 * Placeholder data for UI that has no backend yet.
 *
 * Every export here stands in for a value the App Server does not provide.
 * Surfaces that read from this module show a "Preview" tag so the numbers are
 * never mistaken for real ones. When the backend lands, replace the export
 * with the real source and drop the tag at its call site.
 */

/** TODO(backend): current git branch of the thread's workspace. */
export const MOCK_GIT = {
  branch: "main",
} as const;

/** TODO(backend): tokens the thread's context currently holds. */
export const MOCK_CONTEXT_USED_TOKENS = 0;

export interface MockLimit {
  label: string;
  detail: string;
  used: number;
  total: number;
}

/** TODO(backend): provider rate-limit and quota usage per connection. */
export const MOCK_USAGE_LIMITS: readonly MockLimit[] = [
  { label: "Requests today", detail: "Resets at 00:00 UTC", used: 42, total: 1500 },
  { label: "Tokens per minute", detail: "Rolling window", used: 18_000, total: 250_000 },
];

/** TODO(backend): local profile; there is no account system yet. */
export const MOCK_ACCOUNT = {
  name: "Khai",
  email: "khai@local",
  plan: "Local",
} as const;

export function percent(used: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}
