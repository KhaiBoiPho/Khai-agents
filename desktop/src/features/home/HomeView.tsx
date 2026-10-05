import {
  ArrowUp,
  Folder,
  FolderPlus,
  FolderSearch,
  Globe,
  Laptop,
  ListTodo,
  PenLine,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { Project } from "../../generated/app-server";
import { isRecoveredHistoryProject } from "../../app/projectPresentation";
import { isChatsProject } from "../../app/chats";
import mascotUrl from "../../assets/khai-mascot.png";
import { MOCK_ACCOUNT } from "../../mocks/preview";
import { Dropdown } from "../../components/Dropdown";
import styles from "./HomeView.module.css";

interface HomeViewProps {
  projects: Project[];
  selectedProjectId: string | null;
  busy: boolean;
  onOpenProject(projectId: string): void;
  onAddFolder(): void;
  /** A null project starts a plain chat. */
  onStart(projectId: string | null, prompt: string): void;
}

/**
 * Landing view when no thread is open: a greeting, recent projects, and a
 * composer that starts a new thread in the chosen folder.
 */
export function HomeView({
  projects,
  selectedProjectId,
  busy,
  onOpenProject,
  onAddFolder,
  onStart,
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
  const target = projects.find((project) => project.id === projectId) ?? null;
  const canStart =
    (!target || target.trustState === "trusted") && !busy && Boolean(prompt.trim());

  const start = () => {
    if (!canStart) return;
    onStart(target?.id ?? null, prompt.trim());
    setPrompt("");
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
          <textarea
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
          <button
            type="button"
            onClick={start}
            disabled={!canStart}
            aria-label="Start chat"
            title="Start chat"
          >
            <ArrowUp size={16} strokeWidth={2.4} />
          </button>
        </div>
        {target && target.trustState !== "trusted" ? (
          <p className={styles.hint}>
            Trust {target.displayName} before starting a chat in it.
          </p>
        ) : null}
      </div>
      <div className={styles.suggestions}>
        {SUGGESTIONS.map((suggestion) => {
          const Icon = suggestion.icon;
          return (
            <button
              type="button"
              key={suggestion.label}
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
