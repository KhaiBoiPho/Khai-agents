/**
 * The period header: back, the period (which opens a mini month to jump),
 * forward, and "Today" behind the stepper — a reset, not a step, and hidden
 * by visibility only while today is in view so the arrows never shift under
 * the pointer (Yuvomi PR #1200). Then the view switch, search, filters and
 * the one primary action.
 *
 * Shortcuts follow Google Calendar, as Yuvomi's do: t today, k/j back and
 * forward, m/w/d/a the view, n new event, / search.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { ChevronDown, ChevronLeft, ChevronRight, Plus, Search, SlidersHorizontal } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import styles from "./CalendarPage.module.css";
import type { DateKey } from "./dates";
import type { CalendarView } from "./eventStore";
import { MiniMonth } from "./MiniMonth";
import { Popover } from "./Popover";
import { rectOf, type AnchorRect } from "./visuals";

const VIEW_LABELS: Record<CalendarView, string> = {
  month: "Month",
  week: "Week",
  day: "Day",
  agenda: "Agenda",
};
const VIEW_KEYS: Record<CalendarView, string> = { month: "m", week: "w", day: "d", agenda: "a" };
const VIEWS = Object.keys(VIEW_LABELS) as CalendarView[];

interface CalendarToolbarProps {
  view: CalendarView;
  label: string;
  prevLabel: string;
  nextLabel: string;
  todayInView: boolean;
  cursor: DateKey;
  today: DateKey;
  weekStart: number;
  filterCount: number;
  filtersOpen: boolean;
  searchOpen: boolean;
  onPrev(): void;
  onNext(): void;
  onToday(): void;
  onJump(day: DateKey): void;
  onView(view: CalendarView): void;
  onToggleFilters(anchor: HTMLElement): void;
  onToggleSearch(): void;
  onCreate(): void;
}

export function CalendarToolbar(props: CalendarToolbarProps) {
  const { view, label, filterCount, filtersOpen, searchOpen } = props;
  const [jump, setJump] = useState<{ rect: AnchorRect | null; trigger: HTMLElement } | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = VIEWS.indexOf(view);
    const next =
      event.key === "ArrowRight" ? VIEWS[(index + 1) % VIEWS.length]
        : event.key === "ArrowLeft" ? VIEWS[(index + VIEWS.length - 1) % VIEWS.length]
          : event.key === "Home" ? VIEWS[0]
            : event.key === "End" ? VIEWS[VIEWS.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    props.onView(next);
    tabsRef.current?.querySelector<HTMLElement>(`[data-view="${next}"]`)?.focus();
  };

  return (
    <div className={styles.toolbar}>
      <div className={styles.stepper}>
        <button
          type="button"
          className={styles.stepButton}
          aria-label={props.prevLabel}
          title={`${props.prevLabel} (k)`}
          aria-keyshortcuts="k"
          onClick={props.onPrev}
        >
          <ChevronLeft size={16} />
        </button>
        <h2 className={styles.periodHeading}>
          <button
            type="button"
            id="cal-period-label"
            className={styles.periodLabel}
            aria-haspopup="dialog"
            aria-expanded={Boolean(jump)}
            aria-live="polite"
            onClick={(event) => {
              const trigger = event.currentTarget;
              setJump((open) => (open ? null : { rect: rectOf(trigger), trigger }));
            }}
          >
            {label}
            <ChevronDown size={13} aria-hidden="true" />
          </button>
        </h2>
        <button
          type="button"
          className={styles.stepButton}
          aria-label={props.nextLabel}
          title={`${props.nextLabel} (j)`}
          aria-keyshortcuts="j"
          onClick={props.onNext}
        >
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          className={styles.todayButton}
          data-current={props.todayInView || undefined}
          inert={props.todayInView || undefined}
          aria-keyshortcuts="t"
          title="Today (t)"
          onClick={props.onToday}
        >
          Today
        </button>
      </div>

      <div className={styles.viewTabs} role="tablist" aria-label="View" ref={tabsRef} onKeyDown={onTabKey}>
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            id={`cal-tab-${v}`}
            data-view={v}
            aria-selected={v === view}
            aria-controls={v === view ? "cal-body" : undefined}
            tabIndex={v === view ? 0 : -1}
            aria-keyshortcuts={VIEW_KEYS[v]}
            title={`${VIEW_LABELS[v]} (${VIEW_KEYS[v]})`}
            onClick={() => props.onView(v)}
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>

      <div className={styles.tools}>
        <button
          type="button"
          className={styles.toolButton}
          aria-label="Search events"
          title="Search events (/)"
          aria-keyshortcuts="/"
          aria-expanded={searchOpen}
          aria-controls={searchOpen ? "cal-search" : undefined}
          data-active={searchOpen || undefined}
          onClick={props.onToggleSearch}
        >
          <Search size={15} />
        </button>
        <button
          type="button"
          className={styles.toolButton}
          aria-label={filterCount ? `Filters, ${filterCount} active` : "Open filters"}
          title="Filters"
          aria-expanded={filtersOpen}
          aria-haspopup="dialog"
          data-active={filtersOpen || undefined}
          onClick={(event) => props.onToggleFilters(event.currentTarget)}
        >
          <SlidersHorizontal size={15} />
          {filterCount ? <span className={styles.badge}>{filterCount}</span> : null}
        </button>
        <button type="button" className={styles.primaryButton} onClick={props.onCreate} aria-keyshortcuts="n" title="New event (n)">
          <Plus size={15} /> New event
        </button>
      </div>

      {jump ? (
        <Popover
          anchor={jump.rect}
          side="below"
          width={260}
          label="Jump to date"
          onClose={() => setJump(null)}
          trigger={jump.trigger}
          returnFocus={jump.trigger}
        >
          <MiniMonth
            value={props.cursor}
            today={props.today}
            weekStart={props.weekStart}
            autoFocus
            onSelect={(day) => {
              setJump(null);
              props.onJump(day);
            }}
          />
        </Popover>
      ) : null}
    </div>
  );
}
