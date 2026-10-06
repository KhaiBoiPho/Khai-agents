/**
 * The month grid.
 *
 * One ARIA grid with one tab stop: arrows move the day, Home/End the week
 * edges, PageUp/PageDown the month (day clamped, 31 Jan → 28 Feb), Enter opens
 * the day. Multi-day events are one band per week row, not a chip per cell;
 * how many lanes and chips stay visible is decided per row from the real cell
 * height, with the last line kept for "+N more" (Yuvomi's fitMonthDayCells).
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";

import styles from "./CalendarPage.module.css";
import {
  addDays,
  addMonthsClamped,
  dayOf,
  formatDayMonth,
  formatWeekdayDate,
  isWeekend,
  monthGridSpan,
  startOfMonth,
  startOfWeek,
  weekdayName,
  weekdayOrder,
  type DateKey,
} from "./dates";
import { bandSegments, fitMonthRow } from "./layout";
import type { Occurrence } from "./model";
import { Glyphs } from "./parts";
import { positionText } from "./text";
import type { ViewProps } from "./viewTypes";
import { colorStyle } from "./visuals";

/**
 * Must match the stylesheet: a chip line is 18px plus a 2px gap, and chips
 * start 27px down the cell (3px padding, 22px day number, 2px gap).
 */
const LINE_PX = 20;
const HEAD_PX = 27;
const PAD_PX = 2;

