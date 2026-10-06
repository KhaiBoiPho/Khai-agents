import { Check, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { TagChip } from "./bits";

import styles from "./TasksPage.module.css";

/**
 * Rename, merge and remove a tag across every task. Renaming onto an existing
 * tag merges the two; removing detaches it and leaves the tasks alone.
 */
export function TagManager({
  open,
  tags,
  onRename,
  onDelete,
  onClose,
}: {
  open: boolean;
  tags: Array<{ tag: string; count: number }>;
  onRename(from: string, to: string): void;
  onDelete(tag: string): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [editing, setEditing] = useState<{ tag: string; value: string } | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);

  const save = () => {
    if (editing && editing.value.trim() && editing.value.trim() !== editing.tag) {
      onRename(editing.tag, editing.value);
    }
    setEditing(null);
  };

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose} aria-labelledby="task-tag-manager-title">
      <header>
        <h2 id="task-tag-manager-title">Manage tags</h2>
        <button type="button" className={styles.iconButton} aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      {tags.length === 0 ? (
        <p className={styles.dialogEmpty}>No tags yet. Add them from a task’s detail.</p>
      ) : (
        <ul className={styles.tagList}>
          {tags.map(({ tag, count }) => (
            <li key={tag}>
              {editing?.tag === tag ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    save();
                  }}
                >
                  <input
                    value={editing.value}
                    autoFocus
                    aria-label={`Rename ${tag}`}
                    onChange={(event) => setEditing({ tag, value: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        setEditing(null);
                      }
                    }}
                  />
                  <button type="submit" className={styles.iconButton} aria-label="Save">
                    <Check size={14} />
                  </button>
                </form>
              ) : (
                <>
                  <TagChip tag={tag} />
                  <small>
                    {count} {count === 1 ? "task" : "tasks"}
                  </small>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Rename ${tag}`}
                    onClick={() => setEditing({ tag, value: tag })}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Remove ${tag} from every task`}
                    onClick={() => onDelete(tag)}
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className={styles.dialogHint}>Renaming onto an existing tag merges the two.</p>
    </dialog>
  );
}
