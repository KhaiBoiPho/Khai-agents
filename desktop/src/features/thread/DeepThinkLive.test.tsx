import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item } from "../../generated/app-server";
import { CitationContext } from "./citations";
import { DeepThinkProgress } from "./DeepThinkProgress";
import { deepThinkView } from "./deepThinkModel";

function item(status: Item["status"], doc: Record<string, unknown>): Item {
  return {
    id: "dt-1",
    threadId: "thread-1",
    turnId: "turn-1",
    ordinal: 2,
    kind: "workflow_stage",
    status,
    summary: "DeepThink",
    payload: { name: "deepthink", deepthink: doc } as Item["payload"],
    createdAt: "2026-10-10T01:00:01Z",
    updatedAt: "2026-10-10T01:00:02Z",
  };
}

const steps = (running: string) =>
  ["plan", "search", "check", "summarize"].map((id) => ({
    id,
    label: id,
    status: id === running ? "running" : "pending",
    detail: null,
    items: [],
  }));

const doc = (overrides: Record<string, unknown>) => ({
  version: 1,
  status: "running",
  round: 1,
  steps: steps("search"),
  sources: [
    { id: 1, title: "src/server.ts:1-20", url: "src/server.ts:1-20" },
    { id: 2, title: "Node docs", url: "https://nodejs.org/api" },
  ],
  notes: [],
  live: { step: "search", text: "↳ code: startServer — 1 new result\n   · src/server.ts:1-20" },
  ...overrides,
});

describe("DeepThink live feed and code sources", () => {
  afterEach(cleanup);

  it("streams the running step's feed inside the card", () => {
    render(<DeepThinkProgress item={item("in_progress", doc({}))} />);
    expect(screen.getByText(/code: startServer — 1 new result/)).toBeTruthy();
  });

  it("hides the feed once the step is no longer running", () => {
    const view = deepThinkView(item("in_progress", doc({ steps: steps("check") })));
    expect(view?.live).toBeNull();
    const done = deepThinkView(item("completed", doc({ status: "completed" })));
    expect(done?.live).toBeNull();
  });

  it("keeps code sources and opens them at their lines", () => {
    const open = vi.fn();
    render(
      <CitationContext.Provider value={open}>
        <DeepThinkProgress item={item("in_progress", doc({}))} />
      </CitationContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.click(screen.getByRole("button", { name: /src\/server\.ts:1-20/ }));
    expect(open).toHaveBeenCalledWith("src/server.ts", { start: 1, end: 20 });
    expect(screen.getByText("Node docs")).toBeTruthy();
  });
});
