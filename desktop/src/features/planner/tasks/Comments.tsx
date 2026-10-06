import { Pencil, Send, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { MEMBERS, memberById } from "../shared/members";
import { Avatar } from "./bits";
import { CURRENT_USER_ID, type TaskComment } from "./types";

import styles from "./TaskDetail.module.css";

/**
 * `@Name` against the member list, read from the text itself so the
 * highlighted name and the notified person can never drift apart. Longest
 * name wins, case-insensitive, and a word character before `@` (an email
 * address) disqualifies it.
 */
function renderMentions(text: string): ReactNode[] {
  const names = [...MEMBERS].sort((a, b) => b.name.length - a.name.length);
  const out: ReactNode[] = [];
  let buffer = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] === "@" && (index === 0 || !/\w/.test(text[index - 1]!))) {
      const rest = text.slice(index + 1).toLocaleLowerCase();
      const member = names.find(
        (entry) =>
          rest.startsWith(entry.name.toLocaleLowerCase()) && !/\w/.test(rest[entry.name.length] ?? ""),
      );
      if (member) {
        if (buffer) out.push(buffer);
        buffer = "";
        out.push(
          <mark key={index} className={styles.mention}>
            @{member.name}
          </mark>,
        );
        index += member.name.length + 1;
        continue;
      }
    }
    buffer += text[index];
    index += 1;
  }
  if (buffer) out.push(buffer);
  return out;
}

function relativeTime(iso: string, now: Date): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function Comments({
  comments,
  now,
  onAdd,
  onEdit,
  onDelete,
}: {
  comments: TaskComment[];
  now: Date;
  onAdd(text: string): void;
  onEdit(id: string, text: string): void;
  onDelete(id: string): void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const mentionQuery = /(?:^|\s)@(\w*)$/.exec(draft)?.[1];
  const suggestions =
    mentionQuery === undefined
      ? []
      : MEMBERS.filter((member) => member.name.toLocaleLowerCase().startsWith(mentionQuery.toLocaleLowerCase()));

  const send = () => {
    if (!draft.trim()) return;
    onAdd(draft);
    setDraft("");
  };

  return (
    <div className={styles.comments}>
      {comments.length === 0 ? <p className={styles.hint}>No comments yet. Type @ to mention someone.</p> : null}
      <ul>
        {comments.map((comment) => {
          const own = comment.authorId === CURRENT_USER_ID;
          const isEditing = editing?.id === comment.id;
          return (
            <li key={comment.id} className={styles.comment}>
              <Avatar memberId={comment.authorId} size={22} />
              <div>
                <header>
                  <strong>{memberById(comment.authorId)?.name ?? "Former member"}</strong>
                  <time dateTime={comment.createdAt}>{relativeTime(comment.createdAt, now)}</time>
                  {comment.updatedAt ? <small>(edited)</small> : null}
                  {own && !isEditing ? (
                    <span className={styles.commentActions}>
                      <button type="button" aria-label="Edit comment" onClick={() => setEditing({ id: comment.id, text: comment.text })}>
                        <Pencil size={12} />
                      </button>
                      <button type="button" aria-label="Delete comment" onClick={() => onDelete(comment.id)}>
                        <Trash2 size={12} />
                      </button>
                    </span>
                  ) : null}
                </header>
                {isEditing ? (
                  <textarea
                    className={styles.commentInput}
                    value={editing.text}
                    autoFocus
                    aria-label="Edit comment"
                    onChange={(event) => setEditing({ id: comment.id, text: event.target.value })}
                    onBlur={() => {
                      onEdit(comment.id, editing.text);
                      setEditing(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.blur();
                      } else if (event.key === "Escape") {
                        event.stopPropagation();
                        setEditing(null);
                      }
                    }}
                  />
                ) : (
                  <p>{renderMentions(comment.text)}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <form
        className={styles.commentForm}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          className={styles.commentInput}
          value={draft}
          rows={2}
          placeholder="Write a comment…"
          aria-label="New comment"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button type="submit" aria-label="Send comment" disabled={!draft.trim()}>
          <Send size={14} />
        </button>
        {suggestions.length ? (
          <div className={styles.suggest} role="listbox" aria-label="Mention">
            {suggestions.map((member) => (
              <button
                type="button"
                role="option"
                aria-selected={false}
                key={member.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setDraft(draft.replace(/@(\w*)$/, `@${member.name} `))}
              >
                <Avatar memberId={member.id} size={18} />
                {member.name}
              </button>
            ))}
          </div>
        ) : null}
      </form>
    </div>
  );
}
