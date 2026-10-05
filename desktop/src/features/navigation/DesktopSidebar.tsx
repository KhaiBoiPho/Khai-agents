import {
  BriefcaseBusiness,
  ChevronRight,
  ChevronsUpDown,
  CircleGauge,
  CircleHelp,
  FolderClosed,
  FolderOpen,
  Languages,
  LogOut,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  FileText,
  NotebookPen,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  isRecoveredHistoryProject,
  projectCanExecute,
} from "../../app/projectPresentation";
import type { Project, Thread } from "../../generated/app-server";
import type { DesktopDestination } from "../../app/useDesktopUi";
import type { SidecarStatus } from "../../rpc/contracts";
import { SessionRow } from "./SessionRow";
import { groupByDay, isChatsProject } from "../../app/chats";
import { useThreadMarks } from "../../app/threadMarks";
import { useProjectDisclosure } from "./useProjectDisclosure";
import { useTranslation } from "react-i18next";

import styles from "./DesktopSidebar.module.css";

interface DesktopSidebarProps {
  projects: Project[];
  threads: Thread[];
  selectedProjectId: string | null;
  selectedThreadId: string | null;
  query: string;
  busy: boolean;
  runtime: SidecarStatus;
  destination: DesktopDestination;
  settingsOpen: boolean;
  onDestination(destination: DesktopDestination): void;
  onOpenSettings(section?: string): void;
  /** Present only where the shell can end the browser session. */
  onSignOut?: () => void;
  onHide(): void;
  homeOpen: boolean;
  onShowHome(): void;
  activePage?: "documents" | "notes" | null;
  onOpenPage(page: "documents" | "notes"): void;
  onCreateThreadIn(projectId: string): void;
  onQueryChange(query: string): void;
  onOpenProject(): void;
  onSelectProject(projectId: string): void;
  onCreateThread(): void;
  onSelectThread(threadId: string): void;
  onRenameThread(threadId: string, title: string): Promise<void>;
  onArchiveThread(threadId: string): Promise<void>;
  onDeleteThread(threadId: string): Promise<void>;
}

interface SidebarProjectGroup {
  key: string;
  project: Project | null;
  displayName: string;
  description: string;
  threads: Thread[];
  active: boolean;
}

function matches(
  project: Project,
  thread: Thread,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  return [project.displayName, project.canonicalPath, thread.title, thread.workspacePath]
    .join("\n")
    .toLocaleLowerCase()
    .includes(normalizedQuery);
}

function projectDescription(project: Project): string {
  const segments = project.canonicalPath.split("/").filter(Boolean);
  if (segments.length < 2) return project.canonicalPath;
  return `…/${segments.slice(-2).join("/")}`;
}

