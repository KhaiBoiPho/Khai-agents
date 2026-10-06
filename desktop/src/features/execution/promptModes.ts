/**
 * What the composer's mode toggles do to a prompt and its model settings:
 * attached files, web search and deep research ride on the prompt text;
 * DeepThink raises the reasoning effort. Shared by the thread composer and
 * the Home composer.
 */

import type { SettingsSnapshot, Thread } from "../../generated/app-server";

/** Lines the composer appends; the History panel strips them for display. */
export const CONTEXT_MARKER = "Attached workspace context:";
export const SEARCH_MARKER = "Search the web with the available web-search tools";
export const RESEARCH_MARKER = "Deep research mode:";

export function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

export function isInsideWorkspace(path: string, workspace: string): boolean {
  const candidate = normalizedPath(path);
  const root = normalizedPath(workspace);
  return candidate === root || candidate.startsWith(`${root}/`);
}

export function withContextFiles(
  prompt: string,
  paths: string[],
  workspace: string | undefined,
): string {
  if (!paths.length) return prompt;
  const root = workspace ? normalizedPath(workspace) : "";
  const references = paths.map((path) => {
    const normalized = normalizedPath(path);
    return normalized.startsWith(`${root}/`)
      ? normalized.slice(root.length + 1)
      : normalized;
  });
  return [
    prompt,
    "",
    "Attached workspace context:",
    ...references.map((path) => `- ${path}`),
  ].join("\n");
}

/**
 * Search mode rides on the prompt: the agent is asked to use its web-search
 * tools (the Firecrawl connector) for this one message.
 */
export function withSearch(prompt: string, enabled: boolean): string {
  if (!enabled) return prompt;
  return `${prompt}

${SEARCH_MARKER} (for example Firecrawl) before answering, and cite the sources you used.`;
}

/** Deep research: a multi-source web investigation ending in a cited report. */
export function withDeepResearch(prompt: string, enabled: boolean): string {
  if (!enabled) return prompt;
  return `${prompt}

${RESEARCH_MARKER} investigate this thoroughly before answering.
1. Break the question into sub-questions and make a short research plan.
2. Run several distinct web searches (Firecrawl), and read the most relevant pages in full rather than relying on snippets. Aim for 8 or more credible, independent sources, preferring primary and recent ones.
3. Cross-check key facts and numbers across sources; note disagreements and uncertainty.
4. Write a structured report: a short summary first, then sections per sub-question, then a "Sources" list. Cite claims inline with numbered references [1], [2] that match the list (title and URL).`;
}

export const DEEP_EFFORTS = new Set(["high", "xhigh", "max"]);

/** The connection, model and effort a thread runs with, defaults included. */
export function executionTarget(
  thread: Thread | null,
  settings: SettingsSnapshot | null,
): { connection: string | null; model: string | null; effort: string | null } {
  const defaults = settings?.agents.defaults;
  const record =
    typeof defaults === "object" && defaults !== null && !Array.isArray(defaults)
      ? (defaults as Record<string, unknown>)
      : {};
  const text = (value: unknown) =>
    typeof value === "string" && value ? value : null;
  return {
    connection: thread?.connectionId ?? text(record.connection),
    model: thread?.model ?? text(record.model),
    effort: text(record.reasoningEffort) ?? text(record.reasoning_effort),
  };
}
