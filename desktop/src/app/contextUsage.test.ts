import { describe, expect, it } from "vitest";

import type { Event, JsonObject } from "../generated/app-server";
import {
  contextTokensFromUsage,
  initialWorkspaceState,
  workspaceReducer,
  type WorkspaceState,
} from "./workspaceState";

let sequence = 0;
function event(type: string, payload: JsonObject, threadId = "thread-1"): Event {
  sequence += 1;
  return {
    eventId: `evt-${sequence}`,
    sequence,
    type,
    threadId,
    turnId: null,
    itemId: null,
    timestamp: `2026-10-06T00:00:${String(sequence).padStart(2, "0")}Z`,
    payload,
  };
}

function apply(state: WorkspaceState, ...events: Event[]): WorkspaceState {
  return events.reduce(
    (current, next) => workspaceReducer(current, { type: "event", event: next }),
    state,
  );
}

const selected: WorkspaceState = { ...initialWorkspaceState, selectedThreadId: "thread-1" };

describe("context usage and compaction state", () => {
  it("reads the context fill from the latest provider usage", () => {
    expect(contextTokensFromUsage({ prompt_tokens: 1200, completion_tokens: 80 })).toBe(1280);
    expect(contextTokensFromUsage({ input_tokens: 10, output_tokens: 5 })).toBe(15);
    expect(contextTokensFromUsage({ total_tokens: 9 })).toBeNull();

    const state = apply(
      selected,
      event("turn.usage.recorded", { responseOrdinal: 1, usage: { prompt_tokens: 100, completion_tokens: 10 } }),
      event("turn.usage.recorded", { responseOrdinal: 2, usage: { prompt_tokens: 400, completion_tokens: 20 } }),
    );
    expect(state.contextUsage).toMatchObject({ usedTokens: 420, source: "provider" });
  });

  it("tracks a compaction from running to done and drops the context fill", () => {
    const running = apply(
      selected,
      event("turn.usage.recorded", { usage: { prompt_tokens: 50_000, completion_tokens: 500 } }),
      event("thread.context.compacting", { compactionId: "compact_1", instructions: "keep APIs" }),
    );
    expect(running.compactions).toEqual([
      expect.objectContaining({ id: "compact_1", status: "running", instructions: "keep APIs" }),
    ]);

    const done = apply(
      running,
      event("thread.context.compacted", {
        compactionId: "compact_1",
        tokensBefore: 50_500,
        tokensAfter: 3_200,
        summary: "Summary text",
        afterTurnId: "turn-9",
      }),
    );
    expect(done.compactions).toHaveLength(1);
    expect(done.compactions[0]).toMatchObject({
      status: "done",
      tokensBefore: 50_500,
      tokensAfter: 3_200,
      summary: "Summary text",
      instructions: "keep APIs",
      afterTurnId: "turn-9",
    });
    expect(done.contextUsage).toMatchObject({ usedTokens: 3_200, source: "estimate" });
  });

  it("records failures without touching the context fill", () => {
    const failed = apply(
      selected,
      event("turn.usage.recorded", { usage: { prompt_tokens: 900, completion_tokens: 9 } }),
      event("thread.context.compacting", { compactionId: "c2", instructions: null }),
      event("thread.context.compaction_failed", { compactionId: "c2", message: "No compactable history yet." }),
    );
    expect(failed.compactions[0]).toMatchObject({ status: "failed", message: "No compactable history yet." });
    expect(failed.contextUsage?.usedTokens).toBe(909);
  });

  it("ignores other threads and resets when the thread changes", () => {
    const state = apply(
      selected,
      event("thread.context.compacting", { compactionId: "other" }, "thread-2"),
      event("turn.usage.recorded", { usage: { prompt_tokens: 5, completion_tokens: 1 } }),
    );
    expect(state.compactions).toEqual([]);
    const switched = workspaceReducer(state, { type: "select-thread", threadId: "thread-2" });
    expect(switched.contextUsage).toBeNull();
    expect(switched.compactions).toEqual([]);
  });
});
