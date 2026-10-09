import {
  FolderOpen,
  MessageSquarePlus,
  PanelLeftOpen,
  PanelRight,
  PanelRightClose,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";

import { projectCanExecute } from "./app/projectPresentation";
import { latestExecutingTurn } from "./app/interactiveTurnRouter";
import { useAppearance } from "./app/useAppearance";
import { useDesktopUi } from "./app/useDesktopUi";
import { useComposerCommands } from "./app/useComposerCommands";
import { useWorkspaceController } from "./app/useWorkspaceController";
import { RuntimeNotice } from "./components/RuntimeNotice";
import {
  Composer,
  type ComposerLaunchIntent,
} from "./features/execution/Composer";
import { DesktopSidebar } from "./features/navigation/DesktopSidebar";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SidebarResizer,
} from "./features/navigation/SidebarResizer";
import { withContextFiles } from "./features/execution/promptModes";
import { isChatsProject } from "./app/chats";
import { HomeView } from "./features/home/HomeView";
import { DocumentsPage } from "./features/pages/DocumentsPage";
import { requestFilePreview } from "./features/inspector/filePreviewRequests";
import { NotesPage } from "./features/planner/notes/NotesPage";
import { CalendarPage } from "./features/planner/calendar/CalendarPage";
import { TasksPage } from "./features/planner/tasks/TasksPage";
import { SchedulePage } from "./features/planner/schedule/SchedulePage";
import { AppsPage } from "./features/apps/AppsPage";
import { ReviewResizer } from "./features/inspector/ReviewResizer";
import { useReviewWidth } from "./features/inspector/useReviewWidth";
import type { SidebarPage } from "./features/navigation/DesktopSidebar";
import { useTranscriptMode } from "./features/thread/transcriptMode";
import type { ClientRuntime } from "./rpc/contracts";
import type { SkillInfo } from "./generated/app-server";
import { initI18n } from "./app/i18n";
import styles from "./App.module.css";

// Idempotent: tests render <App> directly without main.tsx.
initI18n();

