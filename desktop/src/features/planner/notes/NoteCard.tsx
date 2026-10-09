import { Home, Pin, PinOff, Trash2, User } from "lucide-react";
import { memo, type CSSProperties } from "react";

import { memberById } from "../shared/members";
import { NoteMarkdown } from "./NoteMarkdown";
import { noteName, type Note, type NoteCategory } from "./noteStore";
import styles from "./NotesPage.module.css";

interface NoteCardProps {
  note: Note;
  categories: readonly NoteCategory[];
  headingLevel: 2 | 3;
  /** Entrance stagger slot; null once the board has settled. */
  stagger: number | null;
  onOpen(note: Note): void;
  onTogglePin(id: string): void;
  onDelete(id: string): void;
  onToggleCheck(
    id: string,
    line: number,
    checked: boolean,
    expect: string,
  ): void;
}

export function CategoryBadge({ category }: { category: NoteCategory }) {
  const Icon = category.scope === "personal" ? User : Home;
  return (
    <span className={styles.categoryBadge}>
      <Icon size={12} aria-hidden="true" />
      <span>{category.name}</span>
      <span className={styles.srOnly}>
        {" "}
        ({category.scope === "personal" ? "Personal" : "Household"})
      </span>
    </span>
  );
}

export const NoteCard = memo(function NoteCard({
  note,
  categories,
  headingLevel,
  stagger,
  onOpen,
  onTogglePin,
  onDelete,
  onToggleCheck,
}: NoteCardProps) {
  const name = noteName(note);
  const author = memberById(note.createdBy);
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const noteCategories = note.categoryIds
    .map((id) => categories.find((category) => category.id === id))
    .filter((category): category is NoteCategory => !!category);

  return (
    <article
      className={styles.card}
      data-color={note.color}
      data-pinned={note.pinned || undefined}
      data-enter={stagger !== null || undefined}
      style={
        stagger !== null
          ? ({ "--stagger": stagger } as CSSProperties)
          : undefined
      }
    >
      {/* The whole card opens the note, but the opener is a real button laid
          over it so keyboard and screen-reader users reach it; pin, delete,
          boxes and links sit above it. */}
      <button
        type="button"
        className={styles.cardOpen}
        aria-label={`Open ${name}`}
        onClick={() => onOpen(note)}
      />
      <div className={styles.cardHeader}>
        {note.title ? (
          <Heading className={styles.cardTitle}>{note.title}</Heading>
        ) : (
          <span className={styles.cardTitleSpacer} aria-hidden="true" />
        )}
        <button
          type="button"
          className={styles.cardPin}
          aria-label={note.pinned ? "Unpin" : "Pin"}
          aria-pressed={note.pinned}
          title={note.pinned ? "Unpin" : "Pin"}
          onClick={() => onTogglePin(note.id)}
        >
          {note.pinned ? (
            <PinOff size={15} aria-hidden="true" />
          ) : (
            <Pin size={15} aria-hidden="true" />
          )}
        </button>
      </div>
      <NoteMarkdown
        className={styles.cardContent}
        content={note.content}
        onToggle={(line, checked, expect) =>
          onToggleCheck(note.id, line, checked, expect)
        }
      />
      {noteCategories.length ? (
        <div
          className={styles.cardCategories}
          role="group"
          aria-label="Categories"
        >
          {noteCategories.map((category) => (
            <CategoryBadge key={category.id} category={category} />
          ))}
        </div>
      ) : null}
      <footer className={styles.cardFooter}>
        <span className={styles.cardCreator}>
          <span
            className={styles.avatar}
            style={
              {
                "--avatar-color": author?.color ?? "var(--text-tertiary)",
              } as CSSProperties
            }
            aria-hidden="true"
          />
          {author?.name ?? "Someone"}
        </span>
        <button
          type="button"
          className={styles.cardDelete}
          aria-label={`Delete ${name}`}
          title="Delete note"
          onClick={() => onDelete(note.id)}
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
});