export function DesktopSidebar({
  projects,
  threads,
  selectedProjectId,
  selectedThreadId,
  query,
  busy,
  runtime,
  destination,
  settingsOpen,
  onDestination,
  onOpenSettings,
  onSignOut,
  onHide,
  homeOpen,
  onShowHome,
  activePage = null,
  onOpenPage,
  onCreateThreadIn,
  onQueryChange,
  onOpenProject,
  onSelectProject,
  onCreateThread,
  onSelectThread,
  onRenameThread,
  onArchiveThread,
  onDeleteThread,
}: DesktopSidebarProps) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null;
  const canCreateThread = projectCanExecute(selectedProject);
  const projectGroups = useMemo<SidebarProjectGroup[]>(() => {
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const recoveredProjectIds = new Set(
      projects
        .filter(isRecoveredHistoryProject)
        .map((project) => project.id),
    );
    const regularGroups: SidebarProjectGroup[] = projects
      .filter(
        (project) => !recoveredProjectIds.has(project.id) && !isChatsProject(project),
      )
      .map((project) => {
        const projectThreads = threads
          .filter((thread) => thread.projectId === project.id)
          .filter((thread) => matches(project, thread, normalizedQuery))
          .sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt),
          );
        return {
          key: project.id,
          project,
          displayName: project.displayName,
          description: projectDescription(project),
          threads: projectThreads,
          active: project.id === selectedProjectId,
        };
      })
      .filter((group) => !normalizedQuery || group.threads.length > 0);

    const recoveredThreads = threads
      .filter((thread) => recoveredProjectIds.has(thread.projectId))
      .filter((thread) => {
        const project = projectById.get(thread.projectId);
        return project ? matches(project, thread, normalizedQuery) : false;
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (recoveredThreads.length > 0) {
      regularGroups.push({
        key: "recovered-history",
        project: null,
        displayName: t("sidebar.previousSessions", "Previous sessions"),
        description: t("sidebar.folderUnavailable", "Original folders unavailable"),
        threads: recoveredThreads,
        active: recoveredThreads.some(
          (thread) => thread.projectId === selectedProjectId,
        ),
      });
    }
    return regularGroups;
  }, [normalizedQuery, projects, selectedProjectId, t, threads]);
  const marks = useThreadMarks();
  const chatsProjectIds = new Set(
    projects.filter((project) => isChatsProject(project)).map((project) => project.id),
  );
  const visibleThreads = threads.filter((thread) =>
    !normalizedQuery ||
    thread.title.toLocaleLowerCase().includes(normalizedQuery),
  );
  const pinnedThreads = marks.pinned
    .map((id) => visibleThreads.find((thread) => thread.id === id))
    .filter((thread): thread is Thread => Boolean(thread));
  const favoriteThreads = marks.favorites
    .map((id) => visibleThreads.find((thread) => thread.id === id))
    .filter(
      (thread): thread is Thread =>
        Boolean(thread) && !marks.pinned.includes(thread!.id),
    );
  const chatDays = groupByDay(
    visibleThreads.filter(
      (thread) =>
        chatsProjectIds.has(thread.projectId) && !marks.pinned.includes(thread.id),
    ),
  );
  const row = (thread: Thread) => (
    <SessionRow
      key={thread.id}
      thread={thread}
      active={thread.id === selectedThreadId}
      busy={busy}
      onSelect={onSelectThread}
      onRename={onRenameThread}
      onArchive={onArchiveThread}
      onDelete={async (threadId) => {
        await onDeleteThread(threadId);
        marks.forget(threadId);
      }}
      pinned={marks.pinned.includes(thread.id)}
      favorite={marks.favorites.includes(thread.id)}
      onTogglePin={marks.togglePin}
      onToggleFavorite={marks.toggleFavorite}
    />
  );
  const activeGroupKey =
    projectGroups.find((group) => group.active)?.key ?? null;
  const disclosure = useProjectDisclosure(activeGroupKey);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        });
      }
      if (
        event.key.toLocaleLowerCase() === "n" &&
        canCreateThread &&
        !busy
      ) {
        event.preventDefault();
        onCreateThread();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [busy, canCreateThread, onCreateThread]);

  return (
    <aside className={styles.sidebar} aria-label="Projects and Sessions">
      <div className={styles.iconRow}>
        <strong className={styles.brandName}>Khai-Agents</strong>
        <button
          type="button"
          onClick={onHide}
          aria-label="Hide sidebar"
          title="Hide sidebar (Ctrl+B)"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <label className={styles.search}>
        <Search size={14} strokeWidth={1.8} aria-hidden="true" />
        <span className={styles.srOnly}>{t("sidebar.searchSessions", "Search Sessions")}</span>
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onQueryChange("");
              event.currentTarget.blur();
            }
          }}
          placeholder={t("sidebar.search", "Search")}
          spellCheck={false}
        />
      </label>

      <nav className={styles.primaryNav} aria-label="Main">
        <button
          type="button"
          className={styles.newButton}
          onClick={onCreateThread}
          disabled={busy || !canCreateThread}
          title="New chat (Ctrl+N)"
        >
          <Plus size={15} />
          {t("sidebar.new", "New")}
        </button>
        <button type="button" data-active={homeOpen} onClick={onShowHome}>
          <FolderClosed size={15} />
          {t("sidebar.projects", "Projects")}
        </button>
        <button
          type="button"
          data-active={activePage === "documents"}
          onClick={() => onOpenPage("documents")}
        >
          <FileText size={15} />
          {t("sidebar.documents", "Documents")}
        </button>
        <button
          type="button"
          data-active={activePage === "notes"}
          onClick={() => onOpenPage("notes")}
        >
          <NotebookPen size={15} />
          {t("sidebar.notes", "Notes")}
        </button>
        <button type="button" onClick={() => onOpenSettings("skills")}>
          <BriefcaseBusiness size={15} />
          {t("sidebar.customize", "Customize")}
        </button>
      </nav>

      <nav className={styles.projectList} aria-label="Session history">
        {pinnedThreads.length ? (
          <section className={styles.chatSection}>
            <p className={styles.chatHeading}>Pinned</p>
            {pinnedThreads.map(row)}
          </section>
        ) : null}
        {favoriteThreads.length ? (
          <section className={styles.chatSection}>
            <p className={styles.chatHeading}>Favorites</p>
            {favoriteThreads.map(row)}
          </section>
        ) : null}
        {projects.length === 0 ? (
          <button className={styles.emptyProject} type="button" onClick={onOpenProject}>
            <FolderOpen size={18} />
            <span>
              <strong>{t("sidebar.openFolder", "Open a local folder")}</strong>
              <small>{t("sidebar.openFolderHint", "Your CLI Sessions will appear here.")}</small>
            </span>
          </button>
        ) : normalizedQuery && projectGroups.length === 0 ? (
          <div className={styles.noResults}>
            <Search size={16} />
            <strong>{t("sidebar.noResults", "No matching Sessions")}</strong>
            <small>{t("sidebar.noResultsHint", "Search by title, project, or workspace path.")}</small>
          </div>
        ) : (
          projectGroups.map((group) => {
            const project = group.project;
            const expanded =
              Boolean(normalizedQuery) || disclosure.isExpanded(group.key);
            return (
              <section className={styles.projectGroup} key={group.key}>
                <div className={styles.groupHeader}>
                  <button
                    type="button"
                    className={styles.groupName}
                    data-active={group.active}
                    aria-expanded={expanded}
                    aria-controls={`project-sessions-${group.key}`}
                    onClick={() => {
                      if (project && project.id !== selectedProjectId) {
                        disclosure.expand(group.key);
                        onSelectProject(project.id);
                      } else {
                        disclosure.toggle(group.key);
                      }
                    }}
                    title={project?.canonicalPath ?? group.description}
                  >
                    <span>{group.displayName}</span>
                    {project?.trustState === "untrusted" ? (
                      <ShieldAlert
                        size={12}
                        className={styles.untrusted}
                        aria-label="Project not trusted"
                      />
                    ) : null}
                    <ChevronRight
                      size={13}
                      className={styles.groupChevron}
                      data-expanded={expanded}
                      aria-hidden="true"
                    />
                  </button>
                  {project ? (
                    <button
                      type="button"
                      className={styles.groupAdd}
                      onClick={() => onCreateThreadIn(project.id)}
                      disabled={busy || !projectCanExecute(project)}
                      aria-label={`New chat in ${group.displayName}`}
                      title={`New chat in ${group.displayName}`}
                    >
                      <Plus size={14} />
                    </button>
                  ) : null}
                </div>

                <ProjectSessions
                  id={`project-sessions-${group.key}`}
                  expanded={expanded}
                  threads={group.threads}
                  selectedThreadId={selectedThreadId}
                  searching={Boolean(normalizedQuery)}
                  busy={busy}
                  onSelectThread={(threadId) => {
                    disclosure.expand(group.key);
                    onSelectThread(threadId);
                  }}
                  onRenameThread={onRenameThread}
                  onArchiveThread={onArchiveThread}
                  onDeleteThread={onDeleteThread}
                />
              </section>
            );
          })
        )}
        <button className={styles.addFolder} type="button" onClick={onOpenProject} disabled={busy}>
          <Plus size={13} />
          {t("sidebar.addFolder", "Add folder")}
        </button>
        {chatDays.map((day) => (
          <section className={styles.chatSection} key={day.label}>
            <p className={styles.chatHeading}>{day.label}</p>
            {day.threads.map(row)}
          </section>
        ))}
      </nav>

      <AccountMenu
        settingsOpen={settingsOpen}
        onOpenSettings={onOpenSettings}
        onSignOut={onSignOut}
      />
    </aside>
  );
}

