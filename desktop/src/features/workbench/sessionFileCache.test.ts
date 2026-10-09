import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { FileContent, Thread } from "../../generated/app-server";
import type { ClientRuntime } from "../../rpc/contracts";
import {
  cachedFile,
  cachedListing,
  enterSession,
  prefetchSession,
  rememberFile,
  rememberListing,
} from "./sessionFileCache";
import { useCodeWorkbench } from "./useCodeWorkbench";

const file = (path: string, content: string): FileContent => ({
  path,
  content,
  byteSize: content.length,
  sha256: `sha-${content}`,
  lineCount: content.split("\n").length,
  truncated: false,
});

/** A runtime whose files can change between reads, counting each call. */
function fakeRuntime(files: Record<string, string>) {
  const calls: string[] = [];
  const runtime = {
    request: async (method: string, params: { path?: string }) => {
      calls.push(`${method}${params.path ? ` ${params.path}` : ""}`);
      switch (method) {
        case "file/read":
          return { file: file(params.path!, files[params.path!]) };
        case "file/list":
          return { entries: [{ path: "a.ts", kind: "file" }], truncated: false };
        case "git/diff":
          return { files: [{ path: "a.ts", status: "modified", binary: false }] };
        case "git/status":
          return { status: null };
        case "test/discover":
          return { commands: [] };
        default:
          throw new Error(method);
      }
    },
  } as unknown as ClientRuntime;
  return { runtime, calls, files };
}

describe("sessionFileCache", () => {
  beforeEach(() => enterSession(null));

  it("keeps one session and drops it when another opens", () => {
    enterSession("t1");
    rememberFile("t1", file("a.ts", "one"));
    rememberListing("t1", { entries: [], truncated: false });
    expect(cachedFile("t1", "a.ts")?.content).toBe("one");
    enterSession("t2");
    expect(cachedFile("t1", "a.ts")).toBeNull();
    expect(cachedListing("t1")).toBeNull();
    // Writes for a session that is no longer current are ignored.
    rememberFile("t1", file("b.ts", "stale"));
    enterSession("t1");
    expect(cachedFile("t1", "b.ts")).toBeNull();
  });

  it("drops the least recently used files past its size budget", () => {
    enterSession("t1");
    const big = "x".repeat(12 * 1024 * 1024);
    rememberFile("t1", file("a", big));
    rememberFile("t1", file("b", big));
    cachedFile("t1", "a"); // a is now the most recent
    rememberFile("t1", file("c", big));
    expect(cachedFile("t1", "b")).toBeNull();
    expect(cachedFile("t1", "a")).not.toBeNull();
    expect(cachedFile("t1", "c")).not.toBeNull();
  });

  it("reads ahead the session's tree and changed files", async () => {
    const { runtime, calls } = fakeRuntime({ "a.ts": "changed" });
    await prefetchSession(runtime, "t1", () => true);
    expect(cachedListing("t1")?.entries).toHaveLength(1);
    expect(cachedFile("t1", "a.ts")?.content).toBe("changed");
    expect(calls).toEqual(["file/list", "git/diff", "file/read a.ts"]);
  });

  it("opens a cached file at once and refreshes it if it changed", async () => {
    const { runtime, files } = fakeRuntime({ "a.ts": "v1" });
    const thread = { id: "t1", workspacePath: "/w" } as Thread;
    enterSession("t1");
    rememberFile("t1", file("a.ts", "v1"));
    files["a.ts"] = "v2"; // the agent edited it since it was cached
    const { result } = renderHook(() => useCodeWorkbench(runtime, thread));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let opening!: Promise<void>;
    act(() => {
      opening = result.current.openFile("a.ts");
    });
    // Shown from the cache before the read finishes.
    expect(result.current.draft).toBe("v1");
    expect(result.current.loading).toBe(false);
    await act(() => opening);
    expect(result.current.draft).toBe("v2");
    expect(cachedFile("t1", "a.ts")?.content).toBe("v2");
  });
});
