import type { Item } from "../../generated/app-server";

export interface DocumentSearchView {
  verb: string;
  /** "6 results", once the search has finished. */
  count: string | null;
}

/**
 * Timeline wording for the agent's `search_documents` tool:
 * "Searching documents · <query>" while it runs, then
 * "Searched documents · <query> · 6 results". The count comes from the
 * first line of the tool result ("Found 6 results for …").
 */
export function documentSearchView(item: Item): DocumentSearchView | null {
  if (item.payload.name !== "search_documents") return null;
  if (item.status === "in_progress") return { verb: "Searching documents", count: null };
  const preview = item.payload.resultPreview;
  const match =
    typeof preview === "string" ? /^Found (\d+) results?\b/.exec(preview) : null;
  const count = match ? Number(match[1]) : null;
  return {
    verb: "Searched documents",
    count: count === null ? null : `${count} result${count === 1 ? "" : "s"}`,
  };
}