const ACCOUNT_NAME = "Khai";
const HELP_URL = "https://github.com/KhaiBoiPho/Khai-agents";

/** Bottom-of-sidebar account button and menu, after the Claude web app. */
function AccountMenu({
  settingsOpen,
  onOpenSettings,
  onSignOut,
}: {
  settingsOpen: boolean;
  onOpenSettings(section?: string): void;
  onSignOut?: () => void;
}) {
  const { t } = useTranslation();
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

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        onOpenSettings();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [onOpenSettings]);

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className={styles.account} ref={rootRef}>
      {open ? (
        <div className={styles.accountMenu} role="menu">
          <p className={styles.accountMenuTitle}>Khai-Agents · Local</p>
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(() => onOpenSettings())}
          >
            <Settings size={16} />
            {t("sidebar.settings", "Settings")}
            <kbd>Ctrl+,</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(() => onOpenSettings("usage"))}
          >
            <CircleGauge size={16} />
            {t("sidebar.usage", "Usage")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(() => onOpenSettings("general"))}
          >
            <Languages size={16} />
            {t("sidebar.language", "Language")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              choose(() => window.open(HELP_URL, "_blank", "noopener"))
            }
          >
            <CircleHelp size={16} />
            {t("sidebar.help", "Get help")}
          </button>
          {onSignOut ? (
            <>
              <hr />
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(onSignOut)}
              >
                <LogOut size={16} />
                {t("sidebar.signOut", "Log out")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        className={styles.accountButton}
        data-active={open || settingsOpen}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {ACCOUNT_NAME.charAt(0)}
        </span>
        <span className={styles.accountName}>
          <strong>{ACCOUNT_NAME}</strong>
          <small>Local</small>
        </span>
        <ChevronsUpDown size={14} />
      </button>
    </div>
  );
}

