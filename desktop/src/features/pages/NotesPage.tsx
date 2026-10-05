/**
 * Notes — a preview of a Notion-style notebook.
 *
 * TODO(backend): notes are kept in this browser's storage; replace with a
 * notes service (blocks, sharing, search) when one exists.
 */

import { FileText, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import styles from "./Pages.module.css";

interface Note {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

const KEY = "khai-agents.notes";

const SEED: Note[] = [
  {
    id: "welcome",
    title: "Welcome to Notes",
    body:
      "Notes are a place for plans, snippets and research next to your chats.\n\n" +
      "• Write freely — everything saves as you type.\n" +
      "• Use one note per topic.\n" +
      "• Soon: blocks, embeds and asking the agent about a note.",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "shell",
    title: "Learning the shell",
    body:
      "Reading order for genoffice/apps/shell:\n\n" +
      "1. package.json — scripts and entry point\n" +
      "2. src/main/index.ts — app lifecycle and windows\n" +
      "3. src/main/tab-manager.ts — tabs\n" +
      "4. src/preload — the bridge\n" +
      "5. src/renderer — the UI",
    updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
  {
    id: "ideas",
    title: "Ideas",
    body: "- Split view for two chats\n- Inline diff comments\n- Vietnamese UI",
    updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  },
];

function load(): Note[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return Array.isArray(parsed) && parsed.length ? parsed : SEED;
  } catch {
    return SEED;
  }
}

export function NotesPage() {
  const [notes, setNotes] = useState<Note[]>(load);
  const [activeId, setActiveId] = useState<string | null>(() => load()[0]?.id ?? null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(notes));
    } catch {
      // Preview storage only.
    }
  }, [notes]);

  const sorted = useMemo(
    () =>
      [...notes]
        .filter((note) =>
          `${note.title} ${note.body}`.toLowerCase().includes(query.toLowerCase()),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [notes, query],
  );
  const active = notes.find((note) => note.id === activeId) ?? null;

  const update = (patch: Partial<Note>) => {
    if (!active) return;
    setNotes((current) =>
      current.map((note) =>
        note.id === active.id
          ? { ...note, ...patch, updatedAt: new Date().toISOString() }
          : note,
      ),
    );
  };

  const create = () => {
    const note: Note = {
      id: crypto.randomUUID(),
      title: "Untitled",
      body: "",
      updatedAt: new Date().toISOString(),
    };
    setNotes((current) => [note, ...current]);
    setActiveId(note.id);
  };

  return (
    <div className={styles.notes}>
      <aside className={styles.noteList}>
        <div className={styles.noteListHead}>
          <strong>Notes</strong>
          <button type="button" onClick={create} aria-label="New note" title="New note">
            <Plus size={16} />
          </button>
        </div>
        <label className={styles.search}>
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes"
            aria-label="Search notes"
          />
        </label>
        {sorted.map((note) => (
          <button
            type="button"
            key={note.id}
            className={styles.noteItem}
            data-active={note.id === activeId || undefined}
            onClick={() => setActiveId(note.id)}
          >
            <FileText size={14} />
            <span>
              <strong>{note.title || "Untitled"}</strong>
              <small>{note.body.split("\n")[0] || "Empty note"}</small>
            </span>
          </button>
        ))}
      </aside>
      <section className={styles.noteEditor}>
        {active ? (
          <>
            <div className={styles.noteToolbar}>
              <span>
                Edited{" "}
                {new Date(active.updatedAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
              <button
                type="button"
                onClick={() => {
                  setNotes((current) => current.filter((note) => note.id !== active.id));
                  setActiveId(sorted.find((note) => note.id !== active.id)?.id ?? null);
                }}
                aria-label="Delete note"
                title="Delete note"
              >
                <Trash2 size={15} />
              </button>
            </div>
            <input
              className={styles.noteTitle}
              value={active.title}
              onChange={(event) => update({ title: event.target.value })}
              placeholder="Untitled"
              aria-label="Note title"
            />
            <textarea
              className={styles.noteBody}
              value={active.body}
              onChange={(event) => update({ body: event.target.value })}
              placeholder="Start writing…"
              aria-label="Note body"
            />
          </>
        ) : (
          <div className={styles.emptyNote}>
            <p>No note selected.</p>
            <button type="button" onClick={create}>
              <Plus size={15} /> New note
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
