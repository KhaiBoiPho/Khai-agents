import {
  Archive,
  Check,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import type { Thread } from "../../generated/app-server";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import styles from "./SessionRow.module.css";

interface SessionRowProps {
  thread: Thread;
  active: boolean;
  busy: boolean;
  onSelect(threadId: string): void;
  onRename(threadId: string, title: string): Promise<void>;
  onArchive(threadId: string): Promise<void>;
  onDelete(threadId: string): Promise<void>;
  pinned?: boolean;
  favorite?: boolean;
  onTogglePin?: (threadId: string) => void;
  onToggleFavorite?: (threadId: string) => void;
}

type RowMode = "closed" | "menu" | "rename" | "archive" | "delete";

export function SessionRow({
  thread,
  active,
  busy,
  onSelect,
  onRename,
  onArchive,
  onDelete,
  pinned = false,
  favorite = false,
  onTogglePin,
  onToggleFavorite,
}: SessionRowProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<RowMode>("closed");
  const [draft, setDraft] = useState(thread.title);
  const archiveDisabled =
    thread.status === "running" || thread.status === "waiting";

  useEffect(() => {
    if (mode !== "rename") return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [mode]);

  useEffect(() => {
    if (mode === "closed" || mode === "rename") return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMode("closed");
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [mode]);

  useEffect(() => {
    if (mode === "closed") return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMode("closed");
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mode]);

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    if (title !== thread.title) {
      await onRename(thread.id, title);
    }
    setMode("closed");
  };

  return (
    <div className={styles.row} data-active={active} ref={rootRef}>
      {mode === "rename" ? (
        <form className={styles.renameForm} onSubmit={(event) => void submitRename(event)}>
          <span
            className={styles.beacon}
            data-status={thread.status}
            aria-hidden="true"
          />
          <label>
            <span className={styles.srOnly}>Rename Session</span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy}
              maxLength={160}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Save Session name"
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            onClick={() => setMode("closed")}
            aria-label="Cancel Session rename"
          >
            <X size={14} />
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            className={styles.sessionButton}
            onClick={() => {
              setMode("closed");
              onSelect(thread.id);
            }}
            disabled={busy}
            aria-label={`Open Session ${thread.title}`}
            title={`${thread.title}\n${thread.workspacePath}`}
          >
            <span
              className={styles.beacon}
              data-status={thread.status}
              aria-label={thread.status.replaceAll("_", " ")}
            />
            <span className={styles.copy}>
              <strong>{thread.title}</strong>
            </span>
            {favorite ? <Star size={12} className={styles.mark} /> : null}
            {pinned ? <Pin size={12} className={styles.mark} /> : null}
          </button>
          <button
            className={styles.moreButton}
            type="button"
            onClick={() => setMode((current) => (current === "closed" ? "menu" : "closed"))}
            disabled={busy}
            aria-label={`Session actions for ${thread.title}`}
            aria-expanded={mode !== "closed"}
            aria-haspopup="menu"
          >
            <MoreHorizontal size={16} />
          </button>
        </>
      )}

      {mode === "menu" ? (
        <div className={styles.menu} role="menu" aria-label={`Actions for ${thread.title}`}>
          {onTogglePin ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMode("closed");
                onTogglePin(thread.id);
              }}
            >
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
              {pinned ? "Unpin" : "Pin"}
            </button>
          ) : null}
          {onToggleFavorite ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMode("closed");
                onToggleFavorite(thread.id);
              }}
            >
              <Star size={14} />
              {favorite ? "Remove from favorites" : "Add to favorites"}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setDraft(thread.title);
              setMode("rename");
            }}
          >
            <Pencil size={14} />
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.archiveAction}
            onClick={() => setMode("archive")}
            disabled={archiveDisabled}
            title={
              archiveDisabled
                ? "Stop active work before archiving this Session."
                : undefined
            }
          >
            <Archive size={14} />
            Archive
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.deleteAction}
            onClick={() => setMode("delete")}
            disabled={archiveDisabled}
            title={
              archiveDisabled
                ? "Stop active work before deleting this Session."
                : undefined
            }
          >
            <Trash2 size={14} />
            Delete permanently
          </button>
        </div>
      ) : null}

      {mode === "archive" ? (
        <ConfirmDialog
          title="Archive this chat?"
          description={
            <>
              <strong>{thread.title}</strong> moves out of the sidebar. Its history is kept
              and it can be restored.
            </>
          }
          confirmLabel="Archive"
          icon="archive"
          busy={busy}
          onCancel={() => setMode("closed")}
          onConfirm={() => {
            setMode("closed");
            void onArchive(thread.id);
          }}
        />
      ) : null}

      {mode === "delete" ? (
        <ConfirmDialog
          title="Delete chat?"
          description={
            <>
              <strong>{thread.title}</strong> and its history will be permanently deleted.
              Files in the workspace stay untouched.
            </>
          }
          confirmLabel="Delete"
          tone="danger"
          busy={busy}
          onCancel={() => setMode("closed")}
          onConfirm={() => {
            setMode("closed");
            void onDelete(thread.id);
          }}
        />
      ) : null}
    </div>
  );
}
