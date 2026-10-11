import type { Item } from "../../generated/app-server";

export type DeepThinkStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "skipped"
  | "failed"
  | "stopped";

export interface DeepThinkStepView {
  id: string;
  label: string;
  status: DeepThinkStepStatus;
  detail: string | null;
  items: string[];
}

export interface DeepThinkSourceView {
  id: number;
  title: string;
  url: string;
  /** Set for an excerpt of the user's code: the file and its lines. */
  code?: { path: string; start: number; end: number };
}

/** What the running research step is doing, streamed into the card. */
export interface DeepThinkLiveView {
  step: string;
  text: string;
}

export interface DeepThinkView {
  status: "running" | "completed" | "failed" | "interrupted";
  round: number;
  steps: DeepThinkStepView[];
  sources: DeepThinkSourceView[];
  notes: string[];
  live: DeepThinkLiveView | null;
}

const CODE_SOURCE = /^(?<path>[^:]+):(?<start>\d+)-(?<end>\d+)$/;

function codeSource(value: unknown): DeepThinkSourceView["code"] | null {
  if (typeof value !== "string" || /^[a-z]+:\/\//i.test(value)) return null;
  const match = CODE_SOURCE.exec(value);
  if (!match?.groups) return null;
  return {
    path: match.groups.path,
    start: Number(match.groups.start),
    end: Number(match.groups.end),
  };
}

const STEP_STATUSES = new Set<DeepThinkStepStatus>([
  "pending",
  "running",
  "completed",
  "skipped",
  "failed",
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function isDeepThinkItem(item: Item): boolean {
  return item.kind === "workflow_stage" && item.payload.name === "deepthink";
}

/**
 * The DeepThink progress document carried by a `workflow_stage` Item, or
 * null for any other Item. A run that ended while a step was still running
 * (interrupt, crash) shows that step as stopped rather than spinning forever.
 */
export function deepThinkView(item: Item): DeepThinkView | null {
  if (!isDeepThinkItem(item)) return null;
  const doc = record(item.payload.deepthink);
  if (!doc) return null;
  const settled = item.status !== "in_progress";
  const rawStatus = doc.status;
  const status: DeepThinkView["status"] =
    rawStatus === "completed" || rawStatus === "failed" || rawStatus === "interrupted"
      ? rawStatus
      : settled && item.status !== "completed"
        ? "interrupted"
        : "running";
  const steps = (Array.isArray(doc.steps) ? doc.steps : []).flatMap((entry) => {
    const step = record(entry);
    if (!step || typeof step.id !== "string") return [];
    let stepStatus: DeepThinkStepStatus = STEP_STATUSES.has(
      step.status as DeepThinkStepStatus,
    )
      ? (step.status as DeepThinkStepStatus)
      : "pending";
    if (settled && stepStatus === "running") stepStatus = "stopped";
    return [
      {
        id: step.id,
        label: typeof step.label === "string" ? step.label : step.id,
        status: stepStatus,
        detail: typeof step.detail === "string" && step.detail ? step.detail : null,
        items: strings(step.items),
      },
    ];
  });
  const sources = (Array.isArray(doc.sources) ? doc.sources : []).flatMap((entry) => {
    const source = record(entry);
    if (!source || typeof source.id !== "number") return [];
    const code = codeSource(source.url);
    if (code) {
      return [{ id: source.id, title: `${code.path}:${code.start}-${code.end}`, url: String(source.url), code }];
    }
    const url = safeUrl(source.url);
    if (!url) return [];
    return [
      {
        id: source.id,
        title: typeof source.title === "string" && source.title ? source.title : url,
        url,
      },
    ];
  });
  return {
    status,
    round: typeof doc.round === "number" ? doc.round : 0,
    steps,
    sources,
    notes: strings(doc.notes),
    live: liveView(doc.live, status, steps),
  };
}

/** The live feed, only while its step is the one running. */
function liveView(
  value: unknown,
  status: DeepThinkView["status"],
  steps: DeepThinkStepView[],
): DeepThinkLiveView | null {
  const live = record(value);
  if (status !== "running" || !live) return null;
  const step = typeof live.step === "string" ? live.step : null;
  const text = typeof live.text === "string" ? live.text.trim() : "";
  const running = steps.find((entry) => entry.status === "running");
  return step && text && running?.id === step ? { step, text } : null;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
