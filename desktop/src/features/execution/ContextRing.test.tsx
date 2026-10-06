import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Thread } from "../../generated/app-server";
import type { RpcTransport } from "../../rpc/contracts";
import { ContextRing } from "./ContextRing";
import { contextShare, formatTokens } from "./contextFormat";

const thread = {
  id: "thread-1",
  model: "gemini",
  connectionId: "conn",
  contextWindow: null,
} as unknown as Thread;

function runtime(window = 200_000): RpcTransport {
  return {
    request: vi.fn(async () => ({ executionProfile: { contextWindow: window } })),
  } as unknown as RpcTransport;
}

describe("ContextRing", () => {
  afterEach(cleanup);

  it("shows real context fill against the resolved window and compacts", async () => {
    const onCompact = vi.fn();
    render(
      <ContextRing
        runtime={runtime()}
        thread={thread}
        usage={{ usedTokens: 150_000, source: "provider", at: "now" }}
        compacting={false}
        canCompact
        onCompact={onCompact}
      />,
    );
    const ring = await screen.findByRole("button", {
      name: "Context 150K of 200K tokens (75%)",
    });
    fireEvent.click(ring);
    expect(screen.getByText("150K / 200K · 75%")).toBeTruthy();
    expect(screen.getByText(/filling the window/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Compact conversation" }));
    expect(onCompact).toHaveBeenCalledOnce();
  });

  it("disables compaction while a reply runs or before any usage", async () => {
    const transport = runtime();
    render(
      <ContextRing
        runtime={transport}
        thread={thread}
        usage={null}
        compacting={false}
        canCompact
        onCompact={() => undefined}
      />,
    );
    await waitFor(() => expect(transport.request).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Context usage" }));
    const button = screen.getByRole("button", { name: "Compact conversation" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/after the first reply/)).toBeTruthy();
  });

  it("formats token counts and shares", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1_250)).toBe("1.3K");
    expect(formatTokens(45_200)).toBe("45K");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(contextShare(1, 1_000_000)).toBe(1);
    expect(contextShare(0, 100)).toBe(0);
    expect(contextShare(500, 100)).toBe(100);
  });
});
