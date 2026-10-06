import { Archive, CheckCheck, RotateCcw, Tag, Trash2 } from "lucide-react";
import { useState } from "react";

import type { Task, TaskStatus } from "./types";

import styles from "./TasksPage.module.css";

/** Batch actions over the picked rows; shown only in selection mode. */
export function BulkBar({
  tasks,
  onSelectAll,
  onStatus,
  onArchive,
  onAddTag,
  onDelete,
  onDone,
}: {
  tasks: Task[];
  onSelectAll(): void;
  onStatus(status: TaskStatus): void;
  onArchive(): void;
  onAddTag(tag: string): void;
  onDelete(): void;
  onDone(): void;
}) {
  const [tag, setTag] = useState("");
  const none = tasks.length === 0;

  return (
    <div className={styles.bulkBar} role="toolbar" aria-label="Selected tasks">
      <strong>{tasks.length} selected</strong>
      <button type="button" onClick={onSelectAll}>
        Select all
      </button>
      <span className={styles.bulkDivider} />
      <button type="button" disabled={none} onClick={() => onStatus("done")}>
        <CheckCheck size={14} aria-hidden="true" /> Done
      </button>
      <button type="button" disabled={none} onClick={() => onStatus("open")}>
        <RotateCcw size={14} aria-hidden="true" /> Reopen
      </button>
      <button type="button" disabled={none} onClick={onArchive}>
        <Archive size={14} aria-hidden="true" /> Archive
      </button>
      <form
        className={styles.bulkTag}
        onSubmit={(event) => {
          event.preventDefault();
          if (!tag.trim() || none) return;
          onAddTag(tag.trim());
          setTag("");
        }}
      >
        <Tag size={13} aria-hidden="true" />
        <input value={tag} placeholder="Add tag" aria-label="Tag to add" onChange={(event) => setTag(event.target.value)} />
      </form>
      <button type="button" className={styles.bulkDanger} disabled={none} onClick={onDelete}>
        <Trash2 size={14} aria-hidden="true" /> Delete
      </button>
      <button type="button" className={styles.bulkClose} onClick={onDone}>
        Close
      </button>
    </div>
  );
}