const SESSION_PREVIEW_LIMIT = 6;

interface ProjectSessionsProps {
  id: string;
  expanded: boolean;
  threads: Thread[];
  selectedThreadId: string | null;
  searching: boolean;
  busy: boolean;
  onSelectThread(threadId: string): void;
  onRenameThread(threadId: string, title: string): Promise<void>;
  onArchiveThread(threadId: string): Promise<void>;
  onDeleteThread(threadId: string): Promise<void>;
}

function ProjectSessions({
  id,
  expanded,
  threads,
  selectedThreadId,
  searching,
  busy,
  onSelectThread,
  onRenameThread,
  onArchiveThread,
  onDeleteThread,
}: ProjectSessionsProps) {
  const [showAll, setShowAll] = useState(false);
  const marks = useThreadMarks();
  const { t } = useTranslation();

  if (!expanded) return null;

  const visibleThreads =
    searching || showAll
      ? threads
      : threads.slice(0, SESSION_PREVIEW_LIMIT);
  if (
    !searching &&
    !showAll &&
    selectedThreadId &&
    !visibleThreads.some((thread) => thread.id === selectedThreadId)
  ) {
    const selected = threads.find((thread) => thread.id === selectedThreadId);
    if (selected) {
      visibleThreads.splice(Math.max(0, SESSION_PREVIEW_LIMIT - 1), 1, selected);
    }
  }
  const hiddenCount = threads.length - visibleThreads.length;

  return (
    <div className={styles.threadList} id={id}>
      {threads.length === 0 ? (
        <p className={styles.noSessions}>{t("sidebar.noSessions", "No Sessions")}</p>
      ) : (
        visibleThreads.map((thread) => (
          <SessionRow
            key={thread.id}
            thread={thread}
            active={thread.id === selectedThreadId}
            busy={busy}
            onSelect={onSelectThread}
            onRename={onRenameThread}
            onArchive={onArchiveThread}
            onDelete={async (threadId) => {
              await onDeleteThread(threadId);
              marks.forget(threadId);
            }}
            pinned={marks.pinned.includes(thread.id)}
            favorite={marks.favorites.includes(thread.id)}
            onTogglePin={marks.togglePin}
            onToggleFavorite={marks.toggleFavorite}
          />
        ))
      )}
      {!searching && threads.length > SESSION_PREVIEW_LIMIT ? (
        <button
          type="button"
          className={styles.showMore}
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? t("sidebar.showLess", "Show less") : t("sidebar.showMore", "Show {{count}} more", { count: hiddenCount })}
        </button>
      ) : null}
    </div>
  );
}
