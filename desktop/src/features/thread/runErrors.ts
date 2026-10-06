/**
 * Turns the raw provider failures a turn can end with — Python reprs such as
 * `Error: [{'error': {'code': 503, 'message': '…', 'status': 'UNAVAILABLE'}}]`
 * — into a short title, a plain explanation and the provider's own words.
 */

export type RunErrorKind =
  | "overloaded"
  | "rate_limited"
  | "quota"
  | "auth"
  | "not_found"
  | "context"
  | "network"
  | "restarted"
  | "unknown";

export interface RunErrorView {
  kind: RunErrorKind;
  title: string;
  hint: string;
  /** The provider's message, unwrapped from its JSON/repr envelope. */
  detail: string | null;
  /** HTTP-style code or provider status, e.g. "503 · UNAVAILABLE". */
  code: string | null;
  /** The text as received, for "Copy details". */
  raw: string;
}

/** Messages that say a turn failed without saying why. */
const GENERIC = /^agent stopped with reason: \w+$/i;

export function isGenericRunError(text: string): boolean {
  return GENERIC.test(text.trim());
}

/** An assistant reply that is really the provider's error echoed back. */
export function isProviderErrorText(text: string): boolean {
  return /^\s*Error:\s*[[{]/.test(text) || /^\s*Error code: \d{3}/.test(text);
}

function pick(text: string, key: string): string | null {
  const match = text.match(new RegExp(`['"]${key}['"]\\s*:\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)"|(\\d+))`));
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

export function describeRunError(raw: string): RunErrorView {
  const text = raw.trim();
  const numeric = pick(text, "code") ?? text.match(/\b(?:Error code:|HTTP|status)\s*(\d{3})\b/i)?.[1] ?? null;
  const status = pick(text, "status");
  const message = pick(text, "message");
  const detail = message ?? (text.replace(/^Error:\s*/, "") || null);
  const code = [numeric, status && !/^\d+$/.test(status) ? status : null].filter(Boolean).join(" · ") || null;
  const haystack = `${text} ${message ?? ""}`.toLowerCase();
  const n = numeric ? Number(numeric) : null;

  const view = (kind: RunErrorKind, title: string, hint: string): RunErrorView => ({
    kind,
    title,
    hint,
    detail: detail === text && kind !== "unknown" ? null : detail,
    code,
    raw,
  });

  if (/previous process stopped|application_restarted/i.test(text)) {
    return { kind: "restarted", title: "The run was interrupted", hint: "Khai-Agents restarted while this turn was running. Retry to run it again.", detail: null, code: null, raw };
  }
  if (n === 503 || n === 529 || /unavailable|overloaded|high demand/.test(haystack)) {
    return view("overloaded", "The model is busy right now", "The provider is under heavy load. This is usually temporary — retry in a moment or switch to another model.");
  }
  if (/quota|billing|insufficient.?(funds|credit)|credit balance/.test(haystack) || (n === 429 && /per.?day|daily/.test(haystack))) {
    return view("quota", "Usage quota reached", "This API key has used up its quota. Wait for it to reset, add billing to the key, or switch to another model.");
  }
  if (n === 429 || /rate.?limit|too many requests/.test(haystack)) {
    return view("rate_limited", "Too many requests", "The provider is rate-limiting this key. Wait a few seconds and retry.");
  }
  if (n === 401 || n === 403 || /api.?key|unauthori[sz]ed|permission denied|invalid.+key/.test(haystack)) {
    return view("auth", "The API key was rejected", "Check the key for this provider in Settings → API keys.");
  }
  if (n === 404 || /not found|does not exist|unknown model/.test(haystack)) {
    return view("not_found", "This model isn't available", "The provider doesn't offer this model to your key. Pick another model.");
  }
  if (/context.?(length|window)|too many tokens|maximum.+tokens|token limit/.test(haystack)) {
    return view("context", "The conversation is too long for this model", "Run /compact to summarise earlier messages, or switch to a model with a larger context window.");
  }
  if (/timed? ?out|timeout|connection|network|unreachable|getaddrinfo|ssl/.test(haystack)) {
    return view("network", "Couldn't reach the provider", "Check your internet connection, then retry.");
  }
  return view("unknown", "The model returned an error", "Retry, or switch to another model if it keeps happening.");
}
