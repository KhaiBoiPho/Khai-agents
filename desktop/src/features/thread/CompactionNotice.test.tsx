import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { CompactionEntry } from "../../app/workspaceState";
import { CompactionNotice } from "./CompactionNotice";

const base: CompactionEntry = {
  id: "compact_1",
  status: "running",
  startedAt: "2026-10-06T00:00:00Z",
  instructions: null,
  tokensBefore: null,
  tokensAfter: null,
  summary: null,
  message: null,
  afterTurnId: null,
};

describe("CompactionNotice", () => {
  afterEach(cleanup);

  it("shows progress while compacting", () => {
    render(<CompactionNotice entry={base} />);
    expect(screen.getByRole("status").textContent).toContain("Compacting conversation");
  });

  it("reports the token drop and expands the summary", () => {
    render(
      <CompactionNotice
        entry={{ ...base, status: "done", tokensBefore: 45_200, tokensAfter: 3_100, summary: "Kept the plan." }}
      />,
    );
    const toggle = screen.getByRole("button", {
      name: /Conversation compacted · 45K → 3.1K tokens/,
    });
    expect(screen.queryByText("Kept the plan.")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("Kept the plan.")).toBeTruthy();
  });

  it("explains a failure", () => {
    render(<CompactionNotice entry={{ ...base, status: "failed", message: "No compactable history yet." }} />);
    expect(screen.getByRole("status").textContent).toContain("No compactable history yet.");
  });
});
