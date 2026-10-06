/**
 * Notes — a board of Markdown sticky notes with tappable checklists.
 *
 * Ported from Yuvomi's Notes module (MIT, © 2026 ulsklyc).
 *
 * TODO(backend): notes and categories are kept in this browser's storage
 * (PLANNER_KEYS.notes); replace with a notes service when one exists. The
 * server-side parts of Yuvomi — permission-gated household categories,
 * read-only access, and the 409 conflict on a stale checklist tick — are
 * mirrored locally where they still mean something and skipped otherwise.
 */

import {
  ArrowUpDown,
  FileText,
  Home,
  Plus,
  Search,
  Tags,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Dropdown } from "../../../components/Dropdown";
import { writeStore } from "../shared/persistentState";
import { toggleChecklistLine } from "./checklist";
import { NoteCard } from "./NoteCard";
import { NoteDialog, type NoteDraft } from "./NoteDialog";
import {
  CATEGORY_NAME_MAX_LENGTH,
  EMPTY_FILTER,
  NOTES_KEY,
  SORT_LABELS,
  filterNotes,
  filterableCategories,
  findCategoryByName,
  loadNotesData,
  newId,
  noteCreators,
  sortNotes,
  type CategoryScope,
  type Note,
  type NoteCategory,
  type NoteFilter,
  type NotesData,
  type NoteSort,
} from "./noteStore";
import styles from "./NotesPage.module.css";

const UNDO_MS = 5000;
const STAGGER_MAX = 5;

type DialogState = { mode: "create" } | { mode: "edit"; id: string } | null;

interface Toast {
  id: string;
  message: string;
  tone: "default" | "success" | "danger";
  undo?: () => void;
}

