/**
 * A note's Markdown, with checklist boxes that write back to the source.
 *
 * GFM gives every task item a disabled <input>. The <li> knows its source
 * line (hast position); the <input> does not, so each <li> hands its line
 * down through context and the box override reads it. The box only becomes
 * a control when that source line really is a checklist line under the
 * shared rule in checklist.ts; otherwise it stays a labelled state mark.
 */

import { Check } from "lucide-react";
import {
  createContext,
  memo,
  useContext,
  type ComponentProps,
  type MouseEvent,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { matchChecklistLine, splitKeepingLineEndings } from "./checklist";
import styles from "./NotesPage.module.css";

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
}

/**
 * The toolbar writes <u>…</u> (Markdown has no underline). Raw HTML stays
 * off for safety, so only this one pair is turned into an element.
 */
function remarkUnderline() {
  const visit = (node: MdNode) => {
    const children = node.children;
    if (!children) return;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!;
      if (child.type === "html" && /^<u>$/i.test(child.value ?? "")) {
        const close = children.findIndex(
          (candidate, at) =>
            at > index &&
            candidate.type === "html" &&
            /^<\/u>$/i.test(candidate.value ?? ""),
        );
        if (close !== -1) {
          const inner = children.slice(index + 1, close);
          children.splice(index, close - index + 1, {
            type: "emphasis",
            children: inner,
            data: { hName: "u" },
          });
          continue;
        }
      }
      visit(child);
    }
  };
  return (tree: unknown) => visit(tree as MdNode);
}

const REMARK_PLUGINS = [remarkGfm, remarkUnderline];

/** 1-based source line of the enclosing list item. */
const ItemLine = createContext<number | null>(null);

interface ChecklistContextValue {
  lines: string[];
  onToggle?: (line: number, checked: boolean, expect: string) => void;
}

const Checklist = createContext<ChecklistContextValue>({ lines: [] });

function ListItem({
  node,
  children,
  ...props
}: ComponentProps<"li"> & { node?: unknown }) {
  const line = (
    node as { position?: { start?: { line?: number } } } | undefined
  )?.position?.start?.line;
  return (
    <ItemLine.Provider value={line ?? null}>
      <li {...props}>{children}</li>
    </ItemLine.Provider>
  );
}

function TaskBox({ checked: fallbackChecked }: { checked: boolean }) {
  const lineNumber = useContext(ItemLine);
  const { lines, onToggle } = useContext(Checklist);
  const index = lineNumber === null ? -1 : lineNumber - 1;
  const raw = index >= 0 ? lines[index * 2] : undefined;
  const item = matchChecklistLine(raw);
  const checked = item ? item.checked : fallbackChecked;

  if (!item || !onToggle || raw === undefined) {
    return (
      <span
        className={styles.mdBox}
        role="img"
        aria-label={checked ? "Done" : "Open"}
        data-checked={checked || undefined}
      >
        {checked ? (
          <Check size={11} strokeWidth={3} aria-hidden="true" />
        ) : null}
      </span>
    );
  }

  const toggle = (event: MouseEvent) => {
    // A tick on the card must not open the note — that's the whole point.
    event.stopPropagation();
    onToggle(index, !checked, raw);
  };

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={`Tick item: ${item.text.replace(/[*_`~]/g, "")}`}
      className={styles.mdBox}
      data-checked={checked || undefined}
      data-interactive=""
      onClick={toggle}
    >
      {checked ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : null}
    </button>
  );
}

const COMPONENTS: Components = {
  li: ListItem,
  input: ({ node, type, checked, ...props }) => {
    void node;
    return type === "checkbox" ? (
      <TaskBox checked={!!checked} />
    ) : (
      <input type={type} {...props} />
    );
  },
  a: ({ node, children, href, ...props }) => {
    void node;
    return (
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </a>
    );
  },
};

interface NoteMarkdownProps {
  content: string;
  /** Present only when the boxes may write back to this exact source. */
  onToggle?: (line: number, checked: boolean, expect: string) => void;
  className?: string;
}

export const NoteMarkdown = memo(function NoteMarkdown({
  content,
  onToggle,
  className,
}: NoteMarkdownProps) {
  const lines = splitKeepingLineEndings(content);
  return (
    <Checklist.Provider value={{ lines, onToggle }}>
      <div className={[styles.markdown, className].filter(Boolean).join(" ")}>
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
          {content}
        </ReactMarkdown>
      </div>
    </Checklist.Provider>
  );
});
