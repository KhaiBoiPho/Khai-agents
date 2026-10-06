import {
  ArrowUp,
  Atom,
  FileText,
  Folder,
  FolderPlus,
  FolderSearch,
  Globe,
  Laptop,
  ListTodo,
  Paperclip,
  PenLine,
  Plug,
  Plus,
  Telescope,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { Project, SettingsSnapshot } from "../../generated/app-server";
import type { ClientRuntime, PendingFile } from "../../rpc/contracts";
import {
  DEEP_EFFORTS,
  executionTarget,
  withDeepResearch,
  withSearch,
} from "../execution/promptModes";
import composerStyles from "../execution/Composer.module.css";
import { ModelPicker, type ModelSelection } from "../execution/ModelPicker";
import { isRecoveredHistoryProject } from "../../app/projectPresentation";
import { isChatsProject } from "../../app/chats";
import mascotUrl from "../../assets/khai-mascot.png";
import { MOCK_ACCOUNT } from "../../mocks/preview";
import { Dropdown } from "../../components/Dropdown";
import styles from "./HomeView.module.css";

interface HomeViewProps {
  runtime: ClientRuntime;
  settings: SettingsSnapshot | null;
  projects: Project[];
  selectedProjectId: string | null;
  busy: boolean;
  onOpenProject(projectId: string): void;
  onAddFolder(): void;
  /**
   * A null project starts a plain chat; a null model uses the default. Files
   * are uploaded into the new thread's workspace and listed in the prompt.
   */
  onStart(
    projectId: string | null,
    prompt: string,
    model: ModelSelection | null,
    files: PendingFile[],
  ): void;
  onManageProviders?: () => void;
  onOpenSettings?: (section: string) => void;
}

/**
 * Landing view when no thread is open: a greeting, recent projects, and a
 * composer that starts a new thread in the chosen folder.
 */
export function HomeView({
  runtime,
  settings,
  projects,
  selectedProjectId,
  busy,
  onOpenProject,
  onAddFolder,
  onStart,
  onManageProviders,
  onOpenSettings,
}: HomeViewProps) {
  const recent = useMemo(
    () =>
      [...projects]
        .filter(
          (project) => !isRecoveredHistoryProject(project) && !isChatsProject(project),
        )
        .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt)),
    [projects],
  );
  // "" means no folder: a plain chat.
  const [projectId, setProjectId] = useState("");
  void selectedProjectId;
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Grow with the prompt up to nearly half the window before scrolling.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    const cap = Math.max(190, Math.round(window.innerHeight * 0.45));
    textarea.style.height = `${Math.min(textarea.scrollHeight, cap)}px`;
  }, [prompt]);
  const [model, setModel] = useState<ModelSelection | null>(null);
  const target = projects.find((project) => project.id === projectId) ?? null;
  // No trust gate: starting a chat trusts the folder (createThreadIn).
  const canStart = !busy && Boolean(prompt.trim());
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [searchOn, setSearchOn] = useState(false);
  const [researchOn, setResearchOn] = useState(false);
  const defaults = executionTarget(null, settings);
  const deepThinkOn = DEEP_EFFORTS.has(
    (model?.reasoningEffort ?? defaults.effort ?? "").toLocaleLowerCase(),
  );
  const toggleDeepThink = () => {
    const connectionId = model?.connectionId ?? defaults.connection;
    const modelId = model?.model ?? defaults.model;
    if (!connectionId || !modelId) return;
    setModel({
      connectionId,
      model: modelId,
      reasoningEffort: deepThinkOn ? "auto" : "high",
      contextWindow: model?.contextWindow ?? null,
    });
  };

  const addFiles = async () => {
    setFileError(null);
    try {
      const chosen = (await runtime.chooseFiles?.()) ?? [];
      setFiles((current) => {
        const seen = new Set(current.map((file) => file.name));
        return [...current, ...chosen.filter((file) => !seen.has(file.name))].slice(0, 8);
      });
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    }
  };

  const start = () => {
    if (!canStart) return;
    const text = withDeepResearch(
      withSearch(prompt.trim(), searchOn && !researchOn),
      researchOn,
    );
    onStart(target?.id ?? null, text, model, files);
    setPrompt("");
    setFiles([]);
  };

  return (
    <div className={styles.home}>
      <h2 className={styles.greeting}>
        <img src={mascotUrl} alt="" className={styles.greetingMascot} />
        What's on your mind today, {MOCK_ACCOUNT.name}?
      </h2>

      <div className={styles.composerArea}>
        <div className={styles.chips}>
          <span className={styles.chip}>
            <Laptop size={13} />
            Local
          </span>
          <Dropdown
            triggerClassName={styles.chip}
            triggerLabel="Folder for the new chat"
            placement="up"
            trigger={
              <>
                <Folder size={13} />
                {target?.displayName ?? "No folder"}
              </>
            }
            sections={[
              {
                items: [
                  {
                    id: "none",
                    label: "No folder",
                    description: "A plain chat",
                    selected: projectId === "",
                    onSelect: () => setProjectId(""),
                  },
                ],
              },
              {
                title: "Recent",
                items: recent.slice(0, 8).map((project) => ({
                  id: project.id,
                  label: project.displayName,
                  selected: project.id === projectId,
                  onSelect: () => setProjectId(project.id),
                })),
              },
              {
                items: [
                  { id: "open", label: "Open folder…", onSelect: onAddFolder },
                ],
              },
            ]}
          />
          <button
            type="button"
            className={styles.chipButton}
            onClick={onAddFolder}
            disabled={busy}
            aria-label="Open another folder"
            title="Open another folder"
          >
            <FolderPlus size={14} />
          </button>
        </div>
        <div className={styles.box}>
          {files.length ? (
            <div className={styles.files} aria-label="Files to attach">
              {files.map((file) => (
                <span key={file.name} className={styles.file}>
                  <FileText size={13} />
                  <span>{file.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setFiles((current) => current.filter((entry) => entry !== file))
                    }
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                start();
              }
            }}
            placeholder="Describe a task or ask a question"
            rows={1}
            aria-label="New chat prompt"
          />
          <div className={styles.toolbar}>
            <div className={styles.modes}>
              <HomePlusMenu
                disabled={busy}
                canAddFiles={Boolean(runtime.chooseFiles)}
                onAddFiles={() => void addFiles()}
                onAddFolder={onAddFolder}
                onConnectors={onOpenSettings ? () => onOpenSettings("mcp") : undefined}
              />
              <button
                type="button"
                className={composerStyles.toggle}
                aria-pressed={deepThinkOn}
                onClick={toggleDeepThink}
                disabled={busy || !(model?.model ?? defaults.model)}
                title="Think longer before answering (high reasoning effort)"
              >
                <Atom size={14} />
                DeepThink
              </button>
              <button
                type="button"
                className={composerStyles.toggle}
                aria-pressed={searchOn}
                onClick={() => setSearchOn((on) => !on)}
                title="Search the web for this message"
              >
                <Globe size={14} />
                Search
              </button>
              <button
                type="button"
                className={composerStyles.toggle}
                aria-pressed={researchOn}
                onClick={() => setResearchOn((on) => !on)}
                title="Research the web in depth and write a cited report"
              >
                <Telescope size={14} />
                Deep research
              </button>
            </div>
            <div className={styles.boxTools}>
              <ModelPicker
                runtime={runtime}
                project={target}
                thread={model}
                settings={settings}
                disabled={busy}
                onChange={(connectionId, modelId, reasoningEffort, contextWindow) =>
                  setModel(
                    connectionId || modelId
                      ? { connectionId, model: modelId, reasoningEffort, contextWindow }
                      : null,
                  )
                }
                onManageProviders={onManageProviders}
              />
              <button
                type="button"
                className={styles.send}
                onClick={start}
                disabled={!canStart}
                aria-label="Start chat"
                title="Start chat"
              >
                <ArrowUp size={16} strokeWidth={2.4} />
              </button>
            </div>
          </div>
        </div>
        {fileError ? <p className={styles.hint}>{fileError}</p> : null}
      </div>
      <div className={styles.suggestions}>
        {SUGGESTIONS.map((suggestion, index) => {
          const Icon = suggestion.icon;
          return (
            <button
              type="button"
              key={suggestion.label}
              style={{ "--stagger": index } as CSSProperties}
              onClick={() => setPrompt(suggestion.prompt)}
            >
              <Icon size={16} />
              {suggestion.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface HomePlusMenuProps {
  disabled: boolean;
  canAddFiles: boolean;
  onAddFiles(): void;
  onAddFolder(): void;
  onConnectors?: () => void;
}

/** The Home "+" menu: add files or a folder before the chat exists. */
function HomePlusMenu({
  disabled,
  canAddFiles,
  onAddFiles,
  onAddFolder,
  onConnectors,
}: HomePlusMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const run = (action?: () => void) => () => {
    setOpen(false);
    action?.();
  };
  return (
    <div className={composerStyles.popoverRoot} ref={rootRef}>
      <button
        className={composerStyles.iconButton}
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add to prompt"
        title="Add to prompt"
      >
        <Plus size={16} />
      </button>
      {open ? (
        <div className={composerStyles.popover} role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={run(onAddFiles)}
            disabled={!canAddFiles}
          >
            <Paperclip size={15} />
            Add files
          </button>
          <button type="button" role="menuitem" onClick={run(onAddFolder)}>
            <Folder size={15} />
            Open folder
          </button>
          {onConnectors ? (
            <button type="button" role="menuitem" onClick={run(onConnectors)}>
              <Plug size={15} />
              Connectors
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const SUGGESTIONS = [
  { label: "Explain a codebase", icon: FolderSearch, prompt: "Explain the structure of this project: " },
  { label: "Write or edit", icon: PenLine, prompt: "Help me write " },
  { label: "Search the web", icon: Globe, prompt: "Search the web for " },
  { label: "Plan a task", icon: ListTodo, prompt: "Make a step-by-step plan to " },
];

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}