export function NotesPage() {
  const [data, setData] = useState<NotesData>(loadNotesData);
  const dataRef = useRef(data);
  const [filter, setFilter] = useState<NoteFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<NoteSort>("updated");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [managing, setManaging] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number>());
  // Only the cards on the board at first paint stagger in (Yuvomi staggers
  // a host once); later arrivals just fade in without a queue.
  const [initialIds] = useState(
    () => new Set(sortNotes(data.notes).map((note) => note.id)),
  );

  useEffect(() => {
    writeStore(NOTES_KEY, data);
  }, [data]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  /** Every write goes through here so rapid taps never read a stale copy. */
  const update = useCallback((change: (current: NotesData) => NotesData) => {
    const next = change(dataRef.current);
    dataRef.current = next;
    setData(next);
  }, []);

  const dismissToast = useCallback((id: string) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: Omit<Toast, "id">, duration = 3000) => {
      const id = newId("toast");
      setToasts((current) => [...current.slice(-2), { ...toast, id }]);
      timers.current.set(
        id,
        window.setTimeout(() => dismissToast(id), duration),
      );
    },
    [dismissToast],
  );

  // ---- Actions -------------------------------------------------------------

  const togglePin = useCallback(
    (id: string) => {
      update((current) => ({
        ...current,
        notes: current.notes.map((note) =>
          note.id === id ? { ...note, pinned: !note.pinned } : note,
        ),
      }));
    },
    [update],
  );

  const deleteNote = useCallback(
    (id: string) => {
      const note = dataRef.current.notes.find(
        (candidate) => candidate.id === id,
      );
      if (!note) return;
      setDialog(null);
      update((current) => ({
        ...current,
        notes: current.notes.filter((item) => item.id !== id),
      }));
      showToast(
        {
          message: "Note deleted",
          tone: "default",
          undo: () =>
            update((current) => {
              if (current.notes.some((item) => item.id === id)) return current;
              const known = new Set(
                current.categories.map((category) => category.id),
              );
              const restored = {
                ...note,
                categoryIds: note.categoryIds.filter((cid) => known.has(cid)),
              };
              return { ...current, notes: [...current.notes, restored] };
            }),
        },
        UNDO_MS,
      );
    },
    [showToast, update],
  );

  /**
   * Tick one box. The line the user saw travels along as `expect`; if the
   * note changed underneath, nothing is written (Yuvomi's 409 path). A tick
   * leaves `updatedAt` alone so the note doesn't jump away under the pointer.
   */
  const toggleCheck = useCallback(
    (
      id: string,
      line: number,
      checked: boolean,
      expect: string,
    ): string | null => {
      const note = dataRef.current.notes.find(
        (candidate) => candidate.id === id,
      );
      if (!note) return null;
      const result = toggleChecklistLine(note.content, line, checked, expect);
      if (!result.ok) {
        showToast({
          message: "The note has changed in the meantime.",
          tone: "danger",
        });
        return null;
      }
      if (result.changed) {
        update((current) => ({
          ...current,
          notes: current.notes.map((item) =>
            item.id === id ? { ...item, content: result.content } : item,
          ),
        }));
      }
      return result.content;
    },
    [showToast, update],
  );

  const saveNote = (draft: NoteDraft) => {
    const now = new Date().toISOString();
    if (dialog?.mode === "edit") {
      update((current) => ({
        ...current,
        notes: current.notes.map((note) =>
          note.id === dialog.id ? { ...note, ...draft, updatedAt: now } : note,
        ),
      }));
      showToast({ message: "Note saved", tone: "success" });
    } else {
      const note: Note = {
        ...draft,
        id: newId("note"),
        createdBy: "me",
        createdAt: now,
        updatedAt: now,
      };
      update((current) => ({ ...current, notes: [note, ...current.notes] }));
      showToast({ message: "Note created", tone: "success" });
    }
    setDialog(null);
  };

  const createCategory = (name: string, scope: CategoryScope): NoteCategory => {
    const existing = findCategoryByName(
      dataRef.current.categories,
      name,
      scope,
    );
    if (existing) return existing;
    const category: NoteCategory = {
      id: newId("cat"),
      name: name.trim(),
      scope,
    };
    update((current) => ({
      ...current,
      categories: [...current.categories, category],
    }));
    return category;
  };

  const renameCategory = (id: string, name: string) => {
    const trimmed = name.trim().slice(0, CATEGORY_NAME_MAX_LENGTH);
    if (!trimmed) return;
    update((current) => ({
      ...current,
      categories: current.categories.map((category) =>
        category.id === id ? { ...category, name: trimmed } : category,
      ),
    }));
  };

  /** Removes the category from every note; the notes themselves stay. */
  const deleteCategory = (id: string) => {
    update((current) => ({
      categories: current.categories.filter((category) => category.id !== id),
      notes: current.notes.map((note) =>
        note.categoryIds.includes(id)
          ? {
              ...note,
              categoryIds: note.categoryIds.filter((cid) => cid !== id),
            }
          : note,
      ),
    }));
    setFilter((current) => ({
      ...current,
      categoryIds: current.categoryIds.filter((cid) => cid !== id),
    }));
  };

  // ---- Derived -------------------------------------------------------------

  const visible = useMemo(
    () => sortNotes(filterNotes(data.notes, filter), sort),
    [data.notes, filter, sort],
  );
  const creators = useMemo(() => noteCreators(data.notes), [data.notes]);
  const chipCategories = filterableCategories(
    data.categories,
    data.notes,
    filter.categoryIds,
  );
  const pinned = visible.filter((note) => note.pinned);
  const others = visible.filter((note) => !note.pinned);
  // Section heads only when both groups exist; then card titles drop a level.
  const grouped = pinned.length > 0 && others.length > 0;
  const editing =
    dialog?.mode === "edit"
      ? (data.notes.find((note) => note.id === dialog.id) ?? null)
      : null;
  const isFiltered =
    !!filter.query.trim() || !!filter.creator || filter.categoryIds.length > 0;

  const renderCards = (notes: Note[], offset: number) =>
    notes.map((note, index) => (
      <NoteCard
        key={note.id}
        note={note}
        categories={data.categories}
        headingLevel={grouped ? 3 : 2}
        stagger={
          initialIds.has(note.id) ? Math.min(offset + index, STAGGER_MAX) : 0
        }
        onOpen={(target) => setDialog({ mode: "edit", id: target.id })}
        onTogglePin={togglePin}
        onDelete={deleteNote}
        onToggleCheck={toggleCheck}
      />
    ));

  const noResultsText = filter.query.trim()
    ? `No note contains “${filter.query.trim()}”.`
    : filter.categoryIds.length
      ? "No notes match all selected categories."
      : `No notes from ${creators.find((member) => member.id === filter.creator)?.name ?? "this person"}.`;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Notes</h1>
        <div className={styles.headerActions}>
          <label className={styles.search}>
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={filter.query}
              onChange={(event) =>
                setFilter((current) => ({
                  ...current,
                  query: event.target.value,
                }))
              }
              placeholder="Search notes…"
              aria-label="Search notes"
            />
            {filter.query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() =>
                  setFilter((current) => ({ ...current, query: "" }))
                }
              >
                <X size={13} aria-hidden="true" />
              </button>
            ) : null}
          </label>
          <Dropdown
            triggerClassName={styles.toolButton}
            triggerLabel={`Sort by: ${SORT_LABELS[sort]}`}
            title="Sort notes"
            align="end"
            trigger={
              <>
                <ArrowUpDown size={14} aria-hidden="true" />
                <span>{SORT_LABELS[sort]}</span>
              </>
            }
            sections={[
              {
                title: "Sort by",
                items: (Object.keys(SORT_LABELS) as NoteSort[]).map((key) => ({
                  id: key,
                  label: SORT_LABELS[key],
                  selected: key === sort,
                  onSelect: () => setSort(key),
                })),
              },
            ]}
          />
          <button
            type="button"
            className={styles.toolButton}
            aria-label="Manage categories"
            title="Manage categories"
            onClick={() => setManaging(true)}
          >
            <Tags size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => setDialog({ mode: "create" })}
          >
            <Plus size={15} aria-hidden="true" />
            New note
          </button>
        </div>
      </header>

      {creators.length >= 2 || chipCategories.length ? (
        <div className={styles.filters}>
          {creators.length >= 2 ? (
            <div
              className={styles.filterGroup}
              role="group"
              aria-label="Created by"
            >
              <button
                type="button"
                className={styles.chip}
                aria-pressed={!filter.creator}
                onClick={() =>
                  setFilter((current) => ({ ...current, creator: "" }))
                }
              >
                All
              </button>
              {creators.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className={styles.chip}
                  aria-pressed={filter.creator === member.id}
                  onClick={() =>
                    // A second click on the active chip clears the filter.
                    setFilter((current) => ({
                      ...current,
                      creator: current.creator === member.id ? "" : member.id,
                    }))
                  }
                >
                  {member.name}
                </button>
              ))}
            </div>
          ) : null}
          {chipCategories.length ? (
            <div
              className={styles.filterGroup}
              role="group"
              aria-label="Filter by categories"
            >
              <button
                type="button"
                className={styles.chip}
                aria-pressed={filter.categoryIds.length === 0}
                onClick={() =>
                  setFilter((current) => ({ ...current, categoryIds: [] }))
                }
              >
                All
              </button>
              {chipCategories.map((category) => {
                const Icon = category.scope === "personal" ? User : Home;
                const active = filter.categoryIds.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    className={styles.chip}
                    aria-pressed={active}
                    onClick={() =>
                      setFilter((current) => ({
                        ...current,
                        categoryIds: active
                          ? current.categoryIds.filter(
                              (id) => id !== category.id,
                            )
                          : [...current.categoryIds, category.id],
                      }))
                    }
                  >
                    <Icon size={12} aria-hidden="true" />
                    {category.name}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={styles.scroll}>
        {visible.length === 0 ? (
          isFiltered ? (
            <div className={styles.empty} role="status">
              <Search size={22} aria-hidden="true" />
              <strong>No results</strong>
              <p>{noResultsText}</p>
            </div>
          ) : (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>
                <FileText size={22} aria-hidden="true" />
              </span>
              <strong>No notes yet</strong>
              <p>
                Plans, snippets and checklists — pinned where you can see them.
              </p>
              <small>Notes are full-text searchable.</small>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => setDialog({ mode: "create" })}
              >
                <Plus size={15} aria-hidden="true" />
                Create note
              </button>
            </div>
          )
        ) : (
          <div className={styles.grid}>
            {grouped ? (
              <>
                <h2 className={styles.groupTitle}>Pinned</h2>
                {renderCards(pinned, 0)}
                <h2 className={styles.groupTitle}>Other notes</h2>
                {renderCards(others, pinned.length)}
              </>
            ) : (
              renderCards(visible, 0)
            )}
          </div>
        )}
      </div>

      {dialog && (dialog.mode === "create" || editing) ? (
        <NoteDialog
          key={dialog.mode === "edit" ? dialog.id : "new"}
          note={editing}
          categories={data.categories}
          onSave={saveNote}
          onDelete={deleteNote}
          onClose={() => setDialog(null)}
          onCreateCategory={createCategory}
          onToggleCheck={toggleCheck}
        />
      ) : null}

      {managing ? (
        <CategoryManager
          categories={data.categories}
          onCreate={createCategory}
          onRename={renameCategory}
          onDelete={deleteCategory}
          onClose={() => setManaging(false)}
        />
      ) : null}

      <div className={styles.toasts} aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={styles.toast}
            data-tone={toast.tone}
            role="status"
          >
            <span>{toast.message}</span>
            {toast.undo ? (
              <button
                type="button"
                onClick={() => {
                  toast.undo?.();
                  dismissToast(toast.id);
                }}
              >
                Undo
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

interface CategoryManagerProps {
  categories: readonly NoteCategory[];
  onCreate(name: string, scope: CategoryScope): NoteCategory;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
  onClose(): void;
}

function CategoryManager({
  categories,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: CategoryManagerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<CategoryScope>("personal");
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }, []);

  const add = () => {
    if (!name.trim()) return;
    onCreate(name.trim().slice(0, CATEGORY_NAME_MAX_LENGTH), scope);
    setName("");
  };

  const groups: Array<{ scope: CategoryScope; label: string }> = [
    { scope: "personal", label: "Personal" },
    { scope: "household", label: "Household" },
  ];

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="notes-category-manager-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className={styles.dialogInner}>
        <header className={styles.dialogHeader}>
          <h2 id="notes-category-manager-title">Manage categories</h2>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <p className={styles.managerHint}>
          Personal categories are yours alone; household categories are shared
          with everyone in this workspace. Deleting a category never deletes its
          notes.
        </p>
        {groups.map((group) => {
          const items = categories.filter(
            (category) => category.scope === group.scope,
          );
          const Icon = group.scope === "personal" ? User : Home;
          return (
            <section
              key={group.scope}
              className={styles.managerGroup}
              aria-label={group.label}
            >
              <h3>{group.label}</h3>
              {items.length === 0 ? (
                <p className={styles.managerEmpty}>No categories yet.</p>
              ) : null}
              {items.map((category) => (
                <div key={category.id} className={styles.managerRow}>
                  <Icon size={14} aria-hidden="true" />
                  <input
                    className={styles.input}
                    defaultValue={category.name}
                    maxLength={CATEGORY_NAME_MAX_LENGTH}
                    aria-label={`Rename ${category.name}`}
                    onBlur={(event) => {
                      if (event.target.value.trim())
                        onRename(category.id, event.target.value);
                      else event.target.value = category.name;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                  {confirming === category.id ? (
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => {
                        onDelete(category.id);
                        setConfirming(null);
                      }}
                    >
                      Confirm delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={`Delete ${category.name}`}
                      onClick={() => setConfirming(category.id)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </section>
          );
        })}
        <form
          className={styles.managerAdd}
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input
            className={styles.input}
            value={name}
            maxLength={CATEGORY_NAME_MAX_LENGTH}
            placeholder="New category"
            aria-label="New category name"
            onChange={(event) => setName(event.target.value)}
          />
          <select
            className={styles.input}
            aria-label="Category type"
            value={scope}
            onChange={(event) => setScope(event.target.value as CategoryScope)}
          >
            <option value="personal">Personal</option>
            <option value="household">Household</option>
          </select>
          <button
            type="submit"
            className={styles.secondaryButton}
            disabled={!name.trim()}
          >
            <Plus size={14} aria-hidden="true" />
            Add
          </button>
        </form>
      </div>
    </dialog>
  );
}