const Inspector = lazy(() =>
  import("./features/inspector/Inspector").then((module) => ({
    default: module.Inspector,
  })),
);
// Docmost's client and its editor stack are large; load them only when
// KhaiDocs is opened. See src/khaidocs-app.d.ts for the typed boundary.
const KhaiDocsApp = lazy(() => import("khaidocs-app"));
const ManagementWorkspace = lazy(() =>
  import("./features/management/ManagementWorkspace").then((module) => ({
    default: module.ManagementWorkspace,
  })),
);
const SettingsDialog = lazy(() =>
  import("./features/settings/SettingsDialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);
const ThreadConversation = lazy(() =>
  import("./features/thread/ThreadConversation").then((module) => ({
    default: module.ThreadConversation,
  })),
);
const WorkflowComposer = lazy(() =>
  import("./features/workflows/WorkflowComposer").then((module) => ({
    default: module.WorkflowComposer,
  })),
);

function LoadingSurface({
  children,
  compact = false,
}: {
  children: string;
  compact?: boolean;
}) {
  return (
    <div
      className={styles.loadingSurface}
      data-compact={compact || undefined}
      role="status"
    >
      {children}
    </div>
  );
}

const SIDEBAR_KEY = "khai-agents.sidebar-hidden";
const SIDEBAR_WIDTH_KEY = "khai-agents.sidebar-width";
const ACTIVE_VIEW_KEY = "khai-agents.active-view";

const PAGE_TITLES: Record<SidebarPage, string> = {
  calendar: "Calendar",
  plan: "Plan",
  schedule: "Schedule",
  documents: "Documents",
  notes: "Notes",
  khaidocs: "KhaiDocs",
  apps: "App Authorization",
};

function readSidebarHidden(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

function readSidebarWidth(): number {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (!Number.isFinite(stored) || stored <= 0) return DEFAULT_SIDEBAR_WIDTH;
    return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, stored));
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

function readActiveView(): { homeOpen: boolean; page: SidebarPage | null } {
  try {
    const raw = localStorage.getItem(ACTIVE_VIEW_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { homeOpen?: unknown; page?: unknown };
      const validPages: SidebarPage[] = [
        "calendar",
        "plan",
        "schedule",
        "documents",
        "notes",
        "khaidocs",
        "apps",
      ];
      return {
        homeOpen: saved.homeOpen === true,
        page: validPages.includes(saved.page as SidebarPage)
          ? (saved.page as SidebarPage)
          : null,
      };
    }
    // The controller already persists the selected thread. If one exists,
    // reopen that session instead of covering it with the New chat screen.
    return {
      homeOpen: !localStorage.getItem("deepcode.desktop.selectedThread"),
      page: null,
    };
  } catch {
    return { homeOpen: true, page: null };
  }
}

export function App({
  runtime,
  onSignOut,
}: {
  runtime: ClientRuntime;
  onSignOut?: () => void;
}) {
  const controller = useWorkspaceController(runtime);
  // Mounted for its effect: paints saved appearance preferences at startup.
  useAppearance();
  const ui = useDesktopUi();
  const transcript = useTranscriptMode();
  const runComposerCommand = useComposerCommands(controller, ui);
  const [composerIntent, setComposerIntent] =
    useState<ComposerLaunchIntent | null>(null);
  const [expandedPlanThreadId, setExpandedPlanThreadId] = useState<string | null>(null);
  const { state, selectedProject, selectedThread } = controller;
  const [sidebarHidden, setSidebarHidden] = useState(readSidebarHidden);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [restoredView] = useState(readActiveView);
  // Restore the last visible destination; the selected thread itself is
  // restored by the workspace controller.
  const [homeOpen, setHomeOpen] = useState(restoredView.homeOpen);
  const [reviewWidth, setReviewWidth] = useReviewWidth();
  // "Widen" remembers the width to return to; any width at the maximum
  // (widened or dragged there) counts as wide.
  const narrowWidthRef = useRef(reviewWidth);
  const reviewWide =
    reviewWidth >= window.innerWidth - (sidebarHidden ? 0 : sidebarWidth) - 460 - 1;
  const [page, setPage] = useState<SidebarPage | null>(restoredView.page);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarHidden ? "1" : "0");
    } catch {
      // Storage can be unavailable; the choice then lasts for this page.
    }
  }, [sidebarHidden]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // Storage can be unavailable; the width then lasts for this page.
    }
  }, [sidebarWidth]);
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_VIEW_KEY, JSON.stringify({ homeOpen, page }));
    } catch {
      // Storage can be unavailable; the active view then lasts for this page.
    }
  }, [homeOpen, page]);
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLocaleLowerCase() === "b"
      ) {
        event.preventDefault();
        setSidebarHidden((hidden) => !hidden);
      }
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, []);
  const createSkillThread = async (skill: SkillInfo) => {
    if (!(await ui.navigateTo("threads"))) return;
    const created = await controller.createThread("code", "Create a Skill");
    if (!created) return;
    ui.closeSettings();
    setComposerIntent({
      threadId: created.id,
      prompt:
        skill.defaultPrompt ??
        `Use $${skill.name} to create a focused reusable Skill for this project.`,
      skillIds: [skill.id],
    });
  };
  const activeTurn = latestExecutingTurn(state.turns, selectedThread?.id);
  const planProgressExpanded = expandedPlanThreadId === selectedThread?.id;
  const progressTurn = activeTurn ?? [...state.turns]
    .filter((turn) => turn.threadId === selectedThread?.id)
    .sort((left, right) => right.ordinal - left.ordinal)[0] ?? null;
  const planProgress = progressTurn
    ? state.plansByTurnId[progressTurn.id] ?? null
    : null;
  const queuedTurns = state.turns
    .filter(
      (turn) =>
        turn.threadId === selectedThread?.id && turn.status === "queued",
    )
    .sort((left, right) => left.ordinal - right.ordinal);
  const hasPendingTurn = state.turns.some(
    (turn) =>
      turn.threadId === selectedThread?.id &&
      ["queued", "running", "waiting_approval"].includes(turn.status),
  );
  const latestWorkflow =
    [...state.workflows].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )[0] ?? null;
  const activeWorkflow = latestWorkflow
    ? ["queued", "running", "waiting"].includes(latestWorkflow.status)
    : false;
  const workspaceAvailable = projectCanExecute(selectedProject);
  const composerEditable =
    state.runtime.phase === "ready" &&
    workspaceAvailable &&
    selectedThread !== null;
  const agentExecutionEnabled =
    composerEditable && selectedProject?.trustState === "trusted";
  const disabledReason =
    state.runtime.phase !== "ready"
      ? "Waiting for the local App Server."
      : !selectedProject
        ? "Open a project to begin."
        : !workspaceAvailable
          ? "The original folder is unavailable. This Session remains readable."
        : selectedProject.trustState !== "trusted"
          ? "Trust this folder before agent execution."
          : !selectedThread
            ? "Create a thread to begin."
            : null;
  // The Review panel is remembered per chat: opening it in one chat does not
  // open it in the others.
  const reviewOpenByThread = useRef(new Map<string, boolean>());
  const reviewThreadId = selectedThread?.id ?? null;
  const reviewOpenNow = ui.inspectorOpen;
  const lastReviewThread = useRef<string | null>(reviewThreadId);
  useEffect(() => {
    if (lastReviewThread.current === reviewThreadId) {
      // Same chat: remember what the person did with the panel.
      if (reviewThreadId) reviewOpenByThread.current.set(reviewThreadId, reviewOpenNow);
      return;
    }
    // Another chat: restore its own panel state.
    lastReviewThread.current = reviewThreadId;
    const wanted = reviewThreadId
      ? (reviewOpenByThread.current.get(reviewThreadId) ?? false)
      : false;
    if (wanted && !reviewOpenNow) ui.openInspector();
    if (!wanted && reviewOpenNow) void ui.closeInspector();
  }, [reviewThreadId, reviewOpenNow, ui]);
  const showingThreads = ui.destination === "threads";
  // Home replaces the thread view when asked for, or when nothing is open.
  const showHome =
    showingThreads &&
    page === null &&
    (homeOpen || !selectedThread || !selectedProject);
  const inspectorVisible = Boolean(
    showingThreads && !showHome && page === null && selectedThread && ui.inspectorOpen,
  );

  return (
    <main
      className={styles.shell}
      style={{ "--review-width": `${reviewWidth}px`, "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      data-inspector={inspectorVisible}
      data-sidebar={sidebarHidden ? "hidden" : "shown"}
    >
      {sidebarHidden ? null : (
      <DesktopSidebar
        onHide={() => setSidebarHidden(true)}
        homeOpen={showHome}
        onShowHome={() => {
          setPage(null);
          setHomeOpen(true);
        }}
        activePage={page}
        onOpenPage={(next) => {
          setHomeOpen(false);
          setPage(next);
        }}
        onCreateThreadIn={(projectId) => {
          void (async () => {
            if (await ui.confirmDiscardInspectorDraft()) {
              const created = await controller.createThreadIn(projectId);
              if (created) {
                setHomeOpen(false);
                setPage(null);
              }
            }
          })();
        }}
        projects={state.projects}
        threads={state.threads}
        selectedProjectId={state.selectedProjectId}
        selectedThreadId={showHome || page ? null : state.selectedThreadId}
        query={ui.sessionQuery}
        busy={state.busy}
        runtime={state.runtime}
        destination={ui.destination}
        settingsOpen={ui.settingsOpen}
        onDestination={(destination) => {
          void ui.navigateTo(destination);
        }}
        onOpenSettings={(section) => ui.openSettings(section)}
        onSignOut={onSignOut}
        onQueryChange={ui.setSessionQuery}
        onOpenProject={() => {
          void (async () => {
            if (await ui.confirmDiscardInspectorDraft()) {
              await controller.openProject();
            }
          })();
        }}
        onRemoveProject={(projectId) => controller.removeProject(projectId)}
        onSelectProject={(projectId) => {
          if (projectId === state.selectedProjectId) return;
          void (async () => {
            if (await ui.confirmDiscardInspectorDraft()) {
              await controller.selectProject(projectId);
            }
          })();
        }}
        onCreateThread={() => {
          setPage(null);
          setHomeOpen(true);
        }}
        onSelectThread={(threadId) => {
          setHomeOpen(false);
          setPage(null);
          if (threadId === state.selectedThreadId) return;
          void (async () => {
            if (await ui.confirmDiscardInspectorDraft()) {
              await controller.selectThread(threadId);
            }
          })();
        }}
        onRenameThread={controller.renameThread}
        onArchiveThread={async (threadId) => {
          if (
            threadId === state.selectedThreadId &&
            !(await ui.confirmDiscardInspectorDraft())
          ) {
            return;
          }
          await controller.archiveThread(threadId);
        }}
        onDeleteThread={async (threadId) => {
          if (
            threadId === state.selectedThreadId &&
            !(await ui.confirmDiscardInspectorDraft())
          ) {
            return;
          }
          await controller.deleteThread(threadId);
        }}
      />
      )}
      {!sidebarHidden ? (
        <SidebarResizer width={sidebarWidth} onResize={setSidebarWidth} />
      ) : null}

      <section className={styles.workspace} aria-labelledby="thread-title">
        {sidebarHidden ? (
          <button
            type="button"
            className={styles.showSidebar}
            onClick={() => setSidebarHidden(false)}
            aria-label="Show sidebar"
            title="Show sidebar (Ctrl+B)"
          >
            <PanelLeftOpen size={17} />
          </button>
        ) : null}
        <RuntimeNotice
          reconnectOnly={runtime.host?.kind === "browser"}
          runtime={state.runtime}
          error={state.error}
          busy={state.busy}
          onRestart={() => void controller.restartRuntime()}
          onDismissError={controller.dismissError}
        />
        {page ? (
          <>
            <header className={styles.titleSlot}>
              <h1 id="thread-title">{PAGE_TITLES[page]}</h1>
            </header>
            <section className={styles.threadViewport}>
              {page === "notes" ? (
                <NotesPage />
              ) : page === "calendar" ? (
                <CalendarPage />
              ) : page === "plan" ? (
                <TasksPage />
              ) : page === "schedule" ? (
                <SchedulePage />
              ) : page === "apps" ? (
                <AppsPage />
              ) : page === "khaidocs" ? (
                <Suspense fallback={null}>
                  <KhaiDocsApp />
                </Suspense>
              ) : (
                <DocumentsPage
                  runtime={runtime}
                  onOpen={(document) => {
                    void (async () => {
                      if (
                        document.threadId !== state.selectedThreadId &&
                        !(await ui.confirmDiscardInspectorDraft())
                      ) {
                        return;
                      }
                      setHomeOpen(false);
                      setPage(null);
                      reviewOpenByThread.current.set(document.threadId, true);
                      if (document.threadId !== state.selectedThreadId) {
                        await controller.selectThread(document.threadId);
                      }
                      requestFilePreview(document.path);
                      ui.openInspector("files");
                    })();
                  }}
                />
              )}
            </section>
          </>
        ) : showHome ? (
          <>
            <header className={styles.titleSlot}>
              <h1 id="thread-title">Home</h1>
            </header>
            <section className={styles.threadViewport}>
              <HomeView
                runtime={runtime}
                settings={state.settings}
                onManageProviders={() => ui.openSettings("models")}
                projects={state.projects}
                selectedProjectId={state.selectedProjectId}
                busy={state.busy}
                onOpenProject={(projectId) => {
                  void (async () => {
                    if (projectId !== state.selectedProjectId) {
                      await controller.selectProject(projectId);
                    }
                    setHomeOpen(false);
                  })();
                }}
                onAddFolder={() => void controller.openProject()}
                onOpenSettings={(section) => ui.openSettings(section)}
                onStart={(projectId, prompt, model, files) => {
                  void (async () => {
                    const target =
                      projectId ?? (await controller.ensureChatsProject()).id;
                    const created = await controller.createThreadIn(
                      target,
                      "code",
                      undefined,
                      model,
                    );
                    if (!created) return;
                    let text = prompt;
                    if (files.length && runtime.uploadFiles) {
                      try {
                        const paths = await runtime.uploadFiles(created.id, files);
                        text = withContextFiles(prompt, paths, created.workspacePath);
                      } catch (error) {
                        console.error("Could not upload the attached files", error);
                      }
                    }
                    setComposerIntent({
                      threadId: created.id,
                      prompt: text,
                      skillIds: [],
                      autoSend: true,
                    });
                    setHomeOpen(false);
                  })();
                }}
              />
            </section>
          </>
        ) : showingThreads ? (
          <>
            <header className={styles.titleSlot} data-bar={selectedThread ? "true" : undefined}>
              <h1 id="thread-title">
                {selectedThread?.title ?? selectedProject?.displayName ?? "Khai-Agents"}
              </h1>
            {selectedThread ? (
              <button
                type="button"
                className={styles.reviewToggle}
                data-active={inspectorVisible}
                onClick={() => void ui.toggleInspector()}
                aria-pressed={inspectorVisible}
                aria-label={inspectorVisible ? "Close review panel" : "Open review panel"}
                title={inspectorVisible ? "Close review panel" : "Open review panel"}
              >
                {inspectorVisible ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
                Review
              </button>
            ) : null}
            </header>

            <section className={styles.threadViewport}>
              {!selectedProject ? (
                <div className={styles.startState}>
                  <h2>Open a folder to begin.</h2>
                  <p>
                    Continue the same Sessions from Khai-Agents CLI, with tools,
                    approvals, changes, and tests kept in one local workspace.
                  </p>
                  <div className={styles.startActions}>
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          if (await ui.confirmDiscardInspectorDraft()) {
                            await controller.openProject();
                          }
                        })();
                      }}
                    >
                      <FolderOpen size={16} />
                      Open project folder
                    </button>
                    <span>Local runtime · shared Session history</span>
                  </div>
                </div>
              ) : !selectedThread ? (
                <div className={styles.startState}>
                  <p className={styles.startEyebrow}>
                    {selectedProject.displayName}
                  </p>
                  <h2>No Sessions here yet.</h2>
                  <p>
                    Start with a clear outcome and a way to verify it. Khai-Agents
                    will keep the conversation and execution trail together.
                  </p>
                  <div className={styles.startActions}>
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          if (await ui.confirmDiscardInspectorDraft()) {
                            await controller.createThread();
                          }
                        })();
                      }}
                    >
                      <MessageSquarePlus size={16} />
                      New thread
                    </button>
                    <span>⌘N from anywhere</span>
                  </div>
                </div>
              ) : (
                <Suspense
                  fallback={<LoadingSurface>Loading Session…</LoadingSurface>}
                >
                  <ThreadConversation
                    key={selectedThread.id}
                    turns={state.turns}
                    items={state.items}
                    approvals={state.approvals}
                    plansByTurnId={state.plansByTurnId}
                    compactions={state.compactions}
                    selectedItemId={state.selectedItemId}
                    transcriptMode={transcript.mode}
                    busy={state.busy}
                    planProgressExpanded={planProgressExpanded}
                    onSelectItem={controller.selectItem}
                    onOpenInspector={ui.openInspector}
                    onRespondToApproval={(approvalId, decision) =>
                      void controller.respondToApproval(approvalId, decision)
                    }
                    onRetryTurn={(turnId) => void controller.retryTurn(turnId)}
                    onCancelQueuedTurn={(turnId) =>
                      void controller.interruptTurn(turnId)
                    }
                  />
                </Suspense>
              )}
            </section>

            {selectedThread?.mode === "paper" ? (
              <Suspense
                fallback={
                  <LoadingSurface compact>
                    Loading workflow controls…
                  </LoadingSurface>
                }
              >
                <WorkflowComposer
                  enabled={agentExecutionEnabled}
                  busy={state.busy}
                  workflow={latestWorkflow}
                  disabledReason={disabledReason}
                  onPickFile={controller.pickWorkflowFile}
                  onStart={controller.startWorkflow}
                  onRetry={controller.retryWorkflow}
                  onRespond={controller.respondToWorkflow}
                  onInterrupt={() => void controller.interrupt()}
                />
              </Suspense>
            ) : selectedThread ? (
              <Composer
                key={selectedThread.id}
                editable={composerEditable}
                canExecute={agentExecutionEnabled}
                busy={state.busy}
                conversationStarted={state.turns.some(
                  (turn) => turn.threadId === selectedThread.id,
                )}
                executingTurn={activeTurn}
                planProgress={planProgress}
                onPlanProgressExpandedChange={(expanded) =>
                  setExpandedPlanThreadId(expanded ? selectedThread.id : null)
                }
                queuedTurns={queuedTurns}
                runtime={runtime}
                project={selectedProject}
                thread={selectedThread}
                settings={state.settings}
                goal={state.goal}
                goalOutcome={state.goalOutcome}
                goalTurns={
                  state.goal
                    ? state.turns.filter(
                        (turn) => turn.goalId === state.goal?.id,
                      )
                    : []
                }
                disabledReason={disabledReason}
                transcriptMode={transcript.mode}
                onTranscriptModeChange={transcript.selectMode}
                onModelChange={(
                  connectionId,
                  model,
                  reasoningEffort,
                  contextWindow,
                ) =>
                  void controller.setThreadExecution(
                    connectionId,
                    model,
                    reasoningEffort,
                    contextWindow,
                  )
                }
                onAccessPresetChange={controller.setAccessPreset}
                onSetGoal={controller.setGoal}
                onPauseGoal={controller.pauseGoal}
                onResumeGoal={controller.resumeGoal}
                onContinueGoal={controller.continueGoal}
                onClearGoal={controller.clearGoal}
                onSelectGoalEvidence={(itemId) => {
                  controller.selectItem(itemId);
                  ui.openInspector("details");
                }}
                onPickContextFiles={controller.pickContextFiles}
                onCommand={runComposerCommand}
                onSend={controller.sendTurn}
                onQueue={controller.queueTurn}
                onInterrupt={() => void controller.interrupt()}
                launchIntent={composerIntent}
                onLaunchIntentConsumed={() => setComposerIntent(null)}
                onManageProviders={() => ui.openSettings("models")}
                hasActiveWork={hasPendingTurn || activeWorkflow}
                projects={state.projects}
                onSwitchProject={(projectId) => {
                  void (async () => {
                    if (await ui.confirmDiscardInspectorDraft()) {
                      await controller.selectProject(projectId);
                    }
                  })();
                }}
                onTrustProject={() => void controller.trustProject()}
                onForkThread={() => {
                  void (async () => {
                    if (await ui.confirmDiscardInspectorDraft()) {
                      await controller.forkThread();
                    }
                  })();
                }}
                onCreatePaperThread={() => {
                  void (async () => {
                    if (await ui.confirmDiscardInspectorDraft()) {
                      await controller.createThread("paper");
                    }
                  })();
                }}
                onOpenSettings={(section) => ui.openSettings(section)}
                contextUsage={state.contextUsage}
                compacting={state.compactions.some(
                  (entry) => entry.status === "running",
                )}
                onCompact={() => void controller.compactThread()}
                onOpenProject={() => {
                  void (async () => {
                    if (await ui.confirmDiscardInspectorDraft()) {
                      await controller.openProject();
                    }
                  })();
                }}
              />
            ) : null}
          </>
        ) : (
          <Suspense
            fallback={<LoadingSurface>Loading workspace…</LoadingSurface>}
          >
            <ManagementWorkspace
              destination={ui.destination}
              runtime={runtime}
              project={selectedProject}
              onThreadCreated={controller.registerThread}
              onOpenThread={(threadId) => {
                void (async () => {
                  if (await ui.navigateTo("threads")) {
                    await controller.selectThread(threadId);
                  }
                })();
              }}
              onCreateSkill={createSkillThread}
            />
          </Suspense>
        )}
      </section>

      {inspectorVisible ? (
        <section className={styles.reviewPane} aria-label="Review panel">
          <ReviewResizer
            width={reviewWidth}
            sidebarWidth={sidebarHidden ? 0 : sidebarWidth}
            onResize={setReviewWidth}
          />
          <Suspense fallback={<LoadingSurface>Loading review…</LoadingSurface>}>
            <Inspector
              runtime={runtime}
              thread={selectedThread}
              trusted={selectedProject?.trustState === "trusted"}
              turns={state.turns}
              workflows={state.workflows}
              artifacts={state.artifacts}
              tab={ui.inspectorTab}
              onTabChange={ui.setInspectorTab}
              onDirtyChange={ui.setInspectorDirty}
              onClose={() => void ui.closeInspector()}
              sessionScoped={isChatsProject(selectedProject)}
              wide={reviewWide}
              onToggleWide={() => {
                if (reviewWide) {
                  setReviewWidth(narrowWidthRef.current);
                } else {
                  narrowWidthRef.current = reviewWidth;
                  setReviewWidth(
                    Math.max(320, window.innerWidth - (sidebarHidden ? 0 : sidebarWidth) - 460),
                  );
                }
              }}
            />
          </Suspense>
        </section>
      ) : null}

      {ui.settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsDialog
            runtime={runtime}
            project={selectedProject}
            settings={state.settings}
            busy={state.busy}
            onRefresh={controller.refreshSettings}
            onUpdate={controller.updateSettings}
            onClose={ui.closeSettings}
            initialSection={ui.settingsSection}
            onCreateSkill={createSkillThread}
          />
        </Suspense>
      ) : null}
    </main>
  );
}
