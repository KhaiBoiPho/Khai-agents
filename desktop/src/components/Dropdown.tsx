import { Check } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

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
  id?: string;
  /** Preferred direction; the menu flips when there is no room. */
  placement?: "up" | "down";
  align?: "start" | "end";
}

const GAP = 6;
const MENU_MAX_HEIGHT = 360;

/**
 * Styled replacement for a native select: a button that opens a menu of
 * titled sections, with a check on the selected entry. The menu renders in
 * a portal with fixed positioning, so scrolling containers never clip it.
 */
export function Dropdown({
  trigger,
  sections,
  triggerClassName,
  triggerLabel,
  title,
  disabled,
  id,
  placement = "down",
  align = "start",
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    const up =
      placement === "up"
        ? above > 160 || above > below
        : below < Math.min(MENU_MAX_HEIGHT, 220) && above > below;
    const style: CSSProperties = {
      position: "fixed",
      minWidth: Math.max(rect.width, 190),
      maxHeight: Math.min(MENU_MAX_HEIGHT, (up ? above : below) - GAP * 2),
    };
    if (up) style.bottom = window.innerHeight - rect.top + GAP;
    else style.top = rect.bottom + GAP;
    // Right-hand controls open toward the left so the menu stays on screen.
    if (align === "end" || rect.left > window.innerWidth / 2)
      style.right = window.innerWidth - rect.right;
    else style.left = rect.left;
    setPosition(style);
  }, [align, placement]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    const reposition = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const visible = sections.filter((section) => section.items.length > 0);
  return (
    <>
      <button
        ref={triggerRef}
        id={id}
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
      {open
        ? createPortal(
            <div ref={menuRef} className={styles.menu} style={position} role="menu">
              {visible.map((section, index) => (
                <div className={styles.section} key={section.title ?? index}>
                  {index > 0 ? <hr /> : null}
                  {section.title ? (
                    <p className={styles.title}>{section.title}</p>
                  ) : null}
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
                      {item.icon ? (
                        <span className={styles.icon}>{item.icon}</span>
                      ) : null}
                      <span className={styles.text}>
                        <span>{item.label}</span>
                        {item.description ? <small>{item.description}</small> : null}
                      </span>
                      {item.selected ? (
                        <Check size={14} className={styles.check} />
                      ) : null}
                    </button>
                  ))}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
