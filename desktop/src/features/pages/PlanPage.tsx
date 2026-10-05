/**
 * Plan — a preview task board.
 *
 * TODO(backend): cards are kept in this browser's storage; link them to
 * Sessions and goals when a planning service exists.
 */

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import styles from "./Pages.module.css";

type Column = "todo" | "doing" | "done";

interface Card {
  id: string;
  title: string;
  tag: string;
  column: Column;
}

const COLUMNS: Array<{ id: Column; label: string }> = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "In progress" },
  { id: "done", label: "Done" },
];

const NEXT: Record<Column, Column> = { todo: "doing", doing: "done", done: "todo" };

const KEY = "khai-agents.plan";

const SEED: Card[] = [
  { id: "1", title: "Split view for multiple chats", tag: "Feature", column: "todo" },
  { id: "2", title: "Inline comments on diffs", tag: "Feature", column: "todo" },
  { id: "3", title: "Vietnamese interface", tag: "i18n", column: "todo" },
  { id: "4", title: "Real token usage in the context ring", tag: "Backend", column: "doing" },
  { id: "5", title: "Plain chats without a project", tag: "Feature", column: "done" },
  { id: "6", title: "Settings in the desktop style", tag: "UI", column: "done" },
];

function load(): Card[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return Array.isArray(parsed) ? parsed : SEED;
  } catch {
    return SEED;
  }
}

export function PlanPage() {
  const [cards, setCards] = useState<Card[]>(load);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(cards));
    } catch {
      // Preview storage only.
    }
  }, [cards]);

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    setCards((current) => [
      ...current,
      { id: crypto.randomUUID(), title, tag: "Task", column: "todo" },
    ]);
    setDraft("");
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Plan</h1>
        <form
          className={styles.headerActions}
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <label className={styles.search}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a task and press Enter"
              aria-label="New task"
            />
          </label>
          <button type="submit" className={styles.primary}>
            <Plus size={15} /> Add
          </button>
        </form>
      </header>

      <div className={styles.board}>
        {COLUMNS.map((column) => {
          const items = cards.filter((card) => card.column === column.id);
          return (
            <section className={styles.boardColumn} key={column.id}>
              <header>
                <strong>{column.label}</strong>
                <span>{items.length}</span>
              </header>
              {items.map((card) => (
                <button
                  type="button"
                  key={card.id}
                  className={styles.boardCard}
                  data-done={card.column === "done" || undefined}
                  title="Click to move to the next column"
                  onClick={() =>
                    setCards((current) =>
                      current.map((entry) =>
                        entry.id === card.id ? { ...entry, column: NEXT[entry.column] } : entry,
                      ),
                    )
                  }
                >
                  <span>{card.title}</span>
                  <small>{card.tag}</small>
                </button>
              ))}
            </section>
          );
        })}
      </div>
      <p className={styles.previewNote}>Preview — click a card to move it along.</p>
    </div>
  );
}
