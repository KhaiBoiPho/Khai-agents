import { Check } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import styles from "./Dropdown.module.css";

export interface DropdownItem {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onSelect(): void;
}

export interface DropdownSection {
  title?: string;
  items: DropdownItem[];
}

interface DropdownProps {
  /** Content of the trigger button. */
  trigger: ReactNode;
  sections: DropdownSection[];
  triggerClassName?: string;
  triggerLabel?: string;
  title?: string;
  disabled?: boolean;
  /** Which way the menu opens from the trigger. */
  placement?: "up" | "down";
  align?: "start" | "end";
}

/**
 * Styled replacement for a native select: a button that opens a menu of
 * titled sections, with a check on the selected entry.
 */
export function Dropdown({
  trigger,
  sections,
  triggerClassName,
  triggerLabel,
  title,
  disabled,
  placement = "down",
  align = "start",
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const visible = sections.filter((section) => section.items.length > 0);
  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={triggerClassName ?? styles.trigger}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        title={title}
      >
        {trigger}
      </button>
      {open ? (
        <div
          className={styles.menu}
          data-placement={placement}
          data-align={align}
          role="menu"
        >
          {visible.map((section, index) => (
            <div className={styles.section} key={section.title ?? index}>
              {index > 0 ? <hr /> : null}
              {section.title ? <p className={styles.title}>{section.title}</p> : null}
              {section.items.map((item) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={Boolean(item.selected)}
                  key={item.id}
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.icon ? <span className={styles.icon}>{item.icon}</span> : null}
                  <span className={styles.text}>
                    <span>{item.label}</span>
                    {item.description ? <small>{item.description}</small> : null}
                  </span>
                  {item.selected ? <Check size={14} className={styles.check} /> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
