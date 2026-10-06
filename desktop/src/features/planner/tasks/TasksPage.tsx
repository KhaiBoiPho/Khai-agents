/**
 * Plan — the Tasks page: a grouped list, a Kanban board and a completion
 * history over one task store, with a detail panel for everything a task
 * carries (subtasks, recurrence, tags, assignees, comments, history).
 *
 * Ported from Yuvomi's Tasks module (MIT, © 2026 ulsklyc).
 *
 * TODO(backend): tasks live in this browser's storage (PLANNER_KEYS.tasks).
 * Not ported because they need a server: push notifications and reminders,
 * per-task visibility and locking, family permissions, reward-ledger payouts
 * for points, CalDAV sync and linked documents.
 */

import {
  CheckCheck,
  Filter,
  KanbanSquare,
  List,
  ListChecks,
  MoreHorizontal,
  Plus,
  Search,
  Tags,
  X,
  History as HistoryIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { Dropdown } from "../../../components/Dropdown";
import { Board } from "./Board";
import { BulkBar } from "./BulkBar";
import { Chip, FilterPanel } from "./FilterBar";
import { HistoryView } from "./HistoryView";
import { TagManager } from "./TagManager";
import { TaskDetail } from "./TaskDetail";
import { TaskList } from "./TaskList";
import {
  activeFilterCount,
  allTags,
  filterTasks,
  formatDay,
  groupTasks,
  isArchived,
  isOverdue,
  tagKey,
  type BoardColumn,
  type RemovedTask,
} from "./taskModel";
import { useTaskStore } from "./taskStore";
import { DEFAULT_FILTERS, CURRENT_USER_ID, type Task, type TaskFilters, type TaskStatus, type ViewMode } from "./types";
import { toggleIn, useNow, useTaskUiPrefs } from "./uiPrefs";

import styles from "./TasksPage.module.css";

const VIEWS: ReadonlyArray<{ id: ViewMode; label: string; icon: typeof List }> = [
  { id: "list", label: "List", icon: List },
  { id: "board", label: "Board", icon: KanbanSquare },
  { id: "history", label: "History", icon: HistoryIcon },
];

/** How long a row stays to show its tick before a filter takes it away. */
const LEAVE_MS = 650;
const TOAST_MS = 5000;

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run(): void };
}

