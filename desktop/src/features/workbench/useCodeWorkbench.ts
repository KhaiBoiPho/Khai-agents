import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  FileContent,
  FileDiff,
  FileEntry,
  GitStatus,
  MethodResults,
  TestCommand,
  Thread,
} from "../../generated/app-server";
import type { BridgeError, ClientRuntime } from "../../rpc/contracts";
import {
  READ_LIMIT_BYTES,
  cachedFile,
  cachedListing,
  enterSession,
  rememberFile,
  rememberListing,
} from "./sessionFileCache";

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as BridgeError).message);
  }
  return error instanceof Error ? error.message : String(error);
}

interface CodeWorkbenchState {
  entries: FileEntry[];
  entriesTruncated: boolean;
  git: GitStatus | null;
  diffs: FileDiff[];
  tests: TestCommand[];
  lastTestRun: MethodResults["test/run"] | null;
  file: FileContent | null;
  draft: string;
  loading: boolean;
  error: string | null;
  gitError: string | null;
  testError: string | null;
}

export interface CodeWorkbenchController extends CodeWorkbenchState {
  refresh(): Promise<void>;
  /** List one folder's children on demand and merge them into the tree. */
  loadDirectory(path: string): Promise<void>;
  openFile(path: string): Promise<void>;
  /** Close the open file; a pending read for it is dropped. */
  closeFile(): void;
  clearError(): void;
  setDraft(value: string): void;
  saveFile(): Promise<void>;
  runTest(turnId: string, commandId: string): Promise<void>;
  discardChange(file: FileDiff): Promise<void>;
  createWorktree(): Promise<void>;
  resolveWorktree(disposition: "keep" | "clean", force?: boolean): Promise<void>;
}

const initialState: CodeWorkbenchState = {
  entries: [],
  entriesTruncated: false,
  git: null,
  diffs: [],
  tests: [],
  lastTestRun: null,
  file: null,
  draft: "",
  loading: false,
  error: null,
  gitError: null,
  testError: null,
};

