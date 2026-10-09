import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  FileDiff,
  FlaskConical,
  FolderTree,
  History,
  Maximize2,
  Minimize2,
  Package,
  SquareTerminal,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
  Artifact,
  Thread,
  Turn,
  WorkflowRun,
} from "../../generated/app-server";
import type { ClientRuntime } from "../../rpc/contracts";
import type { DesktopInspectorTab } from "../../app/useDesktopUi";
import { useCodeWorkbench } from "../workbench/useCodeWorkbench";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { HistoryPanel } from "./HistoryPanel";
import { FilesPanel } from "./FilesPanel";
import { useDocumentIndex } from "./useDocumentIndex";
import { TestsPanel } from "./TestsPanel";
import styles from "./Inspector.module.css";

interface InspectorProps {
  runtime: ClientRuntime;
  thread: Thread | null;
  trusted: boolean;
  turns: Turn[];
  workflows: WorkflowRun[];
  artifacts: Artifact[];
  tab: DesktopInspectorTab;
  onTabChange(tab: DesktopInspectorTab): void;
  onDirtyChange(dirty: boolean): void;
  onClose(): void;
  /**
   * Plain chats share one workspace: show only this chat's own documents
   * (its uploads and what the agent wrote for it) in Files.
   */
  sessionScoped?: boolean;
  /** Whether the panel is widened to its maximum, and the toggle for it. */
  wide?: boolean;
  onToggleWide?(): void;
}

// Artifacts moved out of the review panel; documents collect under
// Documents in the sidebar instead.
const TAB_ICONS: Record<DesktopInspectorTab, LucideIcon> = {
  changes: FileDiff,
  files: FolderTree,
  artifacts: Package,
  tests: FlaskConical,
  terminal: SquareTerminal,
  details: History,
};

// Tests left the panel; "details" now shows the chat's question History.
const tabs: DesktopInspectorTab[] = ["files", "details"];