export function TasksPage() {
  const [state, actions] = useTaskStore();
  const [prefs, setPrefs] = useTaskUiPrefs();
  const now = useNow();

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<TaskFilters>(() => ({
    ...DEFAULT_FILTERS,
    mine: prefs.mine,
    showScheduled: prefs.showScheduled,
  }));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusTitle, setFocusTitle] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const [fresh, setFresh] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const addRef = useRef<HTMLInputElement | null>(null);

  const view = prefs.view;
  const tags = useMemo(() => allTags(state.tasks), [state.tasks]);

  const listTasks = useMemo(() => {
    const visible = filterTasks(state.tasks, filters, query, now);
    const ids = new Set(visible.map((task) => task.id));
    // Rows that just left the filter stay for their exit animation.
    return [...visible, ...state.tasks.filter((task) => leaving.has(task.id) && !ids.has(task.id))];
  }, [state.tasks, filters, query, now, leaving]);
  const groups = useMemo(() => groupTasks(listTasks, prefs.groupMode, now), [listTasks, prefs.groupMode, now]);
  const boardTasks = useMemo(
    () => filterTasks(state.tasks, filters, query, now, { ignoreStatus: true }),
    [state.tasks, filters, query, now],
  );
  const active = activeId ? (state.tasks.find((task) => task.id === activeId) ?? null) : null;
  const inPlay = state.tasks.filter((task) => !isArchived(task) && task.status !== "done");
  const overdue = inPlay.filter((task) => isOverdue(task, now)).length;
  const filterCount = activeFilterCount(filters);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!fresh) return;
    const timer = window.setTimeout(() => setFresh(null), 1500);
    return () => window.clearTimeout(timer);
  }, [fresh]);

  const showToast = (message: string, action?: Toast["action"]) => setToast({ id: Date.now(), message, action });

  const updateFilters = (next: TaskFilters) => {
    setFilters(next);
    if (next.mine !== prefs.mine || next.showScheduled !== prefs.showScheduled) {
      setPrefs({ mine: next.mine, showScheduled: next.showScheduled });
    }
  };

  const hold = (id: string) => {
    setLeaving((current) => new Set(current).add(id));
    window.setTimeout(() => {
      setLeaving((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }, LEAVE_MS);
  };

  const changeStatus = (task: Task, status: TaskStatus, doneById: string | null = null) => {
    const previous = task.status;
    const result = actions.setStatus(task.id, status, doneById);
    if (view === "list" && !filterTasks([{ ...task, status }], filters, query, now).length) hold(task.id);
    if (result.followUpCreated && result.nextDue) {
      showToast(`Done — next one due ${formatDay(result.nextDue, now)}`, {
        label: "Undo",
        run: () => actions.setStatus(task.id, previous),
      });
    } else if (status === "done" && doneById && doneById !== CURRENT_USER_ID) {
      showToast("Ticked off for someone else — it’s in the history.");
    }
  };

  const toggleArchive = (task: Task) => {
    const archived = isArchived(task);
    actions.setArchived(task.id, !archived);
    if (!archived && view === "list" && !filters.statuses.includes("archived")) hold(task.id);
    showToast(archived ? `Restored “${task.title}”` : `Archived “${task.title}”`, {
      label: "Undo",
      run: () => actions.setArchived(task.id, archived),
    });
  };

  const removeWithUndo = (ids: string[]) => {
    const removed = ids.map((id) => actions.remove(id)).filter((entry): entry is RemovedTask => entry !== null);
    if (!removed.length) return;
    if (activeId && ids.includes(activeId)) setActiveId(null);
    showToast(removed.length === 1 ? "Task deleted." : `${removed.length} tasks deleted.`, {
      label: "Undo",
      // Restore in reverse so each one lands back at its own position.
      run: () => [...removed].reverse().forEach((entry) => actions.restore(entry)),
    });
  };

  const moveOnBoard = (task: Task, column: BoardColumn) => {
    if (column === "archived") {
      actions.setArchived(task.id, true);
      return;
    }
    if (isArchived(task)) actions.setArchived(task.id, false);
    if (task.status !== column) changeStatus(task, column);
  };

  const toggleTag = (tag: string) => {
    const key = tagKey(tag);
    const has = filters.tags.some((entry) => tagKey(entry) === key);
    updateFilters({ ...filters, tags: has ? filters.tags.filter((entry) => tagKey(entry) !== key) : [...filters.tags, tag] });
  };

  const open = (id: string, focus = false) => {
    setActiveId(id);
    setFocusTitle(focus);
  };

  const quickAdd = () => {
    const title = draft.trim();
    if (!title) {
      const task = actions.add({ title: "New task", assigneeIds: filters.mine ? [CURRENT_USER_ID] : [] });
      open(task.id, true);
      return;
    }
    const task = actions.add({ title, assigneeIds: filters.mine ? [CURRENT_USER_ID] : [] });
    setDraft("");
    setFresh(task.id);
    const hidden =
      view === "history" ||
      (view === "list" ? !filterTasks([task], filters, query, now).length : !filterTasks([task], filters, query, now, { ignoreStatus: true }).length);
    if (hidden) showToast(`Added “${task.title}” — hidden by the current view.`, { label: "Open", run: () => open(task.id) });
  };

  const exitSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  const orderedIds = (): string[] =>
    view === "list"
      ? groups
          .filter((group) => !prefs.collapsedGroups.includes(`${prefs.groupMode}:${group.id}`))
          .flatMap((group) => group.tasks.map((task) => task.id))
      : [];

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    const typing =
      target?.closest("input, textarea, select, [contenteditable='true']") !== null && target !== null;
    if (typing || tagManagerOpen) return;
    if (event.key === "/") {
      event.preventDefault();
      searchRef.current?.focus();
    } else if (event.key === "n" || event.key === "N") {
      event.preventDefault();
      addRef.current?.focus();
    } else if (event.key === "Escape") {
      if (selecting) exitSelecting();
      else if (activeId) setActiveId(null);
      else if (filtersOpen) setFiltersOpen(false);
    } else if (["ArrowDown", "ArrowUp", "j", "k"].includes(event.key)) {
      const ids = orderedIds();
      if (!ids.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" || event.key === "j" ? 1 : -1;
      const index = activeId ? ids.indexOf(activeId) : -1;
      const next = ids[Math.max(0, Math.min(ids.length - 1, index === -1 ? 0 : index + step))]!;
      open(next);
      document.querySelector<HTMLElement>(`[data-row-id="${next}"] [data-row-focus]`)?.focus();
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const pickedTasks = state.tasks.filter((task) => picked.has(task.id));

  return (
    <div className={styles.layout} data-detail={active ? "open" : undefined}>
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <h1>Plan</h1>
            <p>
              {inPlay.length} open
              {overdue ? (
                <>
                  {" · "}
                  <span className={styles.overdueCount}>{overdue} overdue</span>
                </>
              ) : null}
            </p>
          </div>
          <div className={styles.tabs} role="tablist" aria-label="View">
            {VIEWS.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                role="tab"
                key={id}
                aria-selected={view === id}
                onClick={() => {
                  setPrefs({ view: id });
                  if (id !== "list") exitSelecting();
                }}
              >
                <Icon size={14} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
          {view === "history" ? null : (
            <label className={styles.search}>
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchRef}
                value={query}
                placeholder="Search tasks…"
                aria-label="Search tasks"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setQuery("");
                    event.currentTarget.blur();
                  }
                }}
              />
              {query ? (
                <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                  <X size={13} />
                </button>
              ) : (
                <kbd>/</kbd>
              )}
            </label>
          )}
        </header>

        {view === "history" ? null : (
          <>
            <div className={styles.toolbar}>
              <form
                className={styles.quickAdd}
                onSubmit={(event) => {
                  event.preventDefault();
                  quickAdd();
                }}
              >
                <Plus size={15} aria-hidden="true" />
                <input
                  ref={addRef}
                  value={draft}
                  placeholder="Add a task and press Enter"
                  aria-label="New task"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setDraft("");
                      event.currentTarget.blur();
                    }
                  }}
                />
                <button type="submit" className={styles.primary}>
                  Add
                </button>
              </form>
              <button
                type="button"
                className={styles.toolButton}
                aria-expanded={filtersOpen}
                data-active={filterCount > 0 || undefined}
                onClick={() => setFiltersOpen(!filtersOpen)}
              >
                <Filter size={14} aria-hidden="true" /> Filters
                {filterCount ? <span className={styles.badge}>{filterCount}</span> : null}
              </button>
              {view === "list" ? (
                <>
                  <Dropdown
                    triggerClassName={styles.toolButton}
                    trigger={<>Group: {prefs.groupMode === "due" ? "Due date" : "Category"}</>}
                    triggerLabel="Group by"
                    sections={[
                      {
                        title: "Group by",
                        items: [
                          { id: "due", label: "Due date", selected: prefs.groupMode === "due", onSelect: () => setPrefs({ groupMode: "due" }) },
                          { id: "category", label: "Category", selected: prefs.groupMode === "category", onSelect: () => setPrefs({ groupMode: "category" }) },
                        ],
                      },
                    ]}
                  />
                  <button
                    type="button"
                    className={styles.toolButton}
                    aria-pressed={selecting}
                    onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
                  >
                    <ListChecks size={14} aria-hidden="true" /> Select
                  </button>
                </>
              ) : null}
              <Dropdown
                triggerClassName={styles.toolIcon}
                trigger={<MoreHorizontal size={16} />}
                triggerLabel="More"
                align="end"
                sections={[
                  {
                    items: [
                      { id: "tags", label: "Manage tags", icon: <Tags size={14} />, onSelect: () => setTagManagerOpen(true) },
                      {
                        id: "archive-done",
                        label: "Archive all done tasks",
                        icon: <CheckCheck size={14} />,
                        disabled: !state.tasks.some((task) => task.status === "done" && !isArchived(task)),
                        onSelect: () => {
                          const ids = state.tasks.filter((task) => task.status === "done" && !isArchived(task)).map((task) => task.id);
                          ids.forEach((id) => actions.setArchived(id, true));
                          showToast(`Archived ${ids.length} done ${ids.length === 1 ? "task" : "tasks"}.`, {
                            label: "Undo",
                            run: () => ids.forEach((id) => actions.setArchived(id, false)),
                          });
                        },
                      },
                    ],
                  },
                ]}
              />
            </div>

            <div className={styles.quickFilters}>
              <Chip active={filters.mine} onClick={() => updateFilters({ ...filters, mine: !filters.mine })}>
                Assigned to me
              </Chip>
              <Chip active={filters.dueToday} onClick={() => updateFilters({ ...filters, dueToday: !filters.dueToday })}>
                Due by today
              </Chip>
              <Chip
                active={filters.showScheduled}
                onClick={() => updateFilters({ ...filters, showScheduled: !filters.showScheduled })}
              >
                Show scheduled
              </Chip>
              {filters.tags.map((tag) => (
                <Chip key={tag} active onClick={() => toggleTag(tag)}>
                  #{tag} <X size={11} aria-label={`Remove tag filter ${tag}`} />
                </Chip>
              ))}
            </div>

            {filtersOpen ? (
              <FilterPanel filters={filters} tags={tags} showStatus={view === "list"} onChange={updateFilters} />
            ) : null}
          </>
        )}

        <main className={styles.content}>
          {view === "list" ? (
            <TaskList
              groups={groups}
              groupMode={prefs.groupMode}
              collapsedGroups={prefs.collapsedGroups}
              onToggleGroup={(key) => setPrefs({ collapsedGroups: toggleIn(prefs.collapsedGroups, key) })}
              now={now}
              activeId={activeId}
              selecting={selecting}
              picked={picked}
              leaving={leaving}
              fresh={fresh}
              activeTags={filters.tags}
              empty={{
                query,
                filtered: filterCount > 0,
                onClearSearch: () => setQuery(""),
                onResetFilters: () => updateFilters({ ...DEFAULT_FILTERS }),
                onCreate: () => addRef.current?.focus(),
              }}
              onOpen={(id) => open(id)}
              onToggleDone={(task) => changeStatus(task, task.status === "done" ? "open" : "done")}
              onToggleSubtask={actions.toggleSubtask}
              onAddSubtask={actions.addSubtask}
              onArchive={toggleArchive}
              onTagClick={toggleTag}
              onPick={(id) => setPicked((current) => new Set(toggleIn([...current], id)))}
            />
          ) : view === "board" ? (
            query.trim() && boardTasks.length === 0 ? (
              <div className={styles.boardEmpty}>
                <strong>No results</strong>
                <p>No task contains “{query.trim()}”.</p>
                <button type="button" onClick={() => setQuery("")}>
                  Clear search
                </button>
              </div>
            ) : (
              <Board
                tasks={boardTasks}
                now={now}
                activeId={activeId}
                collapsedColumns={prefs.collapsedColumns}
                activeTags={filters.tags}
                onToggleColumn={(column) => setPrefs({ collapsedColumns: toggleIn(prefs.collapsedColumns, column) })}
                onMove={moveOnBoard}
                onOpen={(id) => open(id)}
                onTagClick={toggleTag}
                onArchiveAll={(ids) => {
                  ids.forEach((id) => actions.setArchived(id, true));
                  showToast(`Archived ${ids.length} done ${ids.length === 1 ? "task" : "tasks"}.`, {
                    label: "Undo",
                    run: () => ids.forEach((id) => actions.setArchived(id, false)),
                  });
                }}
              />
            )
          ) : (
            <HistoryView state={state} now={now} activeId={activeId} onOpen={(id) => open(id)} />
          )}
        </main>

        {selecting ? (
          <BulkBar
            tasks={pickedTasks}
            onSelectAll={() => setPicked(new Set(listTasks.map((task) => task.id)))}
            onStatus={(status) => pickedTasks.forEach((task) => changeStatus(task, status))}
            onArchive={() => {
              const ids = pickedTasks.filter((task) => !isArchived(task)).map((task) => task.id);
              ids.forEach((id) => actions.setArchived(id, true));
              showToast(`Archived ${ids.length} ${ids.length === 1 ? "task" : "tasks"}.`, {
                label: "Undo",
                run: () => ids.forEach((id) => actions.setArchived(id, false)),
              });
              exitSelecting();
            }}
            onAddTag={(tag) => pickedTasks.forEach((task) => actions.update(task.id, { tags: [...task.tags, tag] }))}
            onDelete={() => {
              removeWithUndo(pickedTasks.map((task) => task.id));
              exitSelecting();
            }}
            onDone={exitSelecting}
          />
        ) : null}

        {toast ? (
          <div className={styles.toast} role="status" key={toast.id}>
            <span>{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  toast.action!.run();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
            <button type="button" className={styles.toastClose} aria-label="Dismiss" onClick={() => setToast(null)}>
              <X size={13} />
            </button>
          </div>
        ) : (
          <div className={styles.srOnly} role="status" />
        )}
      </div>

      {active ? (
        <TaskDetail
          key={active.id}
          task={active}
          state={state}
          now={now}
          actions={actions}
          autoFocusTitle={focusTitle}
          onStatus={changeStatus}
          onArchive={toggleArchive}
          onDelete={(task) => removeWithUndo([task.id])}
          onClose={() => setActiveId(null)}
        />
      ) : null}

      <TagManager
        open={tagManagerOpen}
        tags={tags}
        onRename={(from, to) => {
          actions.renameTag(from, to);
          if (filters.tags.some((tag) => tagKey(tag) === tagKey(from))) {
            updateFilters({ ...filters, tags: filters.tags.map((tag) => (tagKey(tag) === tagKey(from) ? to.trim() : tag)) });
          }
        }}
        onDelete={(tag) => {
          actions.deleteTag(tag);
          updateFilters({ ...filters, tags: filters.tags.filter((entry) => tagKey(entry) !== tagKey(tag)) });
        }}
        onClose={() => setTagManagerOpen(false)}
      />
    </div>
  );
}
