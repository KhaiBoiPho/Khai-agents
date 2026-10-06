/**
 * Week and day views: an all-day row with bands across days, then a 24-hour
 * grid. Overlapping blocks share a column; a block that crosses midnight
 * appears clamped in both columns (#1313).
 *
 * Creating follows Apple's split that Yuvomi adopted (R17 Z2): a single click
 * on empty time does nothing but close what is open; a double-click (mouse)
 * or a 500 ms press (touch, pen) creates at the half hour under the pointer,
 * with a placeholder showing the coming start while the press arms.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import type { ScheduleOccurrence } from "../schedule/calendarFeed";
import { AgendaDay } from "./AgendaView";
import styles from "./CalendarPage.module.css";
import {
  addDays,
  dayOf,
  formatClock,
  formatHour,
  formatWeekdayDate,
  minutesToTime,
  timeToMinutes,
  weekdayName,
  weekdayOf,
  type DateKey,
} from "./dates";
import { assignColumns, bandSegments, isAllDayLike, timeRange, type LanePlacement, type MinuteRange } from "./layout";
import { MiniMonth } from "./MiniMonth";
import type { Occurrence } from "./model";
import { Avatars, Glyphs } from "./parts";
import { RAIL_SPAN } from "./periods";
import { occurrenceTimeText, positionText } from "./text";
import type { ViewProps } from "./viewTypes";
import { colorStyle, occurrenceLabel } from "./visuals";

const PRESS_MS = 500;
const PRESS_SLOP = 10;

interface TimeGridProps extends ViewProps {
  days: DateKey[];
  mode: "week" | "day";
}

function scheduleRange(entry: ScheduleOccurrence): MinuteRange {
  const start = timeToMinutes(entry.start);
  const end = timeToMinutes(entry.end);
  // An end at or before the start is a night shift running to midnight here.
  return { start, end: Math.max((end > start ? end : 24 * 60), start + 30) };
}

const hasTimes = (entry: ScheduleOccurrence) => Boolean(entry.start && entry.end && entry.start !== entry.end);

function placement(range: MinuteRange, lane: LanePlacement | undefined, inset: { left: number; total: number }): CSSProperties {
  const columns = lane?.columns ?? 1;
  const column = lane?.column ?? 0;
  return {
    top: `calc(var(--hour) * ${range.start / 60})`,
    height: `calc(var(--hour) * ${(range.end - range.start) / 60} - 2px)`,
    left: `calc(${(column / columns) * 100}% + ${inset.left}px)`,
    width: `calc(${100 / columns}% - ${inset.total}px)`,
  };
}

export function TimeGridView(props: TimeGridProps) {
  const { days, mode, today, nowMinutes, scheduleDisplay, itemsOn, selectedKey, actions } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Open on the current hour (08:00 on other days), measured from the grid
  // itself rather than a second hour height in code.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const body = bodyRef.current;
    if (!scroller || !body) return;
    const hourPx = body.offsetHeight / 24;
    const hour = days.includes(today) ? Math.floor(nowMinutes / 60) : 8;
    scroller.scrollTop = Math.max(0, hour * hourPx - 80);
    // Only on entering the view; navigating keeps the reading position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const [ghost, setGhost] = useState<{ day: DateKey; time: string; armed: boolean } | null>(null);
  const press = useRef<{ x: number; y: number; timer: number; day: DateKey; time: string; armed: boolean } | null>(null);
  const released = useRef(false);

  const slotAt = (event: { clientY: number; target: EventTarget }, column: HTMLElement) => {
    if ((event.target as HTMLElement).closest("[data-block]")) return null;
    const rect = column.getBoundingClientRect();
    const hourPx = column.offsetHeight / 24;
    if (!hourPx) return "09:00";
    const minutes = Math.round((((event.clientY - rect.top) / hourPx) * 60) / 30) * 30;
    return minutesToTime(Math.min(Math.max(minutes, 0), 23 * 60 + 30));
  };

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    setGhost(null);
  };

  const columnHandlers = (day: DateKey) => ({
    onDoubleClick: (event: MouseEvent<HTMLDivElement>) => {
      const time = slotAt(event, event.currentTarget);
      if (time) actions.create(day, time);
    },
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      cancelPress();
      released.current = false;
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      const time = slotAt(event, event.currentTarget);
      if (!time) return;
      const timer = window.setTimeout(() => {
        if (!press.current) return;
        press.current.armed = true;
        setGhost({ day, time, armed: true });
        navigator.vibrate?.(15);
      }, PRESS_MS);
      press.current = { x: event.clientX, y: event.clientY, timer, day, time, armed: false };
      setGhost({ day, time, armed: false });
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const current = press.current;
      if (current && Math.hypot(event.clientX - current.x, event.clientY - current.y) > PRESS_SLOP) cancelPress();
    },
    onPointerUp: () => {
      const current = press.current;
      cancelPress();
      if (current?.armed) {
        released.current = true;
        actions.create(current.day, current.time);
      }
    },
    onPointerCancel: cancelPress,
    onContextMenu: (event: MouseEvent) => {
      if (press.current) event.preventDefault();
    },
  });

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target as HTMLElement;
    if (target.getAttribute("role") !== "button" || target.tagName === "BUTTON") return;
    event.preventDefault();
    target.click();
  };

  const dayItems = days.map((day) => itemsOn(day));
  const unique = new Map<string, Occurrence>();
  for (const items of dayItems) for (const o of items.occurrences) unique.set(o.key, o);
  const band = bandSegments(days, [...unique.values()]);
  const columns = `var(--gutter) repeat(${days.length}, minmax(0, 1fr))`;

  const allDayCells = dayItems.map((items) => ({
    layers: items.occurrences.filter((o) => o.layer !== "event"),
    events: items.occurrences.filter((o) => o.layer === "event" && isAllDayLike(o) && !band.keys.has(o.key)),
    schedule: scheduleDisplay === "compact" ? items.schedule : items.schedule.filter((s) => !hasTimes(s)),
    tasks: items.tasks,
  }));
  const allDayEmpty =
    !band.bands.length &&
    allDayCells.every((cell) => !cell.layers.length && !cell.events.length && !cell.schedule.length && !cell.tasks.length);
  const nothingAtAll = allDayEmpty && dayItems.every((items) => !items.occurrences.length && !items.schedule.length);

  const grid = (
    <div className={styles.timeGrid} data-mode={mode} style={{ ["--cols" as string]: days.length }} onKeyDown={onKeyDown}>
      <div className={styles.tgHead} style={{ gridTemplateColumns: columns }}>
        <div />
        {days.map((day) => (
          <div
            key={day}
            className={styles.tgDayHead}
            data-today={day === today || undefined}
            role={mode === "week" ? "button" : undefined}
            tabIndex={mode === "week" ? 0 : undefined}
            aria-label={mode === "week" ? `Open day view for ${formatWeekdayDate(day, true)}` : undefined}
            aria-current={day === today ? "date" : undefined}
            onClick={mode === "week" ? () => actions.openDay(day) : undefined}
          >
            <span>{weekdayName(weekdayOf(day))}</span>
            <strong>{dayOf(day)}</strong>
          </div>
        ))}
      </div>

      {mode === "week" || !allDayEmpty ? (
        <div
          className={styles.allDayRow}
          style={{ gridTemplateColumns: columns, gridTemplateRows: `repeat(${band.laneCount + 1}, auto)` }}
        >
          <div className={styles.allDayLabel} style={{ gridRow: "1 / -1" }}>
            all day
          </div>
          {days.map((day, i) => (
            <div key={`col-${day}`} className={styles.allDayCol} style={{ gridColumn: i + 2, gridRow: "1 / -1" }} aria-hidden="true" />
          ))}
          {band.bands.map((b) => {
            const o = b.occurrence;
            return (
              <div
                key={o.key}
                className={styles.allDayEvent}
                data-band
                data-before={b.continuesBefore || undefined}
                data-after={b.continuesAfter || undefined}
                data-selected={selectedKey === o.key || undefined}
                role="button"
                tabIndex={0}
                aria-label={occurrenceLabel(o, b.continuesBefore ? "All day, continued" : "All day")}
                style={colorStyle(o, { gridColumn: `${b.first + 2} / span ${b.last - b.first + 1}`, gridRow: b.lane + 1 })}
                title={o.event.title}
                onClick={(event) => actions.openOccurrence(o, event.currentTarget, days[b.first])}
              >
                {b.continuesBefore ? <ChevronLeft size={11} className={styles.bandCont} /> : null}
                <Glyphs occurrence={o} size={11} />
                <span className={styles.chipTitle}>{o.event.title}</span>
                {!o.allDay && !b.continuesBefore ? <small>{occurrenceTimeText(o, days[b.first])}</small> : null}
                {b.continuesAfter ? <ChevronRight size={11} className={styles.bandCont} /> : null}
              </div>
            );
          })}
          {allDayCells.map((cell, i) => (
            <div key={`cell-${days[i]}`} className={styles.allDayCell} style={{ gridColumn: i + 2, gridRow: band.laneCount + 1 }}>
              {cell.layers.map((o) => (
                <div
                  key={o.key}
                  className={styles.allDayEvent}
                  data-layer={o.layer}
                  role="button"
                  tabIndex={0}
                  style={colorStyle(o)}
                  title={o.event.title}
                  onClick={(event) => actions.openOccurrence(o, event.currentTarget, days[i])}
                >
                  <Glyphs occurrence={o} size={11} />
                  <span className={styles.chipTitle}>{o.event.title}</span>
                </div>
              ))}
              {cell.schedule.map((entry) => (
                <div
                  key={entry.id}
                  className={styles.allDayEvent}
                  data-layer="schedule"
                  role="button"
                  tabIndex={0}
                  style={{ ["--ev" as string]: entry.color }}
                  title={entry.label}
                  onClick={(event) => actions.openSchedule(entry, event.currentTarget)}
                >
                  <span className={styles.chipTitle}>{entry.label}</span>
                  {entry.start && entry.end ? <small>{`${formatClock(entry.start)} - ${formatClock(entry.end)}`}</small> : null}
                </div>
              ))}
              {cell.events.map((o) => (
                <div
                  key={o.key}
                  className={styles.allDayEvent}
                  data-selected={selectedKey === o.key || undefined}
                  role="button"
                  tabIndex={0}
                  aria-label={occurrenceLabel(o, "All day", formatWeekdayDate(days[i]!, true))}
                  style={colorStyle(o)}
                  title={o.event.title}
                  onClick={(event) => actions.openOccurrence(o, event.currentTarget, days[i])}
                >
                  <Glyphs occurrence={o} size={11} />
                  <span className={styles.chipTitle}>{o.event.title}</span>
                  <Avatars ids={o.event.attendeeIds} size={14} max={2} />
                </div>
              ))}
              {cell.tasks.map((task) => (
                <div
                  key={task.id}
                  className={styles.taskChip}
                  data-priority={task.priority}
                  role="button"
                  tabIndex={0}
                  aria-label={`Task: ${task.title}${task.dueTime ? `, ${formatClock(task.dueTime)}` : ""}`}
                  title={task.title}
                  onClick={(event) => actions.openTask(task, event.currentTarget)}
                >
                  <span className={styles.taskBox} aria-hidden="true" />
                  <span className={styles.chipTitle}>{task.title}</span>
                  {task.dueTime ? <small>{formatClock(task.dueTime)}</small> : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.tgScroll} ref={scrollRef} onScroll={cancelPress}>
        <div className={styles.tgBody} ref={bodyRef} style={{ gridTemplateColumns: columns }}>
          <div className={styles.tgGutter} aria-hidden="true">
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} style={{ top: `calc(var(--hour) * ${hour})` }}>
                {hour ? formatHour(hour) : ""}
              </span>
            ))}
          </div>
          {days.map((day, i) => {
            const items = dayItems[i]!;
            const timed = items.occurrences.filter((o) => o.layer === "event" && !isAllDayLike(o));
            const lanes = assignColumns(timed, (o) => timeRange(o, day));
            const blocks = scheduleDisplay === "blocks" ? items.schedule.filter(hasTimes) : [];
            const blockLanes = assignColumns(blocks, scheduleRange);
            // DOM order is tab order: chronological, shifts and events mixed.
            const entries: Array<{ range: MinuteRange; node: ReactNode }> = [
              ...blocks.map((entry) => {
                const range = scheduleRange(entry);
                return {
                  range,
                  node: (
                    <div
                      key={entry.id}
                      data-block
                      className={styles.scheduleBlock}
                      role="button"
                      tabIndex={0}
                      aria-label={`${entry.label}, ${formatClock(entry.start!)} - ${formatClock(entry.end!)}`}
                      style={{ ...placement(range, blockLanes.get(entry), { left: 2, total: 4 }), ["--ev" as string]: entry.color }}
                      onClick={(event) => actions.openSchedule(entry, event.currentTarget)}
                    >
                      <span>{entry.label}</span>
                      <small>{`${formatClock(entry.start!)} - ${formatClock(entry.end!)}`}</small>
                    </div>
                  ),
                };
              }),
              ...timed.map((o) => {
                const range = timeRange(o, day);
                const roomy = range.end - range.start >= 45;
                const timeText = occurrenceTimeText(o, day);
                return {
                  range,
                  node: (
                    <div
                      key={o.key}
                      data-block
                      className={styles.block}
                      data-tight={!roomy || undefined}
                      data-selected={selectedKey === o.key || undefined}
                      role="button"
                      tabIndex={0}
                      aria-label={occurrenceLabel(o, [timeText, positionText(o, day)].filter(Boolean).join(", "), formatWeekdayDate(day, true))}
                      style={colorStyle(o, placement(range, lanes.get(o), mode === "day" ? { left: 4, total: 14 } : { left: 2, total: 4 }))}
                      title={o.event.title}
                      onClick={(event) => actions.openOccurrence(o, event.currentTarget, day)}
                    >
                      <span className={styles.blockTitle}>
                        <Glyphs occurrence={o} size={11} />
                        <span>{o.event.title}</span>
                      </span>
                      <span className={styles.blockMeta}>
                        {timeText}
                        {mode === "day" && o.event.location ? ` · ${o.event.location}` : ""}
                      </span>
                      {roomy && range.end - range.start >= 60 ? <Avatars ids={o.event.attendeeIds} size={16} max={3} /> : null}
                    </div>
                  ),
                };
              }),
            ].sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
            return (
              <div
                key={day}
                className={styles.tgColumn}
                data-today={day === today || undefined}
                data-day={day}
                {...columnHandlers(day)}
              >
                {entries.map((entry) => entry.node)}
                {ghost?.day === day ? (
                  <div
                    className={styles.pressGhost}
                    data-armed={ghost.armed || undefined}
                    style={{ top: `calc(var(--hour) * ${timeToMinutes(ghost.time) / 60})`, ["--press-ms" as string]: `${PRESS_MS}ms` }}
                    aria-hidden="true"
                  >
                    {formatClock(ghost.time)}
                  </div>
                ) : null}
                {day === today ? (
                  <div className={styles.nowLine} style={{ top: `calc(var(--hour) * ${nowMinutes / 60})` }} aria-hidden="true" />
                ) : null}
                {mode === "day" && nothingAtAll ? (
                  <p className={styles.dayEmpty} style={{ top: `calc(var(--hour) * ${(day === today ? nowMinutes : 540) / 60} + 16px)` }}>
                    No events yet. Double-click a time to add one.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  if (mode === "week") return grid;

  const day = days[0]!;
  const railDays = Array.from({ length: RAIL_SPAN }, (_, i) => addDays(day, i + 1));
  const marked = new Set(railDays.filter((d) => itemsOn(d).occurrences.length));
  const railGroups = railDays
    .map((d) => ({ day: d, items: itemsOn(d) }))
    .filter(({ items }) => items.occurrences.length || items.tasks.length || items.schedule.length);
  return (
    <div className={styles.dayLayout}>
      {grid}
      <aside className={styles.dayRail} aria-label="Coming up">
        <MiniMonth value={day} today={today} weekStart={props.weekStart} marked={marked} onSelect={actions.jumpTo} />
        <h3 className={styles.railTitle}>Next {RAIL_SPAN} days</h3>
        {railGroups.length ? (
          railGroups.map(({ day: d, items }) => (
            <AgendaDay key={d} day={d} today={today} items={items} selectedKey={selectedKey} actions={actions} compact />
          ))
        ) : (
          <p className={styles.agendaEmptyDay}>No events in the selected range</p>
        )}
      </aside>
    </div>
  );
}
