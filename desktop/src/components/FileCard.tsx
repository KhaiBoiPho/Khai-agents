import { X } from "lucide-react";

import { displayFileName, fileTypeLabel } from "../app/fileNames";
import { FileBadge } from "./FileBadge";
import styles from "./FileCard.module.css";

interface FileCardProps {
  path: string;
  onRemove?(): void;
  onOpen?(): void;
  /** "compact" is the smaller chip used inside the composer. */
  size?: "regular" | "compact";
}

/** An attached file: its type badge, its name, and what kind of file it is. */
export function FileCard({ path, onRemove, onOpen, size = "regular" }: FileCardProps) {
  const name = displayFileName(path);
  const body = (
    <>
      <FileBadge path={path} size={size === "compact" ? 22 : 26} />
      <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        <span className={styles.type}>{fileTypeLabel(path)}</span>
      </span>
    </>
  );
  return (
    <span className={styles.card} data-size={size} title={name}>
      {onOpen ? (
        <button type="button" className={styles.main} onClick={onOpen}>
          {body}
        </button>
      ) : (
        <span className={styles.main}>{body}</span>
      )}
      {onRemove ? (
        <button
          type="button"
          className={styles.remove}
          onClick={onRemove}
          aria-label={`Remove ${name}`}
        >
          <X size={12} strokeWidth={2.4} />
        </button>
      ) : null}
    </span>
  );
}