export function useCodeWorkbench(
  runtime: ClientRuntime,
  thread: Thread | null,
): CodeWorkbenchController {
  const [state, setState] = useState(initialState);
  const threadId = thread?.id ?? null;
  const workspacePath = thread?.workspacePath ?? null;
  const activeThreadId = useRef<string | null>(threadId);
  const refreshGeneration = useRef(0);
  const fileGeneration = useRef(0);
  const loadedDirectories = useRef(new Set<string>());
  activeThreadId.current = threadId;

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    loadedDirectories.current = new Set();
    if (!threadId) {
      setState(initialState);
      return;
    }
    enterSession(threadId);
    // The session's cached tree shows at once; the fresh one replaces it.
    const cached = cachedListing(threadId);
    setState((current) => ({
      ...current,
      ...(cached && !current.entries.length
        ? { entries: cached.entries, entriesTruncated: cached.truncated }
        : {}),
      loading: true,
      error: null,
      gitError: null,
      testError: null,
    }));
    const [files, git, diffs, tests] = await Promise.allSettled([
      // Two levels up front; deeper folders load when they are opened.
      runtime.request("file/list", { threadId, depth: 2, limit: 5000 }),
      runtime.request("git/status", { threadId }),
      runtime.request("git/diff", { threadId, scope: "all" }),
      runtime.request("test/discover", { threadId }),
    ]);
    if (
      generation !== refreshGeneration.current ||
      activeThreadId.current !== threadId
    ) {
      return;
    }
    if (files.status === "fulfilled") {
      rememberListing(threadId, {
        entries: files.value.entries,
        truncated: files.value.truncated,
      });
    }
    setState((current) => ({
      ...current,
      entries: files.status === "fulfilled" ? files.value.entries : [],
      entriesTruncated:
        files.status === "fulfilled" ? files.value.truncated : false,
      git: git.status === "fulfilled" ? git.value.status : null,
      diffs: diffs.status === "fulfilled" ? diffs.value.files : [],
      tests: tests.status === "fulfilled" ? tests.value.commands : [],
      loading: false,
      error: files.status === "rejected" ? errorMessage(files.reason) : null,
      gitError:
        git.status === "rejected"
            ? errorMessage(git.reason)
          : diffs.status === "rejected"
            ? errorMessage(diffs.reason)
            : null,
      testError:
        tests.status === "rejected" ? errorMessage(tests.reason) : null,
    }));
  }, [runtime, threadId]);

  useEffect(() => {
    setState(initialState);
    fileGeneration.current += 1;
    void refresh();
  }, [refresh, workspacePath]);

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!threadId || !path || loadedDirectories.current.has(path)) return;
      loadedDirectories.current.add(path);
      try {
        const result = await runtime.request("file/list", {
          threadId,
          path,
          depth: 1,
          limit: 5000,
        });
        if (activeThreadId.current !== threadId) return;
        setState((current) => {
          // Replace the folder's direct children; keep deeper loaded levels.
          const known = new Set(current.entries.map((entry) => entry.path));
          const added = result.entries.filter((entry) => !known.has(entry.path));
          if (!added.length) return current;
          const entries = [...current.entries, ...added];
          rememberListing(threadId, { entries, truncated: current.entriesTruncated });
          return { ...current, entries };
        });
      } catch {
        loadedDirectories.current.delete(path);
      }
    },
    [runtime, threadId],
  );

  const openFile = useCallback(
    async (path: string) => {
      if (!threadId) return;
      const generation = ++fileGeneration.current;
      const cached = cachedFile(threadId, path);
      // A cached copy opens at once; the read below only refreshes it.
      setState((current) =>
        cached
          ? { ...current, file: cached, draft: cached.content, loading: false, error: null }
          : { ...current, loading: true, error: null },
      );
      try {
        const result = await runtime.request("file/read", {
          threadId,
          path,
          maxBytes: READ_LIMIT_BYTES,
        });
        rememberFile(threadId, result.file);
        if (
          generation !== fileGeneration.current ||
          activeThreadId.current !== threadId
        ) {
          return;
        }
        setState((current) => {
          if (!cached) {
            return { ...current, file: result.file, draft: result.file.content, loading: false };
          }
          if (current.file?.path !== path || current.file.sha256 === result.file.sha256) {
            return current;
          }
          // Changed since it was cached (say, by the agent): show the new
          // content, unless the user already started editing the old one.
          const untouched = current.draft === current.file.content;
          return {
            ...current,
            file: result.file,
            draft: untouched ? result.file.content : current.draft,
          };
        });
      } catch (error) {
        if (
          cached ||
          generation !== fileGeneration.current ||
          activeThreadId.current !== threadId
        ) {
          return;
        }
        setState((current) => ({
          ...current,
          loading: false,
          error: errorMessage(error),
        }));
      }
    },
    [runtime, threadId],
  );

  const saveFile = useCallback(async () => {
    if (!threadId || !state.file || state.file.truncated) return;
    const generation = ++fileGeneration.current;
    const filePath = state.file.path;
    const savedDraft = state.draft;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await runtime.request("file/write", {
        threadId,
        path: filePath,
        content: savedDraft,
        expectedSha256: state.file.sha256,
      });
      rememberFile(threadId, result.file);
      if (
        generation !== fileGeneration.current ||
        activeThreadId.current !== threadId
      ) {
        return;
      }
      setState((current) => ({
        ...current,
        file: result.file,
        draft:
          current.draft === savedDraft ? result.file.content : current.draft,
        loading: false,
      }));
      await refresh();
    } catch (error) {
      if (
        generation !== fileGeneration.current ||
        activeThreadId.current !== threadId
      ) {
        return;
      }
      setState((current) => ({
        ...current,
        loading: false,
        error: errorMessage(error),
      }));
    }
  }, [refresh, runtime, state.draft, state.file, threadId]);

  const runTest = useCallback(
    async (turnId: string, commandId: string) => {
      if (!threadId) return;
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const result = await runtime.request("test/run", {
          threadId,
          turnId,
          commandId,
          timeoutSeconds: 600,
        });
        if (activeThreadId.current !== threadId) return;
        setState((current) => ({
          ...current,
          lastTestRun: result,
          loading: false,
          testError: null,
        }));
        await refresh();
      } catch (error) {
        if (activeThreadId.current !== threadId) return;
        setState((current) => ({
          ...current,
          loading: false,
          testError: errorMessage(error),
        }));
      }
    },
    [refresh, runtime, threadId],
  );

  const discardChange = useCallback(
    async (file: FileDiff) => {
      if (!threadId) return;
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        await runtime.request("git/discard", {
          threadId,
          path: file.path,
          expectedRevision: file.revision,
        });
        if (activeThreadId.current !== threadId) return;
        setState((current) => ({ ...current, loading: false }));
        await refresh();
      } catch (error) {
        if (activeThreadId.current !== threadId) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: errorMessage(error),
        }));
      }
    },
    [refresh, runtime, threadId],
  );

  const createWorktree = useCallback(async () => {
    if (!threadId) return;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      await runtime.request("git/worktree/create", { threadId });
      if (activeThreadId.current !== threadId) return;
      setState((current) => ({ ...current, loading: false }));
      await refresh();
    } catch (error) {
      if (activeThreadId.current !== threadId) return;
      setState((current) => ({
        ...current,
        loading: false,
        error: errorMessage(error),
      }));
    }
  }, [refresh, runtime, threadId]);

  const resolveWorktree = useCallback(
    async (disposition: "keep" | "clean", force = false) => {
      if (!threadId) return;
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        await runtime.request("git/worktree/remove", {
          threadId,
          disposition,
          force,
          deleteBranch: false,
        });
        if (activeThreadId.current !== threadId) return;
        setState((current) => ({ ...current, loading: false }));
        await refresh();
      } catch (error) {
        if (activeThreadId.current !== threadId) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: errorMessage(error),
        }));
      }
    },
    [refresh, runtime, threadId],
  );

  return useMemo(
    () => ({
      ...state,
      refresh,
      loadDirectory,
      openFile,
      closeFile: () => {
        fileGeneration.current += 1;
        setState((current) => ({ ...current, file: null, draft: "", loading: false }));
      },
      clearError: () => setState((current) => ({ ...current, error: null })),
      setDraft: (draft: string) => setState((current) => ({ ...current, draft })),
      saveFile,
      runTest,
      discardChange,
      createWorktree,
      resolveWorktree,
    }),
    [
      createWorktree,
      discardChange,
      openFile,
      refresh,
      loadDirectory,
      resolveWorktree,
      runTest,
      saveFile,
      state,
    ],
  );
}
