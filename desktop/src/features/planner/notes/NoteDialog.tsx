/**
 * The note dialog: Read and Edit panes of one note, as in Yuvomi (#507).
 * Existing notes open to Read, new ones straight into Edit. The Read pane
 * mirrors unsaved edits, but its boxes only write back while the text shown
 * is the saved text — otherwise its line numbers point into a draft (#704).
 */

import { BookOpen, Home, Pencil, Plus, Trash2, User, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { MarkdownToolbar } from "./MarkdownToolbar";
import { applyFormat, type MarkdownFormat } from "./markdownFormat";
import { CategoryBadge } from "./NoteCard";
import { NoteMarkdown } from "./NoteMarkdown";
import {
  CATEGORY_NAME_MAX_LENGTH,
  DEFAULT_NOTE_COLOR,
  NOTE_COLORS,
  categorySuggestions,
  findCategoryByName,
  type CategoryScope,
  type Note,
  type NoteCategory,
  type NoteColor,
} from "./noteStore";
import styles from "./NotesPage.module.css";

export interface NoteDraft {
  title: string | null;
  content: string;
  color: NoteColor;
  pinned: boolean;
  categoryIds: string[];
}

interface NoteDialogProps {
  /** The saved note, kept live by the page; null when creating. */
  note: Note | null;
  categories: readonly NoteCategory[];
  onSave(draft: NoteDraft): void;
  onDelete(id: string): void;
  onClose(): void;
  onCreateCategory(name: string, scope: CategoryScope): NoteCategory;
  /** Returns the note's new content, or null when the tick was refused. */
  onToggleCheck(
    id: string,
    line: number,
    checked: boolean,
    expect: string,
  ): string | null;
}

type View = "read" | "edit";

export function NoteDialog({
  note,
  categories,
  onSave,
  onDelete,
  onClose,
  onCreateCategory,
  onToggleCheck,
}: NoteDialogProps) {
  const isEdit = note !== null;
  const ids = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Record<View, HTMLButtonElement | null>>({
    read: null,
    edit: null,
  });
  const pendingSelection = useRef<[number, number] | null>(null);

  const [view, setView] = useState<View>(isEdit ? "read" : "edit");
  const [title, setTitle] = useState(note?.title ?? "");
  const [content, setContent] = useState(note?.content ?? "");
  const [color, setColor] = useState<NoteColor>(
    note?.color ?? DEFAULT_NOTE_COLOR,
  );
  const [pinned, setPinned] = useState(note?.pinned ?? false);
  const [categoryIds, setCategoryIds] = useState<string[]>(
    note?.categoryIds ?? [],
  );
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [contentError, setContentError] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const dirty = isEdit
    ? title.trim() !== (note.title ?? "").trim() ||
      content !== note.content ||
      color !== note.color ||
      pinned !== note.pinned ||
      categoryIds.join() !== note.categoryIds.join()
    : title.trim() !== "" || content.trim() !== "" || categoryIds.length > 0;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    // Read opens on the active tab (a small first stop beats the close
    // button); a new note opens on the title.
    if (isEdit) tabRefs.current.read?.focus();
    else titleRef.current?.focus();
  }, [isEdit]);

  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    const textarea = textareaRef.current;
    if (!selection || !textarea) return;
    pendingSelection.current = null;
    textarea.focus();
    textarea.setSelectionRange(selection[0], selection[1]);
  }, [content]);

  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  const switchView = (next: View, { focusField = false } = {}) => {
    setView(next);
    setConfirmDiscard(false);
    if (next === "edit" && focusField) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const format = (kind: MarkdownFormat) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const result = applyFormat(
      content,
      textarea.selectionStart,
      textarea.selectionEnd,
      kind,
    );
    pendingSelection.current = [result.selectionStart, result.selectionEnd];
    setContent(result.value);
    setContentError(false);
  };

  const onTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    const key = event.key.toLowerCase();
    const shortcut = ({ b: "bold", i: "italic", u: "underline" } as const)[
      key as "b" | "i" | "u"
    ];
    if (shortcut) {
      event.preventDefault();
      format(shortcut);
    }
  };

  const save = () => {
    const trimmed = content.trim();
    if (!trimmed) {
      setContentError(true);
      setView("edit");
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    onSave({
      title: title.trim() || null,
      content: trimmed,
      color,
      pinned,
      categoryIds,
    });
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const order: View[] = ["read", "edit"];
    const at = order.indexOf(view);
    let next: View | null = null;
    if (
      ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)
    ) {
      next = order[(at + 1) % 2]!;
    } else if (event.key === "Home") next = "read";
    else if (event.key === "End") next = "edit";
    if (!next) return;
    event.preventDefault();
    switchView(next);
    tabRefs.current[next]?.focus();
  };

  const readIsLive = isEdit && content === note.content;
  const shownCategories = categoryIds
    .map((id) => categories.find((category) => category.id === id))
    .filter((category): category is NoteCategory => !!category);
  const heading = title.trim() || (isEdit ? "Note" : "New note");
  const advancedOpen =
    isEdit && (note.pinned || note.color !== DEFAULT_NOTE_COLOR);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      data-color={color}
      aria-labelledby={`${ids}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (confirmDiscard) setConfirmDiscard(false);
        else requestClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === dialogRef.current) requestClose();
      }}
    >
      <div className={styles.dialogInner}>
        <header className={styles.dialogHeader}>
          <h2 id={`${ids}-title`}>{heading}</h2>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Close"
            onClick={requestClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        {isEdit ? (
          <div
            className={styles.modeSwitch}
            role="tablist"
            aria-label="Switch view"
          >
            {(["read", "edit"] as const).map((mode) => {
              const Icon = mode === "read" ? BookOpen : Pencil;
              return (
                <button
                  key={mode}
                  ref={(element) => {
                    tabRefs.current[mode] = element;
                  }}
                  type="button"
                  role="tab"
                  id={`${ids}-tab-${mode}`}
                  aria-selected={view === mode}
                  aria-controls={`${ids}-pane-${mode}`}
                  tabIndex={view === mode ? 0 : -1}
                  onClick={() =>
                    switchView(mode, { focusField: mode === "edit" })
                  }
                  onKeyDown={onTabKeyDown}
                >
                  <Icon size={14} aria-hidden="true" />
                  {mode === "read" ? "Read" : "Edit"}
                </button>
              );
            })}
          </div>
        ) : null}

        {view === "read" && isEdit ? (
          <div
            className={styles.readPane}
            id={`${ids}-pane-read`}
            role="tabpanel"
            aria-labelledby={`${ids}-tab-read`}
            tabIndex={-1}
          >
            {shownCategories.length ? (
              <div
                className={styles.cardCategories}
                role="group"
                aria-label="Categories"
              >
                {shownCategories.map((category) => (
                  <CategoryBadge key={category.id} category={category} />
                ))}
              </div>
            ) : null}
            {content.trim() ? (
              <NoteMarkdown
                className={styles.readBody}
                content={content}
                onToggle={
                  readIsLive
                    ? (line, checked, expect) => {
                        const next = onToggleCheck(
                          note.id,
                          line,
                          checked,
                          expect,
                        );
                        if (next !== null) setContent(next);
                      }
                    : undefined
                }
              />
            ) : (
              <p className={styles.readEmpty}>This note has no content yet.</p>
            )}
          </div>
        ) : null}

        <div
          className={styles.editPane}
          id={`${ids}-pane-edit`}
          role={isEdit ? "tabpanel" : undefined}
          aria-labelledby={isEdit ? `${ids}-tab-edit` : undefined}
          hidden={view !== "edit"}
        >
          <label className={styles.srOnly} htmlFor={`${ids}-title-input`}>
            Title (optional)
          </label>
          <input
            ref={titleRef}
            id={`${ids}-title-input`}
            className={styles.titleInput}
            placeholder="Title (optional)"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <label className={styles.srOnly} htmlFor={`${ids}-content`}>
            Content (Markdown formatting supported)
          </label>
          <MarkdownToolbar visible={toolbarVisible} onFormat={format} />
          <textarea
            ref={textareaRef}
            id={`${ids}-content`}
            className={styles.contentInput}
            placeholder="Enter note…"
            rows={12}
            value={content}
            aria-invalid={contentError || undefined}
            aria-describedby={contentError ? `${ids}-content-error` : undefined}
            onFocus={() => setToolbarVisible(true)}
            onKeyDown={onTextareaKeyDown}
            onChange={(event) => {
              setContent(event.target.value);
              if (contentError) setContentError(false);
            }}
          />
          {contentError ? (
            <p
              className={styles.fieldError}
              id={`${ids}-content-error`}
              role="alert"
            >
              Content is required.
            </p>
          ) : null}

          <CategoryPicker
            categories={categories}
            selected={categoryIds}
            onChange={setCategoryIds}
            onCreate={onCreateCategory}
          />

          <details className={styles.advanced} open={advancedOpen || undefined}>
            <summary>More options</summary>
            <div className={styles.advancedBody}>
              <ColorPicker value={color} onChange={setColor} />
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(event) => setPinned(event.target.checked)}
                />
                <span className={styles.toggleTrack} aria-hidden="true" />
                <span>Pin to the top</span>
              </label>
            </div>
          </details>
        </div>

        <footer className={styles.dialogFooter}>
          {confirmDiscard ? (
            <div
              className={styles.discard}
              role="alertdialog"
              aria-label="Discard changes?"
            >
              <span>Discard unsaved changes?</span>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setConfirmDiscard(false)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className={styles.dangerButton}
                onClick={onClose}
              >
                Discard
              </button>
            </div>
          ) : (
            <>
              {isEdit ? (
                <button
                  type="button"
                  className={styles.dangerOutline}
                  onClick={() => onDelete(note.id)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Delete
                </button>
              ) : null}
              <span className={styles.footerSpacer} />
              {view === "edit" ? (
                <>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={requestClose}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={save}
                  >
                    {isEdit ? "Save" : "Create"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => switchView("edit", { focusField: true })}
                >
                  Edit
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </dialog>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: NoteColor;
  onChange(color: NoteColor): void;
}) {
  const labelId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
      event.key
    ];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + NOTE_COLORS.length) % NOTE_COLORS.length;
    onChange(NOTE_COLORS[next]!.id);
    refs.current[next]?.focus();
  };

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel} id={labelId}>
        Color
      </span>
      <div
        className={styles.swatches}
        role="radiogroup"
        aria-labelledby={labelId}
      >
        {NOTE_COLORS.map((color, index) => (
          <button
            key={color.id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={value === color.id}
            aria-label={color.name}
            title={color.name}
            tabIndex={value === color.id ? 0 : -1}
            className={styles.swatch}
            data-color={color.id}
            onClick={() => onChange(color.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          />
        ))}
      </div>
    </div>
  );
}

interface CategoryPickerProps {
  categories: readonly NoteCategory[];
  selected: string[];
  onChange(ids: string[]): void;
  onCreate(name: string, scope: CategoryScope): NoteCategory;
}

/** Search-or-create combobox over the category catalog (Yuvomi v176). */
function CategoryPicker({
  categories,
  selected,
  onChange,
  onCreate,
}: CategoryPickerProps) {
  const ids = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [scope, setScope] = useState<CategoryScope>("personal");

  const suggestions = categorySuggestions(categories, selected, query);
  const trimmed = query.trim();
  const canCreate =
    trimmed !== "" && !findCategoryByName(categories, trimmed, scope);
  const showList = open && suggestions.length > 0;
  const chosen = selected
    .map((id) => categories.find((category) => category.id === id))
    .filter((category): category is NoteCategory => !!category);

  const pick = (category: NoteCategory) => {
    if (!selected.includes(category.id)) onChange([...selected, category.id]);
    setQuery("");
    setActive(-1);
    setOpen(false);
    inputRef.current?.focus();
  };

  const create = () => {
    if (!trimmed) return;
    const existing = findCategoryByName(categories, trimmed, scope);
    pick(
      existing ?? onCreate(trimmed.slice(0, CATEGORY_NAME_MAX_LENGTH), scope),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!suggestions.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => {
        const next = current + step;
        if (next >= suggestions.length) return 0;
        return next < 0 ? suggestions.length - 1 : next;
      });
    } else if (event.key === "Enter") {
      // Enter belongs to the picker here, never to the dialog.
      event.preventDefault();
      const option = suggestions[active];
      if (showList && option) pick(option);
      else {
        const exact =
          findCategoryByName(categories, trimmed, scope) ??
          findCategoryByName(categories, trimmed);
        if (exact) pick(exact);
        else if (canCreate) create();
      }
    } else if (event.key === "Escape" && showList) {
      // Close the popup, not the whole dialog.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  };

  const activeOption = showList ? suggestions[active] : undefined;

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={`${ids}-search`}>
        Categories
      </label>
      {chosen.length ? (
        <div className={styles.chosen}>
          {chosen.map((category) => {
            const Icon = category.scope === "personal" ? User : Home;
            return (
              <span key={category.id} className={styles.chosenChip}>
                <Icon size={13} aria-hidden="true" />
                <span>{category.name}</span>
                <button
                  type="button"
                  aria-label={`Remove category ${category.name}`}
                  onClick={() => {
                    onChange(selected.filter((id) => id !== category.id));
                    inputRef.current?.focus();
                  }}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
      <div
        className={styles.picker}
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setOpen(false);
            setActive(-1);
          }
        }}
      >
        <input
          ref={inputRef}
          id={`${ids}-search`}
          className={styles.input}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={`${ids}-list`}
          aria-activedescendant={
            activeOption ? `${ids}-option-${activeOption.id}` : undefined
          }
          autoComplete="off"
          maxLength={CATEGORY_NAME_MAX_LENGTH}
          placeholder="Search or create a category…"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <div
          className={styles.pickerList}
          id={`${ids}-list`}
          role="listbox"
          aria-label="Category suggestions"
          hidden={!showList}
        >
          {suggestions.map((category, index) => {
            const Icon = category.scope === "personal" ? User : Home;
            return (
              <button
                key={category.id}
                id={`${ids}-option-${category.id}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                data-active={index === active || undefined}
                className={styles.pickerOption}
                // Keep focus in the input until the click selects.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(category)}
              >
                <Icon size={14} aria-hidden="true" />
                <span>{category.name}</span>
                <small>
                  {category.scope === "personal" ? "Personal" : "Household"}
                </small>
              </button>
            );
          })}
        </div>
      </div>
      {trimmed ? (
        <div className={styles.createRow}>
          <select
            className={styles.input}
            aria-label="Category type"
            value={scope}
            onChange={(event) => setScope(event.target.value as CategoryScope)}
          >
            <option value="personal">Personal</option>
            <option value="household">Household</option>
          </select>
          {canCreate ? (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={create}
            >
              <Plus size={14} aria-hidden="true" />
              Create and assign “{trimmed}”
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
