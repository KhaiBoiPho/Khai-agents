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
}

export interface DeepThinkView {
  status: "running" | "completed" | "failed" | "interrupted";
  round: number;
  steps: DeepThinkStepView[];
  sources: DeepThinkSourceView[];
  notes: string[];
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
    const url = safeUrl(source?.url);
    if (!source || !url || typeof source.id !== "number") return [];
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
  };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
