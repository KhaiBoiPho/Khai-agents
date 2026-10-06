/**
 * Notes data: the model, the sticky palette, seed data and the pure
 * filter/sort rules the board renders from.
 *
 * Ported from Yuvomi's Notes module (MIT, © 2026 ulsklyc).
 *
 * TODO(backend): notes live in this browser's storage under
 * PLANNER_KEYS.notes; replace with a notes service (GET/POST/PUT /notes,
 * PATCH /notes/:id/pin and /notes/:id/check with an `expect` line for
 * optimistic locking, and /notes/categories) when one exists.
 */

import { MEMBERS } from "../shared/members";
import { PLANNER_KEYS, readStore } from "../shared/persistentState";

export const NOTES_KEY = PLANNER_KEYS.notes;

/**
 * Yuvomi's muted sticker palette. The keys are stored, not hex values, so the
 * CSS can give each colour a light-dark() pair that reads on every theme.
 */
export const NOTE_COLORS = [
  { id: "yellow", name: "Yellow" },
  { id: "amber", name: "Amber" },
  { id: "green", name: "Green" },
  { id: "teal", name: "Teal" },
  { id: "blue", name: "Blue" },
  { id: "purple", name: "Purple" },
  { id: "orange", name: "Orange" },
  { id: "white", name: "White" },
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number]["id"];
export const DEFAULT_NOTE_COLOR: NoteColor = "yellow";

export function isNoteColor(value: unknown): value is NoteColor {
  return NOTE_COLORS.some((color) => color.id === value);
}

export type CategoryScope = "personal" | "household";

export interface NoteCategory {
  id: string;
  name: string;
  /** Personal categories belong to one member; household ones to everyone. */
  scope: CategoryScope;
}

