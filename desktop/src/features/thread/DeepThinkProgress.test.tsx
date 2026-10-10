import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item, Turn } from "../../generated/app-server";
import { buildConversationTurns } from "./conversationModel";
import { DeepThinkProgress } from "./DeepThinkProgress";
import { deepThinkView } from "./deepThinkModel";
import { TurnBlock } from "./TurnBlock";

function progressItem(
  status: Item["status"],
  doc: Record<string, unknown>,
): Item {
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

const runningDoc = {
  version: 1,
  status: "running",
  round: 1,
  steps: [
    {
      id: "plan",
      label: "Plan",
      status: "completed",
      detail: "2 sub-questions",
      items: ["What is A?", "What is B?"],
    },
    {
      id: "search",
      label: "Search",
      status: "running",
      detail: "Round 1 · searching 2 queries",
      items: ["a facts", "b facts"],
    },
    { id: "check", label: "Check", status: "pending", detail: null, items: [] },
    { id: "summarize", label: "Summarize", status: "pending", detail: null, items: [] },
  ],
  sources: [
    { id: 1, title: "Alpha guide", url: "https://www.alpha.example/guide" },
    { id: 2, title: "Bad", url: "javascript:alert(1)" },
  ],
  notes: [],
};

describe("DeepThinkProgress", () => {
  afterEach(cleanup);

  it("shows the step chain with the running step and its detail", () => {
    render(<DeepThinkProgress item={progressItem("in_progress", runningDoc)} />);

    expect(screen.getByRole("region", { name: "DeepThink progress" })).toBeTruthy();
    const search = screen.getByRole("button", { name: "Search: running" });
    expect(search.getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("button", { name: "Plan: done" })).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Check: pending" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("Round 1 · searching 2 queries")).toBeTruthy();
  });

  it("expands a step to show sub-questions or sources with safe links", () => {
    render(<DeepThinkProgress item={progressItem("in_progress", runningDoc)} />);

    fireEvent.click(screen.getByRole("button", { name: "Plan: done" }));
    expect(screen.getByRole("region", { name: "Plan details" })).toBeTruthy();
    expect(screen.getByText("What is B?")).toBeTruthy();

    const search = screen.getByRole("button", { name: "Search: running" });
    fireEvent.click(search);
    expect(search.getAttribute("aria-expanded")).toBe("true");
    const link = screen.getByRole("link", { name: /Alpha guide/ });
    expect(link.getAttribute("href")).toBe("https://www.alpha.example/guide");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("alpha.example")).toBeTruthy();
    expect(screen.queryByText("Bad")).toBeNull();
    expect(screen.getByText("b facts")).toBeTruthy();

    fireEvent.click(search);
    expect(screen.queryByRole("link", { name: /Alpha guide/ })).toBeNull();
  });

  it("marks a step that was running when the Turn stopped as stopped", () => {
    const view = deepThinkView(progressItem("failed", runningDoc));
    expect(view?.status).toBe("interrupted");
    expect(view?.steps.find((step) => step.id === "search")?.status).toBe("stopped");
  });

  it("ignores other workflow stages", () => {
    const other = {
      ...progressItem("completed", runningDoc),
      payload: { name: "paper2code" },
    } as Item;
    expect(deepThinkView(other)).toBeNull();
    const { container } = render(<DeepThinkProgress item={other} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders inside a Turn in every transcript mode, without a review button", () => {
    const turn: Turn = {
      id: "turn-1",
      threadId: "thread-1",
      ordinal: 1,
      prompt: "Compare A and B",
      status: "completed",
      stopReason: "completed",
      errorCode: null,
      errorMessage: null,
      startedAt: "2026-10-10T01:00:00Z",
      completedAt: "2026-10-10T01:00:10Z",
    };
    const doneDoc = {
      ...runningDoc,
      status: "completed",
      steps: runningDoc.steps.map((step) => ({ ...step, status: "completed" })),
    };
    const [group] = buildConversationTurns(
      [turn],
      [
        {
          ...progressItem("completed", doneDoc),
          id: "user",
          ordinal: 1,
          kind: "user_message",
          payload: { text: turn.prompt, mode: "deepthink" },
        },
        progressItem("completed", doneDoc),
        {
          ...progressItem("completed", doneDoc),
          id: "answer",
          ordinal: 3,
          kind: "assistant_message",
          summary: "A beats B",
          payload: { text: "A beats B [1]", phase: "final_answer" },
        },
      ],
    );

    render(
      <TurnBlock
        group={group}
        approvalsByItem={new Map()}
        selectedItemId={null}
        transcriptMode="summary"
        busy={false}
        onSelectItem={vi.fn()}
        onOpenInspector={vi.fn()}
        onRespondToApproval={vi.fn()}
        onRetryTurn={vi.fn()}
        onCancelQueuedTurn={vi.fn()}
      />,
    );

    expect(screen.getByRole("region", { name: "DeepThink progress" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Summarize: done" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Review changes/ })).toBeNull();
  });
});
