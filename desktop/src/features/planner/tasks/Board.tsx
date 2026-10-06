import { Archive, ArchiveRestore, Check, ChevronDown, CirclePlay, RotateCcw } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import { AvatarStack, DueBadge, PriorityBadge, TagChips } from "./bits";
import { boardColumnOf, isArchived, nextBoardStatus, sortTasks, subtaskProgress, type BoardColumn } from "./taskModel";
import type { Task } from "./types";

import styles from "./Board.module.css";

const COLUMNS: ReadonlyArray<{ id: BoardColumn; label: string }> = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "done", label: "Done" },
  { id: "archived", label: "Archived" },
];

interface BoardProps {
  tasks: Task[];
  now: Date;
  activeId: string | null;
  collapsedColumns: string[];
  activeTags: string[];
  onToggleColumn(column: BoardColumn): void;
  onMove(task: Task, column: BoardColumn): void;
  onOpen(id: string): void;
  onTagClick(tag: string): void;
  onArchiveAll(ids: string[]): void;
}

export function Board({
  tasks,
  now,
  activeId,
  collapsedColumns,
  activeTags,
  onToggleColumn,
  onMove,
  onOpen,
  onTagClick,
  onArchiveAll,
}: BoardProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<BoardColumn | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  useEffect(() => {
    if (!confirmArchive) return;
    const timer = window.setTimeout(() => setConfirmArchive(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmArchive]);

  const byColumn = new Map<BoardColumn, Task[]>(COLUMNS.map((column) => [column.id, []]));
  for (const task of sortTasks(tasks, now)) byColumn.get(boardColumnOf(task))!.push(task);
  const dragged = dragId ? tasks.find((task) => task.id === dragId) : undefined;

  return (
    <div className={styles.board} onDragEnd={() => {
        setDragId(null);
        setOver(null);
      }}>
      {COLUMNS.map((column) => {
        const items = byColumn.get(column.id)!;
        const collapsed = collapsedColumns.includes(column.id);
        const bodyId = `board-col-${column.id}`;
        return (
          <section
            key={column.id}
            className={styles.column}
            data-column={column.id}
            data-over={(over === column.id && dragged && boardColumnOf(dragged) !== column.id) || undefined}
            // A folded column takes no drops: a card would vanish into a column nobody can see.
            onDragOver={(event) => {
              if (collapsed || !dragId) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (over !== column.id) setOver(column.id);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData("text/plain") || dragId;
              const task = tasks.find((entry) => entry.id === id);
              setDragId(null);
              setOver(null);
              if (task && boardColumnOf(task) !== column.id) onMove(task, column.id);
            }}
          >
            <header className={styles.columnHead}>
              <button
                type="button"
                className={styles.columnToggle}
                aria-expanded={!collapsed}
                aria-controls={bodyId}
                title={collapsed ? "Expand column" : "Collapse column"}
                onClick={() => onToggleColumn(column.id)}
              >
                <ChevronDown size={14} data-collapsed={collapsed || undefined} />
                <strong>{column.label}</strong>
                <span>{items.length}</span>
              </button>
              {column.id === "done" && items.length > 0 && !collapsed ? (
                <button
                  type="button"
                  className={styles.archiveAll}
                  data-confirm={confirmArchive || undefined}
                  title="Archive every done task in this column"
                  onClick={() => {
                    if (!confirmArchive) return setConfirmArchive(true);
                    setConfirmArchive(false);
                    onArchiveAll(items.map((task) => task.id));
                  }}
                >
                  <Archive size={13} aria-hidden="true" />
                  {confirmArchive ? `Archive ${items.length}?` : null}
                  <span className={styles.srOnly}>{confirmArchive ? "" : "Archive all done"}</span>
                </button>
              ) : null}
            </header>
            <div className={styles.columnBody} id={bodyId} hidden={collapsed}>
              {items.map((task, index) => (
                <BoardCard
                  key={task.id}
                  task={task}
                  now={now}
                  index={index}
                  active={task.id === activeId}
                  dragging={task.id === dragId}
                  activeTags={activeTags}
                  onDragStart={() => setDragId(task.id)}
                  onOpen={onOpen}
                  onMove={onMove}
                  onTagClick={onTagClick}
                />
              ))}
              {items.length === 0 ? (
                <p className={styles.columnEmpty}>{dragId ? "Drop here" : "No tasks"}</p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({
  task,
  now,
  index,
  active,
  dragging,
  activeTags,
  onDragStart,
  onOpen,
  onMove,
  onTagClick,
}: {
  task: Task;
  now: Date;
  index: number;
  active: boolean;
  dragging: boolean;
  activeTags: string[];
  onDragStart(): void;
  onOpen(id: string): void;
  onMove(task: Task, column: BoardColumn): void;
  onTagClick(tag: string): void;
}) {
  const archived = isArchived(task);
  const next = archived ? task.status : nextBoardStatus(task.status);
  const progress = subtaskProgress(task);
  const [icon, label] = archived
    ? [<ArchiveRestore key="i" size={14} />, "Restore"]
    : next === "done"
      ? [<Check key="i" size={14} />, "Mark as done"]
      : next === "in_progress"
        ? [<CirclePlay key="i" size={14} />, "Start"]
        : [<RotateCcw key="i" size={14} />, "Reopen"];

  return (
    <article
      className={styles.card}
      data-active={active || undefined}
      data-done={task.status === "done" || undefined}
      data-dragging={dragging || undefined}
      draggable
      style={{ "--i": Math.min(index, 10) } as CSSProperties}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", task.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
    >
      <button type="button" className={styles.cardTitle} onClick={() => onOpen(task.id)}>
        {task.title}
      </button>
      <div className={styles.cardMeta}>
        <PriorityBadge priority={task.priority} />
        <DueBadge task={task} now={now} />
        {progress ? (
          <span className={styles.cardProgress}>
            {progress.done}/{progress.total}
          </span>
        ) : null}
        <TagChips tags={task.tags} limit={3} activeTags={activeTags} onTagClick={onTagClick} />
      </div>
      <footer className={styles.cardFoot}>
        <AvatarStack ids={task.assigneeIds} size={22} />
        {/* The keyboard path for everything a drag does. */}
        <button
          type="button"
          className={styles.advance}
          title={label}
          aria-label={`${label}: ${task.title}`}
          onClick={() => onMove(task, archived ? task.status : next)}
        >
          {icon}
        </button>
      </footer>
    </article>
  );
}