export interface Note {
  id: string;
  title: string | null;
  content: string;
  color: NoteColor;
  pinned: boolean;
  /** Member id from shared/members. */
  createdBy: string;
  categoryIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NotesData {
  notes: Note[];
  categories: NoteCategory[];
}

export type NoteSort = "updated" | "created" | "title";

export const SORT_LABELS: Record<NoteSort, string> = {
  updated: "Last edited",
  created: "Date created",
  title: "Title",
};

export interface NoteFilter {
  query: string;
  /** Member id; empty for everyone. */
  creator: string;
  /** A note must carry every selected category (Yuvomi's AND rule). */
  categoryIds: string[];
}

export const EMPTY_FILTER: NoteFilter = {
  query: "",
  creator: "",
  categoryIds: [],
};

export const CATEGORY_NAME_MAX_LENGTH = 80;

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

function daysAgo(days: number, hours = 0): string {
  return new Date(
    Date.now() - days * 86_400_000 - hours * 3_600_000,
  ).toISOString();
}

export function seedNotes(): NotesData {
  const categories: NoteCategory[] = [
    { id: "cat-research", name: "Research", scope: "household" },
    { id: "cat-release", name: "Release", scope: "household" },
    { id: "cat-reading", name: "Reading", scope: "personal" },
  ];
  const notes: Note[] = [
    {
      id: "welcome",
      title: "Welcome to Notes",
      content: [
        "A board for plans, snippets and research next to your chats.",
        "",
        "- [x] Pin the notes you need every day",
        "- [ ] Tick a box right on the card",
        "- [ ] Open a note to switch between **Read** and **Edit**",
        "",
        "Formatting is plain *Markdown* — the toolbar writes it for you.",
      ].join("\n"),
      color: "yellow",
      pinned: true,
      createdBy: "agent",
      categoryIds: [],
      createdAt: daysAgo(6),
      updatedAt: daysAgo(0, 2),
    },
    {
      id: "release",
      title: "Release checklist",
      content: [
        "- [x] Bump the version in core/version.py",
        "- [x] Run the desktop test suite",
        "- [ ] Smoke-test the web build",
        "- [ ] Write the changelog entry",
      ].join("\n"),
      color: "green",
      pinned: true,
      createdBy: "linh",
      categoryIds: ["cat-release"],
      createdAt: daysAgo(3),
      updatedAt: daysAgo(1),
    },
    {
      id: "shell",
      title: "Learning the shell",
      content: [
        "Reading order for `genoffice/apps/shell`:",
        "",
        "1. package.json — scripts and entry point",
        "2. src/main/index.ts — app lifecycle and windows",
        "3. src/main/tab-manager.ts — tabs",
        "4. src/preload — the bridge",
        "5. src/renderer — the UI",
      ].join("\n"),
      color: "blue",
      pinned: false,
      createdBy: "me",
      categoryIds: ["cat-research", "cat-reading"],
      createdAt: daysAgo(5),
      updatedAt: daysAgo(1, 4),
    },
    {
      id: "ideas",
      title: "Ideas",
      content: [
        "- Split view for two chats",
        "- Inline diff comments",
        "- Vietnamese UI",
        "",
        "> Ask the agent to draft a spec for the first one.",
      ].join("\n"),
      color: "purple",
      pinned: false,
      createdBy: "me",
      categoryIds: [],
      createdAt: daysAgo(4),
      updatedAt: daysAgo(2),
    },
    {
      id: "prompt",
      title: null,
      content: [
        "Prompt that worked well for refactors:",
        "",
        "`Keep behaviour identical; list every file you touch first.`",
      ].join("\n"),
      color: "teal",
      pinned: false,
      createdBy: "minh",
      categoryIds: ["cat-research"],
      createdAt: daysAgo(8),
      updatedAt: daysAgo(3),
    },
  ];
  return { notes, categories };
}

// ---------------------------------------------------------------------------
// Load / normalise
// ---------------------------------------------------------------------------

/** Drops entries of a stale shape instead of letting them crash the board. */
export function normalizeNotesData(raw: unknown, seed: NotesData): NotesData {
  if (!raw || typeof raw !== "object") return seed;
  const { notes, categories } = raw as Partial<NotesData>;
  if (!Array.isArray(notes) || !Array.isArray(categories)) return seed;

  const cleanCategories = categories.filter(
    (category): category is NoteCategory =>
      !!category &&
      typeof category.id === "string" &&
      typeof category.name === "string" &&
      (category.scope === "personal" || category.scope === "household"),
  );
  const known = new Set(cleanCategories.map((category) => category.id));
  const cleanNotes = notes
    .filter(
      (note): note is Note =>
        !!note &&
        typeof note.id === "string" &&
        typeof note.content === "string",
    )
    .map((note) => ({
      ...note,
      title:
        typeof note.title === "string" && note.title.trim() ? note.title : null,
      color: isNoteColor(note.color) ? note.color : DEFAULT_NOTE_COLOR,
      pinned: !!note.pinned,
      createdBy: typeof note.createdBy === "string" ? note.createdBy : "me",
      categoryIds: Array.isArray(note.categoryIds)
        ? note.categoryIds.filter((id) => known.has(id))
        : [],
      createdAt:
        typeof note.createdAt === "string"
          ? note.createdAt
          : new Date().toISOString(),
      updatedAt:
        typeof note.updatedAt === "string"
          ? note.updatedAt
          : new Date().toISOString(),
    }));
  return { notes: cleanNotes, categories: cleanCategories };
}

export function loadNotesData(): NotesData {
  const seed = seedNotes();
  return normalizeNotesData(readStore<unknown>(NOTES_KEY, seed), seed);
}

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

export function noteMatchesCategories(
  note: Note,
  categoryIds: readonly string[],
): boolean {
  return categoryIds.every((id) => note.categoryIds.includes(id));
}

export function filterNotes(
  notes: readonly Note[],
  filter: NoteFilter,
): Note[] {
  const query = filter.query.trim().toLowerCase();
  return notes.filter((note) => {
    if (filter.creator && note.createdBy !== filter.creator) return false;
    if (!noteMatchesCategories(note, filter.categoryIds)) return false;
    if (!query) return true;
    return (
      (note.title ?? "").toLowerCase().includes(query) ||
      note.content.toLowerCase().includes(query)
    );
  });
}

/** Pinned notes always lead (Yuvomi: ORDER BY pinned DESC, updated_at DESC). */
export function sortNotes(
  notes: readonly Note[],
  sort: NoteSort = "updated",
): Note[] {
  const within = (left: Note, right: Note): number => {
    if (sort === "created")
      return right.createdAt.localeCompare(left.createdAt);
    if (sort === "title") {
      const byName = noteName(left).localeCompare(noteName(right), undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (byName) return byName;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  };
  return [...notes].sort(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned) || within(left, right),
  );
}

/**
 * What a screen reader calls a note: the title, else its first line without
 * Markdown marks, else "Note". Twenty buttons named "Delete note" are one.
 */
export function noteName(note: Pick<Note, "title" | "content">): string {
  const title = (note.title ?? "").trim();
  if (title) return title;
  const line = note.content
    .split("\n")
    .map((part) =>
      part
        .replace(
          /^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/,
          "",
        )
        .replace(/[*_`~]/g, "")
        .replace(/<\/?u>/g, "")
        .trim(),
    )
    .find(Boolean);
  if (!line) return "Note";
  return line.length > 40 ? `${line.slice(0, 40).trimEnd()}…` : line;
}

/** Creators with at least one note, in member order. */
export function noteCreators(notes: readonly Note[]) {
  const ids = new Set(notes.map((note) => note.createdBy));
  return MEMBERS.filter((member) => ids.has(member.id));
}

/** Categories worth a filter chip: in use, or currently selected. */
export function filterableCategories(
  categories: readonly NoteCategory[],
  notes: readonly Note[],
  selected: readonly string[],
): NoteCategory[] {
  const used = new Set(notes.flatMap((note) => note.categoryIds));
  return categories.filter(
    (category) => used.has(category.id) || selected.includes(category.id),
  );
}

export function findCategoryByName(
  categories: readonly NoteCategory[],
  name: string,
  scope?: CategoryScope,
): NoteCategory | null {
  const key = name.trim().toLocaleLowerCase();
  return (
    categories.find(
      (category) =>
        category.name.trim().toLocaleLowerCase() === key &&
        (!scope || category.scope === scope),
    ) ?? null
  );
}

/** Unselected categories whose name contains the query, best match first. */
export function categorySuggestions(
  categories: readonly NoteCategory[],
  selected: readonly string[],
  query: string,
): NoteCategory[] {
  const key = query.trim().toLocaleLowerCase();
  return categories
    .filter((category) => !selected.includes(category.id))
    .filter(
      (category) => !key || category.name.toLocaleLowerCase().includes(key),
    )
    .sort((left, right) => {
      const leftStarts = left.name.toLocaleLowerCase().startsWith(key) ? 0 : 1;
      const rightStarts = right.name.toLocaleLowerCase().startsWith(key)
        ? 0
        : 1;
      return leftStarts - rightStarts || left.name.localeCompare(right.name);
    })
    .slice(0, 8);
}

export function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}
