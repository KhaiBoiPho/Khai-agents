/**
 * A small month picker: the jump target behind the period label and the top
 * of the day view's side rail. Arrow keys move the day, PageUp/PageDown the
 * month, Enter picks — the same keys as the big month grid.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import styles from "./CalendarPage.module.css";
import {
  addDays,
  addMonthsClamped,
  dayOf,
  formatMonthYear,
  formatWeekdayDate,
  monthGridSpan,
  startOfMonth,
  startOfWeek,
  weekdayName,
  weekdayOrder,
  type DateKey,
} from "./dates";

interface MiniMonthProps {
  value: DateKey;
  today: DateKey;
  weekStart: number;
  /** Days that carry something, drawn with a dot. */
  marked?: ReadonlySet<DateKey>;
  onSelect(day: DateKey): void;
  autoFocus?: boolean;
}

export function MiniMonth({ value, today, weekStart, marked, onSelect, autoFocus }: MiniMonthProps) {
  const [month, setMonth] = useState(() => startOfMonth(value));
  const [focusDay, setFocusDay] = useState(value);
  const [shownValue, setShownValue] = useState(value);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const wantsFocus = useRef(Boolean(autoFocus));

  // Follow the outside value (navigating the page moves the picker with it).
  if (shownValue !== value) {
    setShownValue(value);
    setMonth(startOfMonth(value));
    setFocusDay(value);
  }

  useEffect(() => {
    if (!wantsFocus.current) return;
    wantsFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  });

  const { from, weeks } = monthGridSpan(month, weekStart);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(from, i));
  const inGrid = days.includes(focusDay) ? focusDay : month;

  const move = (target: DateKey) => {
    setFocusDay(target);
    if (startOfMonth(target) !== month) setMonth(startOfMonth(target));
    wantsFocus.current = true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, () => DateKey> = {
      ArrowLeft: () => addDays(focusDay, -1),
      ArrowRight: () => addDays(focusDay, 1),
      ArrowUp: () => addDays(focusDay, -7),
      ArrowDown: () => addDays(focusDay, 7),
      Home: () => startOfWeek(focusDay, weekStart),
      End: () => addDays(startOfWeek(focusDay, weekStart), 6),
      PageUp: () => addMonthsClamped(focusDay, -1),
      PageDown: () => addMonthsClamped(focusDay, 1),
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    move(step());
  };

  return (
    <div className={styles.miniMonth}>
      <div className={styles.miniHead}>
        <strong>{formatMonthYear(month)}</strong>
        <button type="button" aria-label="Previous month" onClick={() => setMonth(addMonthsClamped(month, -1))}>
          <ChevronLeft size={14} />
        </button>
        <button type="button" aria-label="Next month" onClick={() => setMonth(addMonthsClamped(month, 1))}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className={styles.miniGrid} role="grid" aria-label={formatMonthYear(month)} ref={gridRef} onKeyDown={onKeyDown}>
        <div role="row" className={styles.miniRow}>
          {weekdayOrder(weekStart).map((weekday) => (
            <span key={weekday} role="columnheader" aria-label={weekdayName(weekday, "long")}>
              {weekdayName(weekday, "narrow")}
            </span>
          ))}
        </div>
        {Array.from({ length: weeks }, (_, week) => (
          <div role="row" className={styles.miniRow} key={week}>
            {days.slice(week * 7, week * 7 + 7).map((day) => (
              <button
                key={day}
                type="button"
                role="gridcell"
                tabIndex={day === inGrid ? 0 : -1}
                className={styles.miniDay}
                data-outside={startOfMonth(day) !== month || undefined}
                data-today={day === today || undefined}
                data-selected={day === value || undefined}
                aria-selected={day === value}
                aria-current={day === today ? "date" : undefined}
                aria-label={formatWeekdayDate(day, true)}
                onClick={() => onSelect(day)}
                onFocus={() => setFocusDay(day)}
              >
                {dayOf(day)}
                {marked?.has(day) ? <i aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
