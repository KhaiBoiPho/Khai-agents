import { Bot, X } from "lucide-react";
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";

import { Dropdown } from "../../../../components/Dropdown";
import { initials, MEMBERS, memberById } from "../../shared/members";
import { cx, memberName } from "../labels";
import { shiftColor, type ShiftType } from "../model";
import styles from "../SchedulePage.module.css";

export function Avatar({ memberId, size = 22 }: { memberId: string; size?: number }) {
  const member = memberById(memberId);
  const name = member?.name ?? memberId;
  return (
    <span
      className={styles.avatar}
      style={{ "--avatar": member?.color ?? "var(--text-tertiary)", width: size, height: size } as CSSProperties}
      title={name}
      aria-hidden="true"
    >
      {member?.isAgent ? <Bot size={Math.round(size * 0.6)} /> : initials(name)}
    </span>
  );
}

export function Swatch({ type }: { type: ShiftType | null }) {
  return (
    <span
      className={cx(styles.swatch, !type && styles.swatchFree)}
      style={{ "--shift": type ? shiftColor(type.color) : "var(--border-emphasis)" } as CSSProperties}
      aria-hidden="true"
    />
  );
}

/** Compact coloured code, e.g. "OC"; a hatched dash for a free day. */
export function ShiftCode({ type, title }: { type: ShiftType | null; title?: string }) {
  return (
    <span
      className={cx(styles.code, !type && styles.codeFree)}
      style={type ? ({ "--shift": shiftColor(type.color) } as CSSProperties) : undefined}
      title={title}
    >
      {type ? type.shortCode || type.name.slice(0, 2) : "–"}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>{icon}</span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function MemberPicker({
  value,
  onChange,
  label = "Owner",
}: {
  value: string;
  onChange(memberId: string): void;
  label?: string;
}) {
  return (
    <Dropdown
      triggerLabel={`${label}: ${memberName(value)}`}
      trigger={
        <>
          <Avatar memberId={value} size={18} />
          {memberName(value)}
        </>
      }
      sections={[
        {
          items: MEMBERS.map((member) => ({
            id: member.id,
            label: member.name,
            icon: <Avatar memberId={member.id} size={18} />,
            selected: member.id === value,
            onSelect: () => onChange(member.id),
          })),
        },
      ]}
    />
  );
}

export function TypePicker({
  types,
  value,
  onChange,
  allowFree,
  label = "Shift type",
}: {
  types: readonly ShiftType[];
  value: string | null;
  onChange(id: string | null): void;
  allowFree: boolean;
  label?: string;
}) {
  const current = types.find((type) => type.id === value) ?? null;
  const items = [
    ...(allowFree
      ? [{ id: "__free", label: "Free day", icon: <Swatch type={null} />, selected: value === null, onSelect: () => onChange(null) }]
      : []),
    ...types.map((type) => ({
      id: type.id,
      label: type.shortCode ? `${type.shortCode} · ${type.name}` : type.name,
      description: type.start ? `${type.start}–${type.end}` : "All day",
      icon: <Swatch type={type} />,
      selected: type.id === value,
      onSelect: () => onChange(type.id),
    })),
  ];
  return (
    <Dropdown
      triggerLabel={label}
      triggerClassName={styles.typeTrigger}
      trigger={
        <>
          <Swatch type={current} />
          <span>{current ? (current.shortCode ? `${current.shortCode} · ${current.name}` : current.name) : allowFree ? "Free day" : "Choose…"}</span>
        </>
      }
      sections={[{ items }]}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly (readonly [NoInfer<T>, string])[];
  onChange(value: NoInfer<T>): void;
  label: string;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button key={key} type="button" aria-pressed={key === value} onClick={() => onChange(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint ? <small className={styles.fieldHint}>{hint}</small> : null}
    </label>
  );
}

/** Group label for controls that are not a single labelable element. */
export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className={styles.field} role="group" aria-labelledby={id}>
      <span className={styles.fieldLabel} id={id}>
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * A modal panel. Not a native <dialog>: the shared Dropdown portals its menu
 * to <body>, which a top-layer dialog would cover and make inert.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  size = "md",
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md";
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>("input, textarea, [data-autofocus]");
    (first ?? panelRef.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      // An open dropdown menu handles its own Escape first (capture phase).
      if (event.key === "Escape" && !event.defaultPrevented) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className={cx(styles.modal, size === "sm" && styles.modalSmall)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={styles.modalHead}>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className={styles.iconButton} aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className={styles.modalBody}>{children}</div>
        {footer ? <footer className={styles.modalFoot}>{footer}</footer> : null}
      </div>
    </div>
  );
}
