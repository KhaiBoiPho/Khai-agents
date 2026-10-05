import { ChevronDown } from "lucide-react";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { Dropdown, type DropdownSection } from "./Dropdown";
import styles from "./Select.module.css";

/** The slice of a change event the converted call sites read. */
export interface SelectChange {
  target: { value: string };
  currentTarget: { value: string };
}

interface SelectProps {
  value?: string | number | readonly string[];
  onChange?: (event: SelectChange) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  title?: string;
  "aria-label"?: string;
  /** "plain" reads as text with a chevron; "boxed" is a bordered field. */
  variant?: "boxed" | "plain";
  children?: ReactNode;
  // Accepted for drop-in compatibility with <select>; not used.
  required?: boolean;
  name?: string;
}

interface Option {
  value: string;
  label: ReactNode;
  disabled: boolean;
}

/**
 * Drop-in replacement for a native <select>: it reads the same <option> and
 * <optgroup> children and reports changes as `event.target.value`, but opens
 * a styled menu instead of the operating system's list.
 */
export function Select({
  value,
  onChange,
  disabled,
  id,
  className,
  title,
  variant = "boxed",
  children,
  ...rest
}: SelectProps) {
  const sections = collect(children);
  const current = value === undefined ? "" : String(value);
  const options = sections.flatMap((section) => section.options);
  const selected =
    options.find((option) => option.value === current) ?? options[0] ?? null;

  const menu: DropdownSection[] = sections.map((section) => ({
    title: section.title,
    items: section.options.map((option) => ({
      id: option.value || "__empty__",
      label: option.label,
      disabled: option.disabled,
      selected: option.value === current,
      onSelect: () =>
        onChange?.({
          target: { value: option.value },
          currentTarget: { value: option.value },
        }),
    })),
  }));

  return (
    <Dropdown
      id={id}
      triggerClassName={[
        styles.trigger,
        variant === "plain" ? styles.plain : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      triggerLabel={rest["aria-label"]}
      title={title}
      disabled={disabled}
      sections={menu}
      trigger={
        <span className={styles.inner} data-variant={variant}>
          <span className={styles.label}>{selected?.label ?? ""}</span>
          <ChevronDown size={14} className={styles.chevron} />
        </span>
      }
    />
  );
}

function collect(children: ReactNode): Array<{ title?: string; options: Option[] }> {
  const loose: Option[] = [];
  const groups: Array<{ title?: string; options: Option[] }> = [];
  const visit = (node: ReactNode, into: Option[]) => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      const element = child as ReactElement<{
        value?: string | number;
        disabled?: boolean;
        label?: string;
        children?: ReactNode;
      }>;
      if (element.type === "option") {
        const label = element.props.children;
        into.push({
          value:
            element.props.value === undefined
              ? textOf(label)
              : String(element.props.value),
          label,
          disabled: Boolean(element.props.disabled),
        });
      } else if (element.type === "optgroup") {
        const options: Option[] = [];
        visit(element.props.children, options);
        groups.push({ title: element.props.label, options });
      } else {
        // Fragments and wrapper components that only group options.
        visit(element.props.children, into);
      }
    });
  };
  visit(children, loose);
  return loose.length ? [{ options: loose }, ...groups] : groups;
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return "";
}
