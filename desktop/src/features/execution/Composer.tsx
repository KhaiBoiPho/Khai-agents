import {
  Check,
  CornerDownLeft,
  Folder,
  Mic,
  Paperclip,
  Plus,
  SlidersHorizontal,
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
import type { InteractiveDelivery } from "../../app/interactiveTurnRouter";
import { useComposerBehavior } from "../../app/composerBehavior";
import { useTranslation } from "react-i18next";
import {
  ACCESS_PRESET_OPTIONS,
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
  matchingCommands,
  parseComposerCommand,
  type ComposerCommand,
} from "./commands";
import styles from "./Composer.module.css";
import { useDictation } from "./useDictation";
import { usePromptDraft } from "./usePromptDraft";
import { ModelPicker } from "./ModelPicker";

interface ComposerProps {
  editable: boolean;
  canExecute: boolean;
  busy: boolean;
  /** True once this thread has any Turn — the agent preset is then fixed. */
  conversationStarted: boolean;
  executingTurn: Turn | null;
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
  ): Promise<InteractiveDelivery | null>;
  onQueue(prompt: string, skillIds?: string[]): Promise<boolean>;
  onInterrupt(): void;
  launchIntent: ComposerLaunchIntent | null;
  onLaunchIntentConsumed(): void;
  onNewThread?: () => void;
  onManageProviders?: () => void;
}

export interface ComposerLaunchIntent {
  threadId: string;
  prompt: string;
  skillIds: string[];
}

export function Composer({
  editable,
  canExecute,
  busy,
  conversationStarted,
  executingTurn,
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
  onNewThread,
  onManageProviders,
}: ComposerProps) {
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
    textarea.style.height = `${Math.min(textarea.scrollHeight, 190)}px`;
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
    record(value);
    const executionPrompt = withContextFiles(
      value,
      attachments,
      thread?.workspacePath,
    );
    const selectable = new Set(skillCatalog.activeSkills.map((skill) => skill.id));
    const selectedIds = selectedSkillIds.filter((skillId) =>
      selectable.has(skillId),
    );
    const delivery = await onSend(executionPrompt, selectedIds);
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
    const executionPrompt = withContextFiles(
      value,
      attachments,
      thread?.workspacePath,
    );
    const selectable = new Set(skillCatalog.activeSkills.map((skill) => skill.id));
    const selectedIds = selectedSkillIds.filter((skillId) =>
      selectable.has(skillId),
    );
    if (!(await onQueue(executionPrompt, selectedIds))) return;
    record(value);
    setDeliveryNotice("Queued for the next Turn.");
    setPrompt("");
    clearAttachments();
    setSelectedSkillIds([]);
    setSkillPickerOpen(false);
  };
  const commandSuggestions = matchingCommands(prompt);
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

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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

  const accessValue = accessPresetOverride ?? "";
  const accessLabel = accessPresetOverride
    ? ACCESS_PRESET_OPTIONS.find((option) => option.value === accessPresetOverride)
        ?.label ?? accessPresetOverride
    : `Default · ${defaultAccessLabel}`;
  const notice =
    commandError ??
    contextError ??
    dictation.error ??
    deliveryNotice ??
    dictationStatus ??
    disabledReason;

  return (
    <footer className={styles.region}>
      <div className={styles.chips}>
        <PresetPicker
          entries={presetCatalog.entries}
          current={presetCatalog.current}
          locked={conversationStarted}
          busy={busy || presetCatalog.busy}
          error={presetCatalog.error}
          onSelect={(presetId) => void presetCatalog.select(presetId)}
        />
        <span
          className={styles.chip}
          title={thread?.workspacePath ?? project?.canonicalPath ?? undefined}
        >
          <Folder size={13} />
          {project?.displayName ?? "Pick a folder…"}
        </span>
        {onNewThread ? (
          <button
            type="button"
            className={styles.chipButton}
            onClick={onNewThread}
            disabled={busy}
            aria-label="New thread"
            title="New thread"
          >
            <Plus size={14} />
          </button>
        ) : null}
      </div>
      <div className={styles.composer}>
        <label className={styles.promptLabel} htmlFor="turn-prompt">
          Task instruction
        </label>
        {commandSuggestions.length ? (
          <div className={styles.commandMenu} role="listbox" aria-label="Commands">
            {commandSuggestions.map((command) => (
              <button
                type="button"
                role="option"
                aria-selected={false}
                key={command.name}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setPrompt(command.usage);
                  textareaRef.current?.focus();
                }}
              >
                <code>/{command.name}</code>
                <span>{command.description}</span>
              </button>
            ))}
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
              <span key={path} title={path}>
                <Paperclip size={12} />
                {fileName(path)}
                <button
                  type="button"
                  onClick={() => removeAttachment(path)}
                  aria-label={`Remove ${fileName(path)}`}
                >
                  <X size={12} />
                </button>
              </span>
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
              <CornerDownLeft size={16} />
            </button>
          )}
        </div>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.context}>
          <label
            className={styles.accessMode}
            data-access={effectiveProductAccess ?? "inherit"}
            title="Tool access for new submissions"
          >
            <span>{accessLabel}</span>
            <select
              aria-label="New submissions access"
              value={accessValue}
              onChange={(event) => {
                const value = event.target.value;
                void onAccessPresetChange(
                  value ? (value as ExecutionAccessPreset) : null,
                );
              }}
              disabled={busy || !thread}
            >
              <option value="">Default · {defaultAccessLabel}</option>
              {ACCESS_PRESET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className={styles.iconButton}
            type="button"
            onClick={() => setSkillPickerOpen((open) => !open)}
            disabled={
              !editable || busy || active || !skillCatalog.activeSkills.length
            }
            aria-expanded={skillPickerOpen}
            aria-label="Select Skills for this turn"
            title={
              skillCatalog.activeSkills.length
                ? "Select Skills for this turn"
                : "No selectable Skills"
            }
          >
            <SlidersHorizontal size={15} />
            {selectedSkills.length ? <b>{selectedSkills.length}</b> : null}
          </button>
          <button
            className={styles.iconButton}
            type="button"
            onClick={() => void pickContextFiles()}
            disabled={!editable || busy}
            aria-label="Attach workspace files"
            title="Attach workspace files"
          >
            <Paperclip size={15} />
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
        </div>
        <ModelPicker
          runtime={runtime}
          project={project}
          thread={thread}
          settings={settings}
          disabled={busy}
          onChange={onModelChange}
          onManageProviders={onManageProviders}
        />
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

function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

function isInsideWorkspace(path: string, workspace: string): boolean {
  const candidate = normalizedPath(path);
  const root = normalizedPath(workspace);
  return candidate === root || candidate.startsWith(`${root}/`);
}

function fileName(path: string): string {
  return normalizedPath(path).split("/").at(-1) ?? path;
}

function withContextFiles(
  prompt: string,
  paths: string[],
  workspace: string | undefined,
): string {
  if (!paths.length) return prompt;
  const root = workspace ? normalizedPath(workspace) : "";
  const references = paths.map((path) => {
    const normalized = normalizedPath(path);
    return normalized.startsWith(`${root}/`)
      ? normalized.slice(root.length + 1)
      : normalized;
  });
  return [
    prompt,
    "",
    "Attached workspace context:",
    ...references.map((path) => `- ${path}`),
  ].join("\n");
}