export function MonthView({ cursor, today, weekStart, itemsOn, selectedKey, actions }: ViewProps) {
  const { from, weeks } = monthGridSpan(cursor, weekStart);
  const month = startOfMonth(cursor);
  const days = useMemo(() => Array.from({ length: weeks * 7 }, (_, i) => addDays(from, i)), [from, weeks]);

  const [slots, setSlots] = useState(4);
  const gridRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const cell = grid.querySelector<HTMLElement>("[data-cell]");
      if (!cell) return;
      setSlots(Math.max(1, Math.floor((cell.clientHeight - HEAD_PX - PAD_PX) / LINE_PX)));
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  const [focusDay, setFocusDay] = useState<DateKey>(cursor);
  const rovingDay = days.includes(focusDay) ? focusDay : days.includes(cursor) ? cursor : month;
  const wantsFocus = useRef(false);
  useEffect(() => {
    if (!wantsFocus.current) return;
    wantsFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${rovingDay}"]`)?.focus();
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-cell]");
    if (!cell || event.target !== cell || event.altKey || event.ctrlKey || event.metaKey) return;
    const day = cell.dataset.cell!;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      actions.openDay(day);
      return;
    }
    const rtl = document.documentElement.dir === "rtl";
    const targets: Record<string, () => DateKey> = {
      ArrowLeft: () => addDays(day, rtl ? 1 : -1),
      ArrowRight: () => addDays(day, rtl ? -1 : 1),
      ArrowUp: () => addDays(day, -7),
      ArrowDown: () => addDays(day, 7),
      Home: () => startOfWeek(day, weekStart),
      End: () => addDays(startOfWeek(day, weekStart), 6),
      PageUp: () => addMonthsClamped(day, -1),
      PageDown: () => addMonthsClamped(day, 1),
    };
    const target = targets[event.key]?.();
    if (!target) return;
    event.preventDefault();
    setFocusDay(target);
    wantsFocus.current = true;
    // PageUp/PageDown always change the month, even when the target already
    // shows as a neighbour-month day in the last row.
    if (!days.includes(target) || event.key === "PageUp" || event.key === "PageDown") actions.jumpTo(target);
  };

  const [dropDay, setDropDay] = useState<DateKey | null>(null);
  const dragged = useRef<Occurrence | null>(null);
  const dropProps = (day: DateKey) => ({
    onDragOver: (event: DragEvent) => {
      if (!dragged.current) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dropDay !== day) setDropDay(day);
    },
    onDragLeave: () => setDropDay((current) => (current === day ? null : current)),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDropDay(null);
      if (dragged.current) actions.move(dragged.current, day);
      dragged.current = null;
    },
  });
  const dragProps = (occurrence: Occurrence) =>
    occurrence.layer === "event" && !occurrence.recurring
      ? {
          draggable: true,
          onDragStart: (event: DragEvent) => {
            dragged.current = occurrence;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", occurrence.event.title);
          },
          onDragEnd: () => {
            dragged.current = null;
            setDropDay(null);
          },
        }
      : {};

  return (
    <div className={styles.month} role="grid" aria-label="Month" style={{ ["--weeks" as string]: weeks }}>
      <div className={styles.monthWeekdays} role="row">
        {weekdayOrder(weekStart).map((weekday) => (
          <div key={weekday} role="columnheader" aria-label={weekdayName(weekday, "long")}>
            {weekdayName(weekday)}
          </div>
        ))}
      </div>
      <div className={styles.monthGrid} ref={gridRef} role="rowgroup" onKeyDown={onKeyDown}>
        {Array.from({ length: weeks }, (_, week) => {
          const rowDays = days.slice(week * 7, week * 7 + 7);
          const items = rowDays.map((day) => itemsOn(day));
          const unique = new Map<string, Occurrence>();
          for (const dayItems of items) for (const o of dayItems.occurrences) unique.set(o.key, o);
          const band = bandSegments(rowDays, [...unique.values()]);
          const chipLists = items.map((dayItems) => ({
            layers: dayItems.occurrences.filter((o) => o.layer !== "event" && !band.keys.has(o.key)),
            events: dayItems.occurrences.filter((o) => o.layer === "event" && !band.keys.has(o.key)),
            schedule: dayItems.schedule,
            tasks: dayItems.tasks,
          }));
          const fit = fitMonthRow(
            chipLists.map((list, column) => ({
              chips: list.layers.length + list.schedule.length + list.events.length + list.tasks.length,
              bandLanes: band.bands.filter((b) => b.first <= column && column <= b.last).map((b) => b.lane),
              depth: band.depth[column] ?? 0,
            })),
            band.laneCount,
            slots,
          );
          return (
            <div className={styles.monthRow} role="row" key={rowDays[0]}>
              {rowDays.map((day, column) => {
                const list = chipLists[column]!;
                const cellFit = fit.cells[column]!;
                const total =
                  list.layers.length + list.schedule.length + list.tasks.length + items[column]!.occurrences.filter((o) => o.layer === "event").length;
                const titles = [
                  ...list.layers.map((o) => o.event.title),
                  ...list.schedule.map((s) => s.label),
                  ...items[column]!.occurrences.filter((o) => o.layer === "event").map((o) => {
                    const position = positionText(o, day);
                    return position ? `${o.event.title} (${position})` : o.event.title;
                  }),
                  ...list.tasks.map((t) => t.title),
                ];
                const named = titles.slice(0, 3);
                const label = [
                  formatWeekdayDate(day, true),
                  day === today ? "Today" : "",
                  total ? `${total} ${total === 1 ? "entry" : "entries"}: ${named.join(", ")}${total > named.length ? ` and ${total - named.length} more` : ""}` : "",
                ]
                  .filter(Boolean)
                  .join(", ");
                let budget = cellFit.visibleChips;
                const take = <T,>(arr: T[]): T[] => {
                  const shown = arr.slice(0, Math.max(0, budget));
                  budget -= shown.length;
                  return shown;
                };
                const occupied = Math.min(band.depth[column] ?? 0, fit.lanesShown);
                return (
                  <div
                    key={day}
                    data-cell={day}
                    role="gridcell"
                    tabIndex={day === rovingDay ? 0 : -1}
                    aria-label={label}
                    aria-current={day === today ? "date" : undefined}
                    className={styles.monthCell}
                    data-outside={startOfMonth(day) !== month || undefined}
                    data-weekend={isWeekend(day) || undefined}
                    data-today={day === today || undefined}
                    data-drop={dropDay === day || undefined}
                    onClick={() => actions.openDay(day)}
                    onFocus={() => setFocusDay(day)}
                    {...dropProps(day)}
                  >
                    <div className={styles.monthCellHead}>
                      <span className={styles.monthNumber}>{dayOf(day) === 1 ? formatDayMonth(day) : dayOf(day)}</span>
                      <button
                        type="button"
                        tabIndex={-1}
                        className={styles.cellAdd}
                        aria-label={`Add event on ${formatWeekdayDate(day, true)}`}
                        title="Add event"
                        onClick={(event) => {
                          event.stopPropagation();
                          actions.create(day);
                        }}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    {occupied ? <div className={styles.laneSpacer} style={{ height: occupied * LINE_PX - 2 }} aria-hidden="true" /> : null}
                    {take(list.layers).map((o) => (
                      <div
                        key={o.key}
                        className={styles.monthChip}
                        data-layer={o.layer}
                        style={colorStyle(o)}
                        title={o.event.title}
                        onClick={(event) => {
                          event.stopPropagation();
                          actions.openOccurrence(o, event.currentTarget, day);
                        }}
                      >
                        <Glyphs occurrence={o} size={11} />
                        <span>{o.event.title}</span>
                      </div>
                    ))}
                    {take(list.schedule).map((entry) => (
                      <div
                        key={entry.id}
                        className={styles.monthChip}
                        data-layer="schedule"
                        style={{ ["--ev" as string]: entry.color }}
                        title={entry.label}
                        onClick={(event) => {
                          event.stopPropagation();
                          actions.openSchedule(entry, event.currentTarget);
                        }}
                      >
                        <span>{entry.label}</span>
                      </div>
                    ))}
                    {take(list.events).map((o) => (
                      <div
                        key={o.key}
                        className={styles.monthChip}
                        data-selected={selectedKey === o.key || undefined}
                        data-timed={!o.allDay || undefined}
                        style={colorStyle(o)}
                        title={o.event.title}
                        onClick={(event) => {
                          event.stopPropagation();
                          actions.openOccurrence(o, event.currentTarget, day);
                        }}
                        {...dragProps(o)}
                      >
                        <Glyphs occurrence={o} size={11} />
                        {!o.allDay && o.start.slice(0, 10) === day ? <time>{o.start.slice(11, 16)}</time> : null}
                        <span>{o.event.title}</span>
                      </div>
                    ))}
                    {take(list.tasks).map((task) => (
                      <div
                        key={task.id}
                        className={styles.taskChip}
                        data-priority={task.priority}
                        title={task.title}
                        onClick={(event) => {
                          event.stopPropagation();
                          actions.openTask(task, event.currentTarget);
                        }}
                      >
                        <span className={styles.taskBox} aria-hidden="true" />
                        <span>{task.title}</span>
                      </div>
                    ))}
                    {cellFit.more > 0 ? (
                      <button
                        type="button"
                        tabIndex={-1}
                        className={styles.more}
                        onClick={(event) => {
                          event.stopPropagation();
                          actions.showMore(day, event.currentTarget);
                        }}
                      >
                        +{cellFit.more} more
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {band.bands.length ? (
                <div className={styles.monthBands} aria-hidden="true">
                  {band.bands.map((b) => (
                    <div
                      key={b.occurrence.key}
                      className={styles.band}
                      data-before={b.continuesBefore || undefined}
                      data-after={b.continuesAfter || undefined}
                      data-hidden={b.lane >= fit.lanesShown || undefined}
                      data-selected={selectedKey === b.occurrence.key || undefined}
                      style={colorStyle(b.occurrence, {
                        gridColumn: `${b.first + 1} / span ${b.last - b.first + 1}`,
                        gridRow: b.lane + 1,
                      } as CSSProperties)}
                      title={b.occurrence.event.title}
                      onClick={(event) => actions.openOccurrence(b.occurrence, event.currentTarget, rowDays[b.first])}
                    >
                      {b.continuesBefore ? <ChevronLeft size={11} className={styles.bandCont} /> : null}
                      <Glyphs occurrence={b.occurrence} size={11} />
                      <span>{b.occurrence.event.title}</span>
                      {b.continuesAfter ? <ChevronRight size={11} className={styles.bandCont} /> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

