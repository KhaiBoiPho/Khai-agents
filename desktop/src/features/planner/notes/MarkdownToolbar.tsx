/**
 * Formatting bar over the note's text field, so nobody has to know Markdown
 * syntax. After Yuvomi's utils/markdown-toolbar.js (MIT, © 2026 ulsklyc):
 * it appears once the field is focused and then stays (hiding it on blur
 * would shift the field under the pointer), and it is one tab stop with
 * arrow-key roving, per the WAI-ARIA toolbar pattern.
 */

import {
  Bold,
  Code,
  Heading,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Underline,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useRef, useState, type KeyboardEvent } from "react";

import type { MarkdownFormat } from "./markdownFormat";
import styles from "./NotesPage.module.css";

const ACTIONS: Array<
  Array<{ format: MarkdownFormat; icon: LucideIcon; label: string }>
> = [
  [
    { format: "bold", icon: Bold, label: "Bold (Ctrl+B)" },
    { format: "italic", icon: Italic, label: "Italic (Ctrl+I)" },
    { format: "underline", icon: Underline, label: "Underline (Ctrl+U)" },
    { format: "strikethrough", icon: Strikethrough, label: "Strikethrough" },
  ],
  [
    { format: "heading", icon: Heading, label: "Heading" },
    { format: "list", icon: List, label: "Bullet list" },
    { format: "ordered-list", icon: ListOrdered, label: "Numbered list" },
    { format: "checklist", icon: ListChecks, label: "Checklist" },
  ],
  [
    { format: "link", icon: Link, label: "Link" },
    { format: "code", icon: Code, label: "Code" },
    { format: "quote", icon: Quote, label: "Quote" },
    { format: "divider", icon: Minus, label: "Divider" },
  ],
];

const FLAT = ACTIONS.flat();
/** Index of each group's first button in FLAT. */
const GROUP_OFFSETS = ACTIONS.map((_, group) =>
  ACTIONS.slice(0, group).reduce((sum, items) => sum + items.length, 0),
);

interface MarkdownToolbarProps {
  visible: boolean;
  onFormat(format: MarkdownFormat): void;
}

export function MarkdownToolbar({ visible, onFormat }: MarkdownToolbarProps) {
  const [active, setActive] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const moveTo = (index: number) => {
    const next = (index + FLAT.length) % FLAT.length;
    setActive(next);
    buttons.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rtl = document.documentElement.dir === "rtl";
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[
      event.key
    ];
    if (step) {
      event.preventDefault();
      moveTo(active + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveTo(FLAT.length - 1);
    }
  };

  return (
    <div
      className={styles.mdToolbar}
      role="toolbar"
      aria-label="Text formatting"
      hidden={!visible}
      onKeyDown={onKeyDown}
    >
      {ACTIONS.map((group, groupIndex) => (
        <Fragment key={groupIndex}>
          {groupIndex > 0 ? (
            <span
              className={styles.mdToolbarSep}
              role="separator"
              aria-orientation="vertical"
            />
          ) : null}
          {group.map(({ format, icon: Icon, label }, position) => {
            const index = GROUP_OFFSETS[groupIndex]! + position;
            return (
              <button
                key={format}
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                type="button"
                className={styles.mdToolbarButton}
                tabIndex={index === active ? 0 : -1}
                title={label}
                aria-label={label}
                // Keep the textarea's selection: a focus move would collapse it.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setActive(index);
                  onFormat(format);
                }}
              >
                <Icon size={15} aria-hidden="true" />
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