export function Inspector({
  runtime,
  thread,
  trusted,
  turns,
  workflows,
  artifacts,
  tab,
  onTabChange,
  onDirtyChange,
  onClose,
  wide = false,
  onToggleWide,
  sessionScoped = false,
}: InspectorProps) {
  const { t } = useTranslation();
  const workbench = useCodeWorkbench(runtime, thread);
  // Only asked for while the Files tab shows it; the listing is the refresh cue.
  const knowledge = useDocumentIndex(
    runtime,
    tab === "files" ? (thread?.id ?? null) : null,
    workbench.entries,
  );
  const sessionPaths = useSessionDocuments(
    runtime,
    sessionScoped ? (thread?.id ?? null) : null,
    workbench.entries,
  );
  const dirty = Boolean(
    workbench.file && workbench.draft !== workbench.file.content,
  );
  const latestTurn = useMemo(
    () =>
      [...turns]
        .sort((left, right) => right.ordinal - left.ordinal)
        .find((turn) =>
          ["completed", "failed", "interrupted"].includes(turn.status),
        ) ?? null,
    [turns],
  );
  const latestWorkflow = useMemo(
    () =>
      [...workflows].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      )[0] ?? null,
    [workflows],
  );
  const hasActiveTurn = turns.some((turn) =>
    ["queued", "running", "waiting_approval"].includes(turn.status),
  );

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  const threadId = thread?.id ?? null;
  const readBytes = useCallback(
    (path: string) =>
      runtime.readFileBytes && threadId
        ? runtime.readFileBytes(threadId, path)
        : Promise.reject(new Error("Document previews need the web client.")),
    [runtime, threadId],
  );
  // A notice, not a modal state: it fades out on its own after a while.
  const { error: workbenchError, clearError } = workbench;
  useEffect(() => {
    if (!workbenchError) return;
    const timer = window.setTimeout(clearError, 8000);
    return () => window.clearTimeout(timer);
  }, [workbenchError, clearError]);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const badge = (candidate: DesktopInspectorTab): number | null => {
    if (candidate === "changes") return workbench.diffs.length || null;
    if (candidate === "artifacts") return artifacts.length || null;
    return null;
  };

  const TAB_LABELS: Record<string, string> = {
    changes: t("inspector.tab.changes", "changes"),
    files: t("inspector.tab.files", "files"),
    artifacts: t("inspector.tab.artifacts", "artifacts"),
    tests: t("inspector.tab.tests", "tests"),
    terminal: t("inspector.tab.terminal", "terminal"),
    details: t("inspector.tab.history", "history"),
  };

  return (
    <aside className={styles.inspector} aria-label={t("inspector.label", "Inspector")}>
      <div className={styles.tabs} role="tablist" aria-label={t("inspector.views", "Inspector views")}>
        {tabs.map((candidate) => {
          const Icon = TAB_ICONS[candidate];
          const count = badge(candidate);
          return (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={tab === candidate}
              title={TAB_LABELS[candidate] ?? candidate}
              onClick={() => onTabChange(candidate)}
            >
              <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
              <span>{TAB_LABELS[candidate] ?? candidate}</span>
              {count ? <b className={styles.tabCount}>{count}</b> : null}
            </button>
          );
        })}
      </div>
      {onToggleWide ? (
        <button
          className={styles.widen}
          type="button"
          onClick={onToggleWide}
          aria-label={wide ? "Restore panel width" : "Widen panel"}
          title={wide ? "Restore width" : "Widen"}
        >
          {wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      ) : null}
      <button
        className={styles.close}
        type="button"
        onClick={onClose}
        aria-label={t("inspector.closeReview", "Close review panel")}
      >
        <X size={16} />
      </button>

      <div className={styles.panel}>
        {workbench.error ? (
          <div className={styles.error} role="alert">
            <AlertCircle size={15} aria-hidden="true" />
            <p>{workbench.error}</p>
            <button
              type="button"
              onClick={workbench.clearError}
              aria-label="Dismiss"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
        {tab === "files" ? (
          <FilesPanel
            onDownload={runtime.downloadFile && thread ? (path) => runtime.downloadFile!(thread.id, path) : undefined}
            readBytes={readBytes}
            trusted={trusted}
            hasActiveTurn={hasActiveTurn}
            workbench={workbench}
            knowledge={sessionPaths ? undefined : knowledge}
            onlyPaths={sessionPaths}
          />
        ) : null}
        {tab === "artifacts" ? (
          <ArtifactsPanel
            key={thread?.id ?? "no-thread"}
            runtime={runtime}
            workflow={latestWorkflow}
            artifacts={artifacts}
          />
        ) : null}
        {tab === "tests" ? (
          <TestsPanel
            trusted={trusted}
            hasActiveTurn={hasActiveTurn}
            latestTurn={latestTurn}
            workbench={workbench}
          />
        ) : null}
        {tab === "details" ? (
          <HistoryPanel
            threadId={thread?.id ?? null}
            turns={turns}
          />
        ) : null}
      </div>
    </aside>
  );
}

/**
 * Paths of one Thread's documents (``documents/list``), refreshed whenever
 * the workspace listing changes; null when not scoped.
 */
function useSessionDocuments(
  runtime: ClientRuntime,
  threadId: string | null,
  refreshCue: unknown,
): ReadonlySet<string> | null {
  const [loaded, setLoaded] = useState<{ threadId: string; paths: ReadonlySet<string> } | null>(
    null,
  );
  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    runtime
      .request("documents/list", { threadId })
      .then((result) => {
        if (!cancelled) {
          setLoaded({ threadId, paths: new Set(result.documents.map((doc) => doc.path)) });
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded({ threadId, paths: new Set() });
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, threadId, refreshCue]);
  if (!threadId) return null;
  return loaded?.threadId === threadId ? loaded.paths : new Set();
}
