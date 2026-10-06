import { describe, expect, it } from "vitest";

import type { Item } from "../../generated/app-server";
import { documentSearchView } from "./documentSearch";

const item = (status: Item["status"], payload: Record<string, unknown>) =>
  ({ id: "i1", kind: "tool_call", status, summary: "q", payload }) as unknown as Item;

describe("documentSearchView", () => {
  it("ignores other tools", () => {
    expect(documentSearchView(item("completed", { name: "grep" }))).toBeNull();
  });

  it("reads as a running search", () => {
    expect(documentSearchView(item("in_progress", { name: "search_documents" }))).toEqual({
      verb: "Searching documents",
      count: null,
    });
  });

  it("reports the result count from the tool output", () => {
    const done = item("completed", {
      name: "search_documents",
      resultPreview: 'Found 1 result for "soil".\nIndex: 3 documents indexed.',
    });
    expect(documentSearchView(done)).toEqual({ verb: "Searched documents", count: "1 result" });
    const many = item("completed", {
      name: "search_documents",
      resultPreview: 'Found 6 results for "q".',
    });
    expect(documentSearchView(many)?.count).toBe("6 results");
    const failed = item("failed", {
      name: "search_documents",
      resultPreview: "Document search is unavailable: OPENROUTER_API_KEY is not set",
    });
    expect(documentSearchView(failed)).toEqual({ verb: "Searched documents", count: null });
  });
});
