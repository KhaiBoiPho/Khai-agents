import { Archive, ArchiveRestore, Check, ListPlus, MessageSquare, Plus, Repeat } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { AvatarStack, DueBadge, PriorityBadge, ProgressBar, StartBadge, TagChips } from "./bits";
import { isArchived, subtaskProgress } from "./taskModel";
import { categoryLabel, FALLBACK_CATEGORY, type Task } from "./types";

import styles from "./TaskList.module.css";

export interface RowHandlers {
  onOpen(id: string): void;
  onToggleDone(task: Task): void;
  onToggleSubtask(taskId: string, subtaskId: string): void;
  onAddSubtask(taskId: string, title: string): void;
  onArchive(task: Task): void;
  onTagClick(tag: string): void;
  onPick(id: string): void;
}

interface TaskRowProps extends RowHandlers {
  task: Task;
  now: Date;
  index: number;
  active: boolean;
  selecting: boolean;
  picked: boolean;
  leaving: boolean;
  fresh: boolean;
  showCategory: boolean;
  activeTags: string[];
}

export function TaskRow({
  task,
  now,
  index,
  active,
  selecting,
  picked,
  leaving,
  fresh,
  showCategory,
  activeTags,
  ...on
}: TaskRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [popped, setPopped] = useState(false);
  const done = task.status === "done";
  const archived = isArchived(task);
  const progress = subtaskProgress(task);
  const showSubtasks = (expanded && progress !== null) || adding;

  const submitSubtask = () => {
    if (draft.trim()) on.onAddSubtask(task.id, draft);
    setDraft("");
  };

  return (
    <li
      className={styles.row}
      data-row-id={task.id}
      data-active={active || undefined}
      data-done={done || undefined}
      data-leaving={leaving || undefined}
      data-fresh={fresh || undefined}
      style={{ "--i": Math.min(index, 14) } as CSSProperties}
    >
      <div className={styles.rowMain}>
        {selecting ? (
          <button
            type="button"
            className={styles.selectCircle}
            aria-pressed={picked}
            aria-label={`Select ${task.title}`}
            onClick={() => on.onPick(task.id)}
          >
            <Check size={12} strokeWidth={3} />
          </button>
        ) : (
          <button
            type="button"
            className={styles.check}
            data-status={task.status}
            data-pop={popped || undefined}
            aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} as done`}
            onClick={() => {
              setPopped(!done);
              on.onToggleDone(task);
            }}
          >
            <Check size={12} strokeWidth={3} />
          </button>
        )}

        <div className={styles.rowBody}>
          <button
            type="button"
            className={styles.rowTitle}
            data-row-focus
            onClick={() => (selecting ? on.onPick(task.id) : on.onOpen(task.id))}
          >
            {task.title}
          </button>
          <div className={styles.rowMeta}>
            {archived ? (
              <span className={styles.archivedBadge}>
                <Archive size={12} aria-hidden="true" /> Archived
              </span>
            ) : null}
            <PriorityBadge priority={task.priority} />
            {task.dueDate ? null : <StartBadge task={task} now={now} />}
            <DueBadge task={task} now={now} />
            {task.recurrenceRule ? (
              <span className={styles.icon} role="img" aria-label="Repeats" title="Repeats">
                <Repeat size={12} />
              </span>
            ) : null}
            {task.comments.length ? (
              <span className={styles.icon} title={`${task.comments.length} comments`}>
                <MessageSquare size={12} aria-hidden="true" />
                {task.comments.length}
              </span>
            ) : null}
            {showCategory && task.category !== FALLBACK_CATEGORY ? (
              <span className={styles.category}>{categoryLabel(task.category)}</span>
            ) : null}
            <TagChips tags={task.tags} limit={2} activeTags={activeTags} onTagClick={on.onTagClick} />
          </div>
        </div>

        <AvatarStack ids={task.assigneeIds} size={24} />

        {selecting ? null : (
          <div className={styles.rowActions}>
            {archived ? null : (
              <button
                type="button"
                className={styles.rowAction}
                title="Add subtask"
                aria-label={`Add a subtask to ${task.title}`}
                onClick={() => {
                  setAdding(true);
                  setExpanded(true);
                }}
              >
                <ListPlus size={15} />
              </button>
            )}
            <button
              type="button"
              className={styles.rowAction}
              title={archived ? "Restore" : "Archive"}
              aria-label={archived ? `Restore ${task.title}` : `Archive ${task.title}`}
              onClick={() => on.onArchive(task)}
            >
              {archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            </button>
          </div>
        )}
      </div>

      {progress ? (
        <button
          type="button"
          className={styles.progressToggle}
          aria-expanded={showSubtasks}
          aria-controls={`subtasks-${task.id}`}
          aria-label={`Subtasks, ${progress.done} of ${progress.total} done`}
          onClick={() => {
            setExpanded(!showSubtasks);
            if (showSubtasks) setAdding(false);
          }}
        >
          <ProgressBar done={progress.done} total={progress.total} />
          <span>
            {progress.done}/{progress.total}
          </span>
        </button>
      ) : null}

      {showSubtasks ? (
        <ul className={styles.subtasks} id={`subtasks-${task.id}`}>
          {task.subtasks.map((subtask) => (
            <li key={subtask.id} data-done={subtask.done || undefined}>
              <button
                type="button"
                className={styles.subCheck}
                aria-pressed={subtask.done}
                aria-label={subtask.done ? `Reopen ${subtask.title}` : `Mark ${subtask.title} as done`}
                disabled={selecting}
                onClick={() => on.onToggleSubtask(task.id, subtask.id)}
              >
                <Check size={10} strokeWidth={3} />
              </button>
              <span>{subtask.title}</span>
            </li>
          ))}
          {selecting || archived ? null : adding ? (
            <li>
              <form
                className={styles.subAdd}
                onSubmit={(event) => {
                  event.preventDefault();
                  submitSubtask();
                }}
              >
                <Plus size={13} aria-hidden="true" />
                <input
                  autoFocus
                  value={draft}
                  placeholder="Add a subtask and press Enter"
                  aria-label={`New subtask for ${task.title}`}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => {
                    submitSubtask();
                    setAdding(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setDraft("");
                      setAdding(false);
                    }
                  }}
                />
              </form>
            </li>
          ) : (
            <li>
              <button type="button" className={styles.subAddButton} onClick={() => setAdding(true)}>
                <Plus size={13} aria-hidden="true" /> Add subtask
              </button>
            </li>
          )}
        </ul>
      ) : null}
    </li>
  );
}
