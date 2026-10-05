/**
 * Building blocks for settings pages in the desktop-app style: titled groups
 * of hairline rows with the control on the right, segmented choices,
 * switches, usage bars, tables and page headers with tabs.
 */

import { Search } from "lucide-react";
import type { ReactNode } from "react";

import styles from "./SettingsUI.module.css";

export function Page({ children }: { children: ReactNode }) {
  return <div className={styles.page}>{children}</div>;
}

export function Group({
  title,
  aside,
  description,
  children,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className={styles.group}>
      {title || aside ? (
        <header className={styles.groupHeader}>
          {title ? <h3>{title}</h3> : <span />}
          {aside}
        </header>
      ) : null}
      {description ? <p className={styles.groupDescription}>{description}</p> : null}
      {children}
    </section>
  );
}

export function Row({
  label,
  description,
  children,
  stacked,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Put the control under the text instead of beside it. */
  stacked?: boolean;
}) {
  return (
    <div className={styles.row} data-stacked={stacked || undefined}>
      <div className={styles.rowText}>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </div>
      {children !== undefined ? <div className={styles.rowControl}>{children}</div> : null}
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label?: ReactNode;
  icon?: ReactNode;
  title?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly SegmentOption<T>[];
  onChange(value: T): void;
  label: string;
}) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          role="radio"
          key={option.value}
          aria-checked={option.value === value}
          title={option.title}
          aria-label={option.title}
          data-icon={option.icon && !option.label ? true : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={styles.toggle}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={styles.button}
      data-variant={variant}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function Bar({ value }: { value: number }) {
  return (
    <div className={styles.bar} aria-hidden="true">
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

/** A labelled usage meter: text on the left, bar in the middle, figure right. */
export function Meter({
  label,
  detail,
  value,
  figure,
}: {
  label: ReactNode;
  detail?: ReactNode;
  value: number;
  figure: ReactNode;
}) {
  return (
    <div className={styles.meter}>
      <div className={styles.rowText}>
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
      <Bar value={value} />
      <span className={styles.meterFigure}>{figure}</span>
    </div>
  );
}

export function Table({
  columns,
  rows,
  empty,
}: {
  columns: Array<{ label: ReactNode; align?: "start" | "end"; width?: string }>;
  rows: ReactNode[][];
  empty?: ReactNode;
}) {
  const template = columns.map((column) => column.width ?? "1fr").join(" ");
  return (
    <div className={styles.table} role="table">
      <div className={styles.tableHead} role="row" style={{ gridTemplateColumns: template }}>
        {columns.map((column, index) => (
          <span key={index} role="columnheader" data-align={column.align}>
            {column.label}
          </span>
        ))}
      </div>
      {rows.length ? (
        rows.map((cells, rowIndex) => (
          <div
            className={styles.tableRow}
            role="row"
            key={rowIndex}
            style={{ gridTemplateColumns: template }}
          >
            {cells.map((cell, index) => (
              <span key={index} role="cell" data-align={columns[index]?.align}>
                {cell}
              </span>
            ))}
          </div>
        ))
      ) : (
        <p className={styles.tableEmpty}>{empty}</p>
      )}
    </div>
  );
}

export function Banner({
  title,
  text,
  action,
  art,
}: {
  title: ReactNode;
  text: ReactNode;
  action?: ReactNode;
  art?: ReactNode;
}) {
  return (
    <div className={styles.banner}>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
        {action}
      </div>
      {art ? <div className={styles.bannerArt}>{art}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  tabs,
  tab,
  onTab,
  search,
  onSearch,
  searchPlaceholder = "Search",
  actions,
}: {
  title: ReactNode;
  tabs?: readonly string[];
  tab?: string;
  onTab?: (tab: string) => void;
  search?: string;
  onSearch?: (value: string) => void;
  searchPlaceholder?: string;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <h2>{title}</h2>
      {tabs ? (
        <div className={styles.tabs} role="tablist">
          {tabs.map((name) => (
            <button
              type="button"
              role="tab"
              key={name}
              aria-selected={name === tab}
              onClick={() => onTab?.(name)}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.pageActions}>
        {onSearch ? (
          <label className={styles.search}>
            <Search size={14} />
            <input
              value={search ?? ""}
              onChange={(event) => onSearch(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
          </label>
        ) : null}
        {actions}
      </div>
    </header>
  );
}

export function ListItem({
  icon,
  title,
  meta,
  aside,
  onClick,
}: {
  icon: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className={styles.listItem} onClick={onClick} data-clickable={onClick ? true : undefined}>
      <span className={styles.listIcon}>{icon}</span>
      <span className={styles.listText}>
        <strong>{title}</strong>
        {meta ? <small>{meta}</small> : null}
      </span>
      {aside ? <span className={styles.listAside}>{aside}</span> : null}
    </div>
  );
}

export function Count({ children }: { children: ReactNode }) {
  return <span className={styles.count}>{children}</span>;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className={styles.badge}>{children}</span>;
}

export function TextInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  label: string;
}) {
  return (
    <input
      className={styles.input}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={label}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  label: string;
}) {
  return (
    <textarea
      className={styles.textarea}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={label}
      rows={4}
    />
  );
}
