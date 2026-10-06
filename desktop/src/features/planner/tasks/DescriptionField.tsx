import { Check, Pencil } from "lucide-react";
import { useState } from "react";

import styles from "./TaskDetail.module.css";

const CHECK_LINE = /^(\s*[-*]\s+\[)([ xX])(\]\s?)(.*)$/;

/**
 * The note reads as text with tickable `- [ ]` items, and turns into a plain
 * editor on demand. A tick rewrites exactly its own source line.
 */
export function DescriptionField({ value, onChange }: { value: string; onChange(value: string): void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing || !value.trim()) {
    return (
      <textarea
        className={styles.description}
        value={editing ? draft : value}
        rows={6}
        autoFocus={editing}
        placeholder="Add a note — “- [ ] item” makes a checklist"
        aria-label="Description"
        onFocus={() => {
          if (!editing) {
            setDraft(value);
            setEditing(true);
          }
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onChange(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  const lines = value.split("\n");
  const toggle = (index: number) => {
    const match = CHECK_LINE.exec(lines[index]!);
    if (!match) return;
    const next = [...lines];
    next[index] = `${match[1]}${match[2] === " " ? "x" : " "}${match[3]}${match[4]}`;
    onChange(next.join("\n"));
  };

  return (
    <div className={styles.note}>
      <button
        type="button"
        className={styles.noteEdit}
        aria-label="Edit description"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        <Pencil size={13} />
      </button>
      {lines.map((line, index) => {
        const match = CHECK_LINE.exec(line);
        if (match) {
          const done = match[2] !== " ";
          return (
            <label key={index} className={styles.noteCheck} data-done={done || undefined}>
              <button type="button" aria-pressed={done} aria-label={match[4] || "Checklist item"} onClick={() => toggle(index)}>
                <Check size={10} strokeWidth={3} />
              </button>
              <span>{match[4]}</span>
            </label>
          );
        }
        const heading = /^#{1,3}\s+(.*)$/.exec(line);
        if (heading) return <strong key={index}>{heading[1]}</strong>;
        return line.trim() ? <p key={index}>{line}</p> : <br key={index} />;
      })}
    </div>
  );
}
