import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ProgressBar } from "./bits";
import type { Subtask } from "./types";

import styles from "./TaskDetail.module.css";

/**
 * Subtasks in the detail: tick, rename and delete each one, add more. Rename
 * and delete are always visible, never hover-only; deleting asks first because,
 * unlike a tick, it can't be taken back.
 */
export function DetailSubtasks({
  subtasks,
  disabled,
  onAdd,
  onToggle,
  onRename,
  onRemove,
}: {
  subtasks: Subtask[];
  disabled: boolean;
  onAdd(title: string): void;
  onToggle(id: string): void;
  onRename(id: string, title: string): void;
  onRemove(id: string): void;
}) {
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const done = subtasks.filter((subtask) => subtask.done).length;

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(null), 3500);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  return (
    <div className={styles.subtasks}>
      {subtasks.length ? (
        <div className={styles.subProgress}>
          <ProgressBar done={done} total={subtasks.length} />
          <span>
            {done} of {subtasks.length} done
          </span>
        </div>
      ) : null}
      <ul>
        {subtasks.map((subtask) => (
          <li key={subtask.id} data-done={subtask.done || undefined}>
            <button
              type="button"
              className={styles.subCheck}
              aria-pressed={subtask.done}
              aria-label={subtask.done ? `Reopen ${subtask.title}` : `Mark ${subtask.title} as done`}
              onClick={() => onToggle(subtask.id)}
            >
              <Check size={10} strokeWidth={3} />
            </button>
            {renaming?.id === subtask.id ? (
              <input
                className={styles.subInput}
                value={renaming.title}
                autoFocus
                aria-label={`Rename ${subtask.title}`}
                onChange={(event) => setRenaming({ id: subtask.id, title: event.target.value })}
                onBlur={() => {
                  onRename(subtask.id, renaming.title);
                  setRenaming(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setRenaming(null);
                  }
                }}
              />
            ) : (
              <span className={styles.subTitle}>{subtask.title}</span>
            )}
            {disabled ? null : (
              <span className={styles.subActions}>
                <button
                  type="button"
                  aria-label={`Rename ${subtask.title}`}
                  onClick={() => setRenaming({ id: subtask.id, title: subtask.title })}
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  data-confirm={confirming === subtask.id || undefined}
                  aria-label={confirming === subtask.id ? `Confirm deleting ${subtask.title}` : `Delete ${subtask.title}`}
                  onClick={() => {
                    if (confirming !== subtask.id) return setConfirming(subtask.id);
                    setConfirming(null);
                    onRemove(subtask.id);
                  }}
                >
                  <Trash2 size={12} />
                  {confirming === subtask.id ? "Delete?" : null}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {disabled ? null : (
        <form
          className={styles.subAdd}
          onSubmit={(event) => {
            event.preventDefault();
            onAdd(draft);
            setDraft("");
          }}
        >
          <Plus size={13} aria-hidden="true" />
          <input
            value={draft}
            placeholder="Add a subtask"
            aria-label="New subtask"
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
      )}
    </div>
  );
}
