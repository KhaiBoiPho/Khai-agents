import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Item } from "../../generated/app-server";

const markdownRenders = vi.hoisted(() => ({ count: 0 }));

vi.mock("./MarkdownContent", () => ({
  MarkdownContent: ({ children }: { children: string }) => {
    markdownRenders.count += 1;
    return <p>{children}</p>;
  },
}));

import { ReasoningBlock } from "./ReasoningBlock";

const item: Item = {
  id: "reasoning-1",
  threadId: "thread-1",
  turnId: "turn-1",
  ordinal: 2,
  kind: "reasoning_summary",
  status: "in_progress",
  summary: "Thinking",
  payload: {
    schemaVersion: 1,
    summaryText: "Checking the repository.",
    traceText: "",
    availability: "available",
    effort: "auto",
    streaming: true,
  },
  createdAt: "2026-07-29T00:00:00Z",
  updatedAt: "2026-07-29T00:00:00Z",
};

describe("ReasoningBlock elapsed time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T00:00:01Z"));
    markdownRenders.count = 0;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("ticks the label without re-rendering the reasoning Markdown", () => {
    render(<ReasoningBlock item={item} mode="normal" />);
    expect(screen.getByText("Thinking · 1 second")).toBeTruthy();
    const rendersAfterMount = markdownRenders.count;

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText("Thinking · 4 seconds")).toBeTruthy();
    expect(markdownRenders.count).toBe(rendersAfterMount);
  });
});
