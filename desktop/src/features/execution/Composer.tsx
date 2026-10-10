import { ProviderKeyNotice } from "./ProviderKeyNotice";
import {
  Atom,
  Check,
  ChevronDown,
  ChevronRight,
  BookOpen,
  FileDiff,
  Minimize2,
  Pencil,
  Box,
  Shield,
  SquarePen,
  ArrowUp,
  Folder,
  FolderPlus,
  FolderX,
  GitFork,
  Globe,
  Github,
  Laptop,
  Mic,
  Paperclip,
  Plug,
  Plus,
  Puzzle,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  SquareSlash,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type {
  ExecutionAccessPreset,
  Goal,
  GoalOutcome,
  Project,
  SettingsSnapshot,
  Thread,
  Turn,
} from "../../generated/app-server";
import type { GoalDefinitionInput } from "../../app/useWorkspaceController";
import type {
  InteractiveDelivery,
  TurnMode,
  TurnSendOptions,
} from "../../app/interactiveTurnRouter";
import { useComposerBehavior } from "../../app/composerBehavior";
import { useTranslation } from "react-i18next";
import {
  settingsDefaultAccessLabel,
  settingsProductAccessPreset,
  turnExecutionAccessLabel,
  turnExecutionAccessState,
} from "../../app/accessPreset";
import type { ClientRuntime } from "../../rpc/contracts";
import type { TranscriptMode } from "../thread/transcriptMode";
import { PresetPicker } from "../presets/PresetPicker";
import { usePresetCatalog } from "../presets/usePresetCatalog";
import { useSkillCatalog } from "../skills/useSkillCatalog";
import {
  type CommandDefinition,
  matchingCommands,
  parseComposerCommand,
  type ComposerCommand,
} from "./commands";
import styles from "./Composer.module.css";
import { useDictation } from "./useDictation";
import { usePromptDraft } from "./usePromptDraft";
import { Dropdown } from "../../components/Dropdown";
import { isRecoveredHistoryProject } from "../../app/projectPresentation";
import { isChatsProject } from "../../app/chats";
import mascotUrl from "../../assets/khai-mascot.png";
import { MOCK_ACCOUNT } from "../../mocks/preview";
import {
  isInsideWorkspace,
  withContextFiles,
  executionTarget,
  withSearch,
} from "./promptModes";
import { ModelPicker } from "./ModelPicker";
import { ContextRing } from "./ContextRing";
import { CreditBar } from "./CreditBar";
import { FileCard } from "../../components/FileCard";
import type { ContextUsage } from "../../app/workspaceState";
import type { TurnPlanState } from "../../app/workspaceState";
import { PlanProgress } from "../thread/PlanProgress";

interface ComposerProps {
  editable: boolean;
  canExecute: boolean;
  busy: boolean;
  /** True once this thread has any Turn — the agent preset is then fixed. */
  conversationStarted: boolean;
  executingTurn: Turn | null;
  planProgress?: TurnPlanState | null;
  onPlanProgressExpandedChange?(expanded: boolean): void;
  queuedTurns: readonly Turn[];
  runtime: ClientRuntime;
  project: Project | null;
  thread: Thread | null;
  settings: SettingsSnapshot | null;
  goal: Goal | null;
  goalOutcome: GoalOutcome | null;
  goalTurns: readonly Turn[];
  disabledReason: string | null;
  transcriptMode: TranscriptMode;
  onTranscriptModeChange(mode: TranscriptMode): void;
  onModelChange(
    connectionId: string | null,
    model: string | null,
    reasoningEffort: string | null,
    contextWindow: number | null,
  ): void;
  onAccessPresetChange(preset: ExecutionAccessPreset | null): Promise<boolean>;
  onSetGoal(input: GoalDefinitionInput): Promise<void>;
  onPauseGoal(): Promise<void>;
  onResumeGoal(): Promise<void>;
  onContinueGoal(): Promise<void>;
  onClearGoal(): Promise<void>;
  onSelectGoalEvidence(itemId: string): void;
  onPickContextFiles(): Promise<string[]>;
  onCommand(command: ComposerCommand): Promise<boolean>;
  onSend(
    prompt: string,
    skillIds?: string[],
    options?: TurnSendOptions,
  ): Promise<InteractiveDelivery | null>;
  onQueue(
    prompt: string,
    skillIds?: string[],
    options?: TurnSendOptions,
  ): Promise<boolean>;
  onInterrupt(): void;
  launchIntent: ComposerLaunchIntent | null;
  onLaunchIntentConsumed(): void;
  onManageProviders?: () => void;
  onOpenProject?: () => void;
  onOpenSettings?: (section: string) => void;
  hasActiveWork?: boolean;
  projects?: Project[];
  onSwitchProject?: (projectId: string) => void;
  onTrustProject?: () => void;
  onForkThread?: () => void;
  onCreatePaperThread?: () => void;
  /** Latest measured fill of this thread's model context. */
  contextUsage?: ContextUsage | null;
  /** A `/compact` is summarizing this thread right now. */
  compacting?: boolean;
  onCompact?: () => void;
}

export interface ComposerLaunchIntent {
  threadId: string;
  prompt: string;
  skillIds: string[];
  /** Send the prompt as soon as the composer mounts (home-screen start). */
  autoSend?: boolean;
  /** Execution mode chosen on the home screen (DeepThink toggle). */
  mode?: TurnMode;
}

export function Composer({
  editable,
  canExecute,
  busy,
  conversationStarted,
  executingTurn,
  planProgress = null,
  onPlanProgressExpandedChange,
  queuedTurns,
  runtime,
  project,
  thread,
  settings,
  disabledReason,
  onModelChange,
  onAccessPresetChange,
  onPickContextFiles,
  onCommand,
  onSend,
  onQueue,
  onInterrupt,
  launchIntent,
  onLaunchIntentConsumed,
  onManageProviders,
  onOpenProject,
  onOpenSettings,
  hasActiveWork = false,
  projects = [],
  onSwitchProject,
  onTrustProject,
  onForkThread,
  onCreatePaperThread,
  contextUsage = null,
  compacting = false,
  onCompact,
}: ComposerProps) {
  const recoveredHistory = isRecoveredHistoryProject(project);
  const plainChat = isChatsProject(project);
  const trusted =
    project?.trustState === "trusted" && !recoveredHistory && !plainChat;
  const active = executingTurn !== null;
  const { busyEnter } = useComposerBehavior();
  const { t } = useTranslation();
  const initialLaunch =
    launchIntent && launchIntent.threadId === thread?.id ? launchIntent : null;
  const {
    prompt,
    setPrompt,
    record,
    browse,
    browsingHistory,
    attachments,
    addAttachments,
    removeAttachment,
    clearAttachments,
  } = usePromptDraft(
    thread?.id ?? "unselected",
    initialLaunch?.prompt,
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const caretRef = useRef<number | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(() =>
    initialLaunch?.skillIds ?? [],
  );
  const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);
  const [searchOn, setSearchOn] = useState(false);
  // DeepThink runs the next message through the multi-step pipeline
  // (plan, web search, check, summarize) instead of a single agent pass.
  const [deepThinkOn, setDeepThinkOn] = useState(
    () => initialLaunch?.mode === "deepthink",
  );
  const toggleDeepThink = () => setDeepThinkOn((on) => !on);
  const sendOptions: TurnSendOptions = deepThinkOn ? { mode: "deepthink" } : {};
  const dictation = useDictation({
    runtime,
    onTranscript: insertDictation,
  });
  const skillCatalog = useSkillCatalog(runtime, project?.id ?? null);
  const presetCatalog = usePresetCatalog(
    runtime,
    project?.id ?? null,
    thread?.id ?? null,
  );
  const availableSkills = useMemo(() => {
    const query = skillQuery.trim().toLocaleLowerCase();
    return skillCatalog.activeSkills.filter(
      (skill) =>
        !query ||
        skill.name.toLocaleLowerCase().includes(query) ||
        skill.description.toLocaleLowerCase().includes(query) ||
        skill.displayName?.toLocaleLowerCase().includes(query) ||
        skill.shortDescription?.toLocaleLowerCase().includes(query),
    );
  }, [skillCatalog.activeSkills, skillQuery]);
  const selectedSkills = useMemo(() => {
    if (active) return [];
    const byId = new Map(skillCatalog.skills.map((skill) => [skill.id, skill]));
    return selectedSkillIds.flatMap((skillId) => {
      const skill = byId.get(skillId);
      return skill ? [skill] : [];
    });
  }, [active, selectedSkillIds, skillCatalog.skills]);
  const accessPresetOverride = thread?.accessPresetOverride ?? null;
  const effectiveProductAccess =
    accessPresetOverride ?? settingsProductAccessPreset(settings);
  const defaultAccessLabel = settingsDefaultAccessLabel(settings);
  const executingAccessLabel = executingTurn
    ? turnExecutionAccessLabel(executingTurn)
    : null;
  const executingAccessState = executingTurn
    ? turnExecutionAccessState(executingTurn)
    : null;
  const queuedAccessLabels = [
    ...new Set(queuedTurns.map(turnExecutionAccessLabel)),
  ];
  const queuedAccessStates = queuedTurns.map(turnExecutionAccessState);
  const queuedAccessState = queuedAccessStates.includes("full_access")
    ? "full_access"
    : new Set(queuedAccessStates).size === 1
      ? queuedAccessStates[0]
      : "mixed";

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    // Grow with the prompt up to nearly half the window before scrolling.
    const cap = Math.max(190, Math.round(window.innerHeight * 0.45));
    textarea.style.height = `${Math.min(textarea.scrollHeight, cap)}px`;
    // A dictated transcript is inserted mid-text, so the caret has to be put
    // back where the text ended instead of jumping to the end of the draft.
    const caret = caretRef.current;
    if (caret !== null) {
      caretRef.current = null;
      textarea.setSelectionRange(caret, caret);
    }
  }, [prompt]);

  useEffect(() => {
    if (!initialLaunch) return;
    textareaRef.current?.focus();
    onLaunchIntentConsumed();
  }, [initialLaunch, onLaunchIntentConsumed]);

  // A home-screen start sends once the new thread can actually execute: the
  // composer mounts while the create call is still marked busy.
  const autoSendRef = useRef(initialLaunch?.autoSend ?? false);
  useEffect(() => {
    if (!autoSendRef.current || busy || !canExecute || !prompt.trim()) return;
    autoSendRef.current = false;
    void submit();
  });

  /**
   * Insert a transcript at the caret.
   *
   * Function declaration (not a const) because `useDictation` is constructed
   * above it and only calls back after the user speaks.
   */
  function insertDictation(text: string): void {
    const textarea = textareaRef.current;
    const start = textarea ? textarea.selectionStart : prompt.length;
    const end = textarea ? textarea.selectionEnd : prompt.length;
    const before = prompt.slice(0, start);
    const after = prompt.slice(end);
    const separator = before && !/\s$/.test(before) ? " " : "";
    const insertion = `${separator}${text}`;
    setPrompt(`${before}${insertion}${after}`);
    caretRef.current = start + insertion.length;
    setCommandError(null);
    setDeliveryNotice(null);
    textarea?.focus();
  }

  const submit = async () => {
    const value = prompt.trim();
    if (!value || !canExecute || busy) return;
    const parsed = parseComposerCommand(value);
    if (parsed) {
      if (!parsed.ok) {
        setCommandError(parsed.message);
        return;
      }
      record(value);
      if (!(await onCommand(parsed.command))) return;
      setPrompt("");
      setCommandError(null);
      return;
    }
    if (compacting) {
      setCommandError("Compacting the conversation — send again when it finishes.");
      return;
    }
    record(value);
    const executionPrompt = withSearch(
      withContextFiles(value, attachments, thread?.workspacePath),
      searchOn && !deepThinkOn,
    );
    const selectable = new Set(skillCatalog.activeSkills.map((skill) => skill.id));
    const selectedIds = selectedSkillIds.filter((skillId) =>
      selectable.has(skillId),
    );
    const delivery = await onSend(executionPrompt, selectedIds, sendOptions);
    if (!delivery) return;
    setDeliveryNotice(
      delivery === "steered"
        ? "Update delivered to the active Turn."
        : delivery === "queued"
          ? "Queued for the next Turn."
          : "Started a new Turn.",
    );
    setPrompt("");
    clearAttachments();
    if (delivery !== "steered") setSelectedSkillIds([]);
    setSkillPickerOpen(false);
  };

  const submitQueued = async () => {
    const value = prompt.trim();
    if (!value || !canExecute || busy) return;
    if (parseComposerCommand(value)) {
      await submit();
      return;
    }
    const executionPrompt = withSearch(
      withContextFiles(value, attachments, thread?.workspacePath),
      searchOn && !deepThinkOn,
    );
    const selectable = new Set(skillCatalog.activeSkills.map((skill) => skill.id));
    const selectedIds = selectedSkillIds.filter((skillId) =>
      selectable.has(skillId),
    );
    if (!(await onQueue(executionPrompt, selectedIds, sendOptions))) return;
    record(value);
    setDeliveryNotice("Queued for the next Turn.");
    setPrompt("");
    clearAttachments();
    setSelectedSkillIds([]);
    setSkillPickerOpen(false);
  };
  const commandSuggestions = matchingCommands(prompt);
  const [commandIndex, setCommandIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const menuCommands = menuDismissed ? [] : commandSuggestions;
  useEffect(() => {
    setCommandIndex(0);
    if (!prompt.trimStart().startsWith("/")) setMenuDismissed(false);
  }, [prompt]);

  /** Arguments are typed after the name; argument-free commands run at once. */
  const selectCommand = (command: CommandDefinition) => {
    textareaRef.current?.focus();
    if (command.usage.endsWith(" ")) {
      setPrompt(command.usage);
      return;
    }
    const parsed = parseComposerCommand(command.usage);
    if (!parsed) return;
    if (!parsed.ok) {
      setCommandError(parsed.message);
      return;
    }
    void (async () => {
      if (await onCommand(parsed.command)) {
        setPrompt("");
        setCommandError(null);
      }
    })();
  };
  const dictationStatus = dictation.recording
    ? t("composer.dictation.recording", "Recording {{seconds}}s · stop to transcribe", {
        seconds: dictation.elapsedSeconds,
      })
    : dictation.transcribing
      ? t("composer.dictation.transcribing", "Transcribing…")
      : null;

  const pickContextFiles = async () => {
    setContextError(null);
    try {
      const selected = await onPickContextFiles();
      const workspace = thread?.workspacePath;
      const accepted = workspace
        ? selected.filter((path) => isInsideWorkspace(path, workspace))
        : [];
      if (accepted.length !== selected.length) {
        setContextError("Only files inside this Session workspace can be attached.");
      }
      addAttachments(accepted);
    } catch (error) {
      setContextError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLocaleLowerCase() === "u" &&
        editable &&
        !busy
      ) {
        event.preventDefault();
        void pickContextFiles();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuCommands.length && !event.nativeEvent.isComposing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setCommandIndex(
          (current) => (current + step + menuCommands.length) % menuCommands.length,
        );
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        const command = menuCommands[Math.min(commandIndex, menuCommands.length - 1)];
        const typed = prompt.trim();
        // A complete command with its argument runs through the normal submit.
        if (!(event.key === "Enter" && typed.length > command.usage.trim().length)) {
          event.preventDefault();
          selectCommand(command);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuDismissed(true);
        return;
      }
    }
    if (event.key === "Escape" && dictation.recording) {
      event.preventDefault();
      dictation.cancel();
      return;
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      // While a Turn runs, plain Enter follows the busy-Enter preference
      // (steer or queue); Cmd/Ctrl+Enter always performs the other verb.
      const inverted = event.metaKey || event.ctrlKey;
      const queues = active && (busyEnter === "queue") !== inverted;
      if (queues) {
        void submitQueued();
      } else {
        void submit();
      }
      return;
    }
    if (
      event.key === "ArrowUp" &&
      (!prompt || browsingHistory) &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      event.preventDefault();
      browse("older");
    } else if (
      event.key === "ArrowDown" &&
      browsingHistory &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      browse("newer");
    }
  };

  const notice =
    commandError ??
    contextError ??
    dictation.error ??
    deliveryNotice ??
    dictationStatus ??
    disabledReason;

  return (
    <footer
      className={styles.region}
      data-centered={!conversationStarted || undefined}
    >
      {!conversationStarted ? (
        <h2 className={styles.greeting}>
          <img src={mascotUrl} alt="" className={styles.greetingMascot} />
          Hi {MOCK_ACCOUNT.name}. How can I help?
        </h2>
      ) : null}
      <div className={styles.chips}>
        <span className={styles.chip} title="Runs on this machine">
          <Laptop size={13} />
          Local
        </span>
        <Dropdown
          triggerClassName={styles.chip}
          triggerLabel="Folder"
          title={thread?.workspacePath ?? project?.canonicalPath ?? undefined}
          placement="up"
          trigger={
            <>
              {recoveredHistory ? <FolderX size={13} /> : <Folder size={13} />}
              {recoveredHistory
                ? "Folder unavailable"
                : plainChat
                  ? "No folder"
                  : project?.displayName ?? "Pick a folder…"}
              {trusted ? (
                <ShieldCheck
                  size={13}
                  className={styles.trusted}
                  aria-label="Trusted folder"
                />
              ) : null}
            </>
          }
          sections={[
            {
              title: "Recent",
              items: [...projects]
                .filter(
                  (entry) => !isRecoveredHistoryProject(entry) && !isChatsProject(entry),
                )
                .sort((left, right) =>
                  right.lastOpenedAt.localeCompare(left.lastOpenedAt),
                )
                .slice(0, 8)
                .map((entry) => ({
                  id: entry.id,
                  label: entry.displayName,
                  selected: entry.id === project?.id,
                  disabled: busy,
                  onSelect: () => {
                    if (entry.id !== project?.id) onSwitchProject?.(entry.id);
                  },
                })),
            },
            {
              items: onOpenProject
                ? [{ id: "open", label: "Open folder…", onSelect: onOpenProject }]
                : [],
            },
          ]}
        />
        {project?.trustState === "untrusted" && !recoveredHistory && onTrustProject ? (
          <button
            type="button"
            className={styles.trustButton}
            onClick={onTrustProject}
            disabled={busy}
          >
            <ShieldAlert size={13} />
            Trust folder
          </button>
        ) : null}
        {onOpenProject ? (
          <button
            type="button"
            className={styles.chipButton}
            onClick={onOpenProject}
            disabled={busy}
            aria-label="Open another folder"
            title="Open another folder"
          >
            <FolderPlus size={14} />
          </button>
        ) : null}
        <CreditBar
          runtime={runtime}
          threadId={thread?.id ?? null}
          refreshKey={`${contextUsage?.at ?? ""}|${active}`}
        />
      </div>
      <ProviderKeyNotice
        runtime={runtime}
        projectId={project?.id ?? null}
        connectionId={executionTarget(thread, settings).connection}
        onOpenSettings={onOpenSettings}
      />
      <div className={styles.composer}>
        {planProgress?.steps.length ? (
          <PlanProgress
            inline
            plan={planProgress}
            onExpandedChange={onPlanProgressExpandedChange}
          />
        ) : null}
        {conversationStarted ? (
          <img src={mascotUrl} alt="" className={styles.mascot} />
        ) : null}
        <label className={styles.promptLabel} htmlFor="turn-prompt">
          Task instruction
        </label>
        {menuCommands.length ? (
          <div className={styles.slashMenu} role="listbox" aria-label="Commands">
            {menuCommands.map((command, index) => {
              const meta = COMMAND_META[command.name];
              const Icon = meta?.icon ?? SquareSlash;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === commandIndex}
                  key={command.name}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => selectCommand(command)}
                >
                  <Icon size={16} className={styles.slashIcon} />
                  <strong>{meta?.title ?? command.name}</strong>
                  <span>{command.description}</span>
                  {command.usage.endsWith(" ") ? (
                    <ChevronRight size={15} className={styles.slashChevron} />
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
        {skillPickerOpen && !active ? (
          <section className={styles.skillMenu} aria-label="Select Skills">
            <header>
              <div>
                <strong>Skills for this turn</strong>
                <span>Choose up to 8. You can also type $name.</span>
              </div>
              <button
                type="button"
                onClick={() => setSkillPickerOpen(false)}
                aria-label="Close Skill picker"
              >
                <X size={14} />
              </button>
            </header>
            <input
              value={skillQuery}
              onChange={(event) => setSkillQuery(event.target.value)}
              placeholder="Filter Skills"
              aria-label="Filter Skills"
              autoFocus
            />
            <div className={styles.skillOptions} role="listbox" aria-multiselectable>
              {availableSkills.length ? (
                availableSkills.map((skill) => {
                  const selected = selectedSkillIds.includes(skill.id);
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      key={skill.id}
                      onClick={() =>
                        setSelectedSkillIds((current) => {
                          const selectable = new Set(
                            skillCatalog.activeSkills.map((entry) => entry.id),
                          );
                          const valid = current.filter((skillId) =>
                            selectable.has(skillId),
                          );
                          return selected
                            ? valid.filter((skillId) => skillId !== skill.id)
                            : valid.length < 8
                              ? [...valid, skill.id]
                              : valid;
                        })
                      }
                    >
                      <span className={styles.skillCheck}>
                        {selected ? <Check size={12} /> : null}
                      </span>
                      <span>
                        <strong>{skill.displayName ?? skill.name}</strong>
                        <small>
                          {skill.shortDescription ?? skill.description}
                        </small>
                      </span>
                      <em>{skill.originLabel}</em>
                    </button>
                  );
                })
              ) : (
                <p>
                  {skillCatalog.loading
                    ? "Loading Skills…"
                    : skillCatalog.error ?? "No matching Skills."}
                </p>
              )}
            </div>
          </section>
        ) : null}
        {selectedSkills.length ? (
          <div className={styles.skills} aria-label="Selected Skills">
            {selectedSkills.map((skill) => (
              <span
                key={skill.id}
                title={skill.shortDescription ?? skill.description}
              >
                <Sparkles size={12} />
                {skill.displayName ?? skill.name}
                <button
                  type="button"
                  onClick={() =>
                    setSelectedSkillIds((current) =>
                      current.filter((skillId) => skillId !== skill.id),
                    )
                  }
                  aria-label={`Remove ${skill.name}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {attachments.length ? (
          <div className={styles.attachments} aria-label="Attached context files">
            {attachments.map((path) => (
              <FileCard key={path} path={path} size="compact" onRemove={() => removeAttachment(path)} />
            ))}
          </div>
        ) : null}
        {executingTurn || queuedTurns.length ? (
          <div
            className={styles.accessStatusRail}
            aria-label="Frozen Turn access"
          >
            <div className={styles.accessStatuses}>
              {executingTurn && executingAccessLabel ? (
                <span
                  className={styles.accessStatus}
                  data-access={executingAccessState}
                  aria-label={`Current Turn access: ${executingAccessLabel}`}
                >
                  <strong>Current Turn</strong>
                  <i aria-hidden="true">·</i>
                  {executingAccessLabel}
                </span>
              ) : null}
              {queuedTurns.length ? (
                <span
                  className={styles.accessStatus}
                  data-access={queuedAccessState}
                  aria-label={`Queued Turn access: ${queuedAccessLabels.join(
                    ", ",
                  )}`}
                >
                  <strong>Queued ({queuedTurns.length})</strong>
                  <i aria-hidden="true">·</i>
                  {queuedAccessLabels.join(" · ")}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className={styles.inputRow}>
          <textarea
            ref={textareaRef}
            id="turn-prompt"
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              setCommandError(null);
              setDeliveryNotice(null);
            }}
            onKeyDown={onKeyDown}
            placeholder={
              active
                ? "Send guidance to the running turn…"
                : "Type / for commands"
            }
            rows={1}
            disabled={!editable}
          />
          {active ? (
            <button
              className={styles.stopButton}
              type="button"
              onClick={onInterrupt}
              aria-label="Stop turn"
              title="Stop"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              className={styles.sendButton}
              type="button"
              onClick={() => void submit()}
              disabled={!canExecute || busy || !prompt.trim()}
              aria-label="Run turn"
              title="Send"
            >
              <ArrowUp size={16} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.context}>
          <PlusMenu
            disabled={!editable || busy}
            skillsAvailable={
              !active && skillCatalog.activeSkills.length > 0
            }
            selectedSkills={selectedSkills.length}
            onAddFiles={() => void pickContextFiles()}
            onAddFolder={onOpenProject}
            onSlashCommands={() => {
              setPrompt("/");
              textareaRef.current?.focus();
            }}
            onImportIssue={() => {
              // TODO(backend): fetch the issue; for now seed the prompt.
              setPrompt("Fix this GitHub issue: <paste the issue URL>");
              textareaRef.current?.focus();
            }}
            onSkills={() => setSkillPickerOpen(true)}
            onForkThread={trusted ? onForkThread : undefined}
            onCreatePaperThread={
              trusted && thread?.mode !== "paper" ? onCreatePaperThread : undefined
            }
            threadActionsDisabled={busy || hasActiveWork}
            onConnectors={
              onOpenSettings ? () => onOpenSettings("mcp") : undefined
            }
            onPlugins={
              onOpenSettings ? () => onOpenSettings("plugins") : undefined
            }
          />
          <button
            type="button"
            className={styles.toggle}
            aria-pressed={deepThinkOn}
            onClick={toggleDeepThink}
            disabled={!editable}
            title="Plan, search the web, check and summarize before answering"
          >
            <Atom size={14} />
            DeepThink
          </button>
          <button
            type="button"
            className={styles.toggle}
            aria-pressed={searchOn}
            onClick={() => setSearchOn((on) => !on)}
            disabled={!editable}
            title="Ask the agent to search the web for this message"
          >
            <Globe size={14} />
            Search
          </button>
          {dictation.available ? (
            <button
              className={styles.iconButton}
              data-recording={dictation.recording}
              type="button"
              onClick={dictation.toggle}
              disabled={
                dictation.transcribing || (!editable && !dictation.recording)
              }
              aria-pressed={dictation.recording}
              aria-label={
                dictation.recording
                  ? t("composer.dictation.stop", "Stop and transcribe")
                  : t("composer.dictation.start", "Start voice input")
              }
              title={
                dictation.recording
                  ? t("composer.dictation.stop", "Stop and transcribe")
                  : t("composer.dictation.start", "Start voice input")
              }
            >
              {dictation.recording ? <Square size={12} /> : <Mic size={15} />}
            </button>
          ) : null}
          {dictation.recording ? (
            <button
              className={styles.iconButton}
              type="button"
              onClick={dictation.cancel}
              aria-label={t("composer.dictation.cancel", "Discard recording")}
              title={t("composer.dictation.cancel", "Discard recording")}
            >
              <X size={13} />
            </button>
          ) : null}
          <ModeMenu
            value={accessPresetOverride}
            defaultLabel={defaultAccessLabel}
            effective={effectiveProductAccess}
            disabled={busy || !thread}
            onChange={(preset) => void onAccessPresetChange(preset)}
          />
          <PresetPicker
            entries={presetCatalog.entries}
            current={presetCatalog.current}
            locked={conversationStarted}
            busy={busy || presetCatalog.busy}
            error={presetCatalog.error}
            onSelect={(presetId) => void presetCatalog.select(presetId)}
          />
        </div>
        <div className={styles.toolbarRight}>
          <ModelPicker
            runtime={runtime}
            project={project}
            thread={thread}
            settings={settings}
            disabled={busy}
            onChange={onModelChange}
            onManageProviders={onManageProviders}
          />
          <ContextRing
            runtime={runtime}
            thread={thread}
            usage={contextUsage}
            compacting={compacting}
            canCompact={!active && !hasActiveWork}
            onCompact={onCompact}
            onOpenUsage={
              onOpenSettings ? () => onOpenSettings("usage") : undefined
            }
          />
        </div>
      </div>
      {notice || active ? (
        <p className={styles.hint}>
          {notice}
          {active ? (
            <span>
              {busyEnter === "queue"
                ? t("composer.hint.queueSteer", "↵ queue · ⌘↵ steer")
                : t("composer.hint.steerQueue", "↵ steer · ⌘↵ queue")}
            </span>
          ) : null}
        </p>
      ) : null}
    </footer>
  );
}


/** Close a popover on an outside click or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return { open, setOpen, rootRef };
}

interface PlusMenuProps {
  disabled: boolean;
  skillsAvailable: boolean;
  selectedSkills: number;
  onAddFiles(): void;
  onAddFolder?: () => void;
  onSlashCommands(): void;
  onImportIssue(): void;
  onSkills(): void;
  onConnectors?: () => void;
  onPlugins?: () => void;
  onForkThread?: () => void;
  onCreatePaperThread?: () => void;
  threadActionsDisabled: boolean;
}

/** The "+" menu: everything that adds context or capability to a prompt. */
function PlusMenu({
  disabled,
  skillsAvailable,
  selectedSkills,
  onAddFiles,
  onAddFolder,
  onSlashCommands,
  onImportIssue,
  onSkills,
  onConnectors,
  onPlugins,
  onForkThread,
  onCreatePaperThread,
  threadActionsDisabled,
}: PlusMenuProps) {
  const { open, setOpen, rootRef } = usePopover();
  const run = (action?: () => void) => () => {
    setOpen(false);
    action?.();
  };
  return (
    <div className={styles.popoverRoot} ref={rootRef}>
      <button
        className={styles.iconButton}
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add to prompt"
        title="Add to prompt"
      >
        <Plus size={16} />
        {selectedSkills ? <b>{selectedSkills}</b> : null}
      </button>
      {open ? (
        <div className={styles.popover} role="menu">
          <button type="button" role="menuitem" onClick={run(onAddFiles)}>
            <Paperclip size={15} />
            Add files
            <kbd>Ctrl+U</kbd>
          </button>
          {onAddFolder ? (
            <button type="button" role="menuitem" onClick={run(onAddFolder)}>
              <Folder size={15} />
              Add folder
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={run(onImportIssue)}>
            <Github size={15} />
            Import GitHub issue
          </button>
          <button type="button" role="menuitem" onClick={run(onSlashCommands)}>
            <SquareSlash size={15} />
            Slash commands
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(onSkills)}
            disabled={!skillsAvailable}
          >
            <ScrollText size={15} />
            Skills
          </button>
          {onConnectors ? (
            <button type="button" role="menuitem" onClick={run(onConnectors)}>
              <Plug size={15} />
              Connectors
            </button>
          ) : null}
          {onPlugins ? (
            <button type="button" role="menuitem" onClick={run(onPlugins)}>
              <Puzzle size={15} />
              Add plugins
            </button>
          ) : null}
          {onForkThread || onCreatePaperThread ? <hr /> : null}
          {onForkThread ? (
            <button
              type="button"
              role="menuitem"
              onClick={run(onForkThread)}
              disabled={threadActionsDisabled}
              title="Fork into an isolated worktree"
            >
              <GitFork size={15} />
              Fork thread
            </button>
          ) : null}
          {onCreatePaperThread ? (
            <button
              type="button"
              role="menuitem"
              onClick={run(onCreatePaperThread)}
              disabled={threadActionsDisabled}
            >
              <ScrollText size={15} />
              New Paper2Code thread
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const MODE_OPTIONS: ReadonlyArray<{
  value: ExecutionAccessPreset | null;
  label: string;
  description: string;
}> = [
  { value: null, label: "Default", description: "Use the access set in Settings" },
  { value: "ask", label: "Ask", description: "Ask before running tools that change things" },
  { value: "read_only", label: "Read only", description: "Read and plan without changing files" },
];

interface ModeMenuProps {
  value: ExecutionAccessPreset | null;
  defaultLabel: string;
  effective: ExecutionAccessPreset | null;
  disabled: boolean;
  onChange(preset: ExecutionAccessPreset | null): void;
}

/** Access mode for new submissions, with numbered shortcuts while open. */
function ModeMenu({
  value,
  defaultLabel,
  effective,
  disabled,
  onChange,
}: ModeMenuProps) {
  const { open, setOpen, rootRef } = usePopover();
  const choose = (preset: ExecutionAccessPreset | null) => {
    setOpen(false);
    if (preset !== value) onChange(preset);
  };

  useEffect(() => {
    if (!open) return;
    const pick = (event: globalThis.KeyboardEvent) => {
      const index = Number(event.key) - 1;
      if (index >= 0 && index < MODE_OPTIONS.length) {
        event.preventDefault();
        choose(MODE_OPTIONS[index].value);
      }
    };
    document.addEventListener("keydown", pick);
    return () => document.removeEventListener("keydown", pick);
  });

  const label =
    value === "full_access"
      ? "Bypass permissions"
      : value
        ? MODE_OPTIONS.find((option) => option.value === value)?.label ?? value
        : "Default";
  return (
    <div className={styles.popoverRoot} ref={rootRef}>
      <button
        type="button"
        className={styles.modeTrigger}
        data-access={effective ?? "inherit"}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Access mode for new submissions"
        title={value ? label : `Default · ${defaultLabel}`}
      >
        {label}
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div className={styles.popover} data-wide role="menu">
          <p className={styles.popoverTitle}>Mode</p>
          {MODE_OPTIONS.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                key={option.label}
                className={styles.modeOption}
                onClick={() => choose(option.value)}
              >
                <span>
                  <strong>
                    {option.label}
                    {option.value === null ? ` · ${defaultLabel}` : ""}
                  </strong>
                  <small>{option.description}</small>
                </span>
                {selected ? <Check size={14} /> : null}
                <kbd>{index + 1}</kbd>
              </button>
            );
          })}
          <hr />
          <div className={styles.bypassRow}>
            <span>Bypass permissions</span>
            <button
              type="button"
              data-on={value === "full_access"}
              onClick={() =>
                choose(value === "full_access" ? null : "full_access")
              }
            >
              {value === "full_access" ? "Disable" : "Enable"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}



/** Display names and icons for the slash menu. */
const COMMAND_META: Record<string, { title: string; icon: typeof SquarePen }> = {
  new: { title: "New chat", icon: SquarePen },
  init: { title: "Init", icon: BookOpen },
  paper: { title: "Paper2Code", icon: ScrollText },
  review: { title: "Review", icon: FileDiff },
  fork: { title: "Fork", icon: GitFork },
  rename: { title: "Rename", icon: Pencil },
  compact: { title: "Compact", icon: Minimize2 },
  model: { title: "Model", icon: Box },
  permissions: { title: "Permissions", icon: Shield },
};
