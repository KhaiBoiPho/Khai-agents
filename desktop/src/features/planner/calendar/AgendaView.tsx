/**
 * The agenda: the next 31 days as a list, days with nothing left out — except
 * today, whose absence would read like a loading error rather than a free
 * day. Beside the list sits the chosen event's detail (Yuvomi R10 L5).
 *
 * The same day rows serve the day view's side rail.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { CalendarPlus, Clock, Lock, MapPin, Users } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import styles from "./CalendarPage.module.css";
import { addDays, formatClock, formatDayMonth, formatWeekdayDate, weekdayName, weekdayOf, type DateKey } from "./dates";
import { Avatars, Glyphs } from "./parts";
import { AGENDA_SPAN } from "./periods";
import { occurrenceTimeText, positionText } from "./text";
import type { DayItems, ViewActions, ViewProps } from "./viewTypes";
import { colorStyle, occurrenceLabel } from "./visuals";

interface AgendaDayProps {
  day: DateKey;
  today: DateKey;
  items: DayItems;
  selectedKey: string | null;
  actions: ViewActions;
  compact?: boolean;
  /** Index of the first row, so the stagger runs on across days. */
  staggerFrom?: number;
}

const activate = (handler: (target: HTMLElement) => void) => ({
  onClick: (event: MouseEvent<HTMLElement>) => handler(event.currentTarget),
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    handler(event.currentTarget);
  },
});

export function AgendaDay({ day, today, items, selectedKey, actions, compact, staggerFrom = 0 }: AgendaDayProps) {
  const layers = items.occurrences.filter((o) => o.layer !== "event");
  const events = items.occurrences.filter((o) => o.layer === "event");
  const empty = !items.occurrences.length && !items.tasks.length && !items.schedule.length;
  let index = staggerFrom;
  const HeadingTag = compact ? "h4" : "h3";
  return (
    <section className={styles.agendaDay} data-compact={compact || undefined}>
      <HeadingTag className={styles.agendaHead} data-today={day === today || undefined}>
        <span>{day === today ? "Today" : formatDayMonth(day)}</span>
        <small>{weekdayName(weekdayOf(day), "long")}</small>
      </HeadingTag>
      {layers.length || items.schedule.length ? (
        <div className={styles.agendaLayers}>
          {layers.map((o) => (
            <span
              key={o.key}
              className={styles.agendaLayer}
              style={colorStyle(o)}
              role="button"
              tabIndex={0}
              {...activate((target) => actions.openOccurrence(o, target, day))}
            >
              <i aria-hidden="true" />
              {o.event.title}
            </span>
          ))}
          {items.schedule.map((entry) => (
            <span
              key={entry.id}
              className={styles.agendaLayer}
              style={{ ["--ev" as string]: entry.color }}
              role="button"
              tabIndex={0}
              {...activate((target) => actions.openSchedule(entry, target))}
            >
              <i aria-hidden="true" />
              {entry.label}
              {entry.start && entry.end ? ` · ${formatClock(entry.start)} - ${formatClock(entry.end)}` : ""}
            </span>
          ))}
        </div>
      ) : null}
      {events.map((o) => {
        const timeText = occurrenceTimeText(o, day);
        const position = positionText(o, day);
        return (
          <div
            key={o.key}
            className={styles.agendaRow}
            data-selected={selectedKey === o.key || undefined}
            style={colorStyle(o, { ["--i" as string]: Math.min(index++, 14) })}
            role="button"
            tabIndex={0}
            aria-label={occurrenceLabel(o, [timeText, position].filter(Boolean).join(", "))}
            {...activate((target) => actions.openOccurrence(o, target, day))}
          >
            <div className={styles.agendaTitle}>
              <Glyphs occurrence={o} size={13} />
              <span>{o.event.title}</span>
            </div>
            <div className={styles.agendaMeta}>
              <span>
                <Clock size={12} aria-hidden="true" />
                {timeText}
                {position ? <em>{position}</em> : null}
              </span>
              {o.event.location && !compact ? (
                <span>
                  <MapPin size={12} aria-hidden="true" />
                  {o.event.location}
                </span>
              ) : null}
              {o.event.visibility !== "all" && !compact ? (
                <span>
                  {o.event.visibility === "private" ? <Lock size={12} aria-hidden="true" /> : <Users size={12} aria-hidden="true" />}
                  {o.event.visibility === "private" ? "Only me" : "Assignees only"}
                </span>
              ) : null}
              {!compact ? <Avatars ids={o.event.attendeeIds} size={20} max={3} /> : null}
            </div>
          </div>
        );
      })}
      {items.tasks.map((task) => (
        <div
          key={task.id}
          className={styles.agendaTask}
          data-done={task.done || undefined}
          data-priority={task.priority}
          role="button"
          tabIndex={0}
          aria-label={`Task: ${task.title}${task.priority !== "none" ? `, priority ${task.priority}` : ""}${task.dueTime ? `, ${formatClock(task.dueTime)}` : ""}`}
          style={{ ["--i" as string]: Math.min(index++, 14) }}
          {...activate((target) => actions.openTask(task, target))}
        >
          <span className={styles.taskBox} aria-hidden="true" />
          <span>{task.title}</span>
          {task.dueTime ? <small>{formatClock(task.dueTime)}</small> : null}
        </div>
      ))}
      {empty ? <p className={styles.agendaEmptyDay}>Nothing planned</p> : null}
    </section>
  );
}

interface AgendaViewProps extends ViewProps {
  pane: ReactNode;
}

export function AgendaView({ cursor, today, itemsOn, selectedKey, actions, pane }: AgendaViewProps) {
  const to = addDays(cursor, AGENDA_SPAN - 1);
  const todayInRange = today >= cursor && today <= to;
  const groups = Array.from({ length: AGENDA_SPAN }, (_, i) => addDays(cursor, i))
    .map((day) => ({ day, items: itemsOn(day) }))
    .filter(
      ({ day, items }) =>
        items.occurrences.length || items.tasks.length || items.schedule.length || (todayInRange && day === today),
    );
  let running = 0;
  return (
    <div className={styles.agendaSplit}>
      <div className={styles.agendaList} aria-label={`Agenda from ${formatWeekdayDate(cursor, true)}`}>
        {groups.length ? (
          groups.map(({ day, items }) => {
            const from = running;
            running += items.occurrences.length + items.tasks.length;
            return (
              <AgendaDay key={day} day={day} today={today} items={items} selectedKey={selectedKey} actions={actions} staggerFrom={from} />
            );
          })
        ) : (
          <div className={styles.emptyState}>
            <CalendarPlus size={28} aria-hidden="true" />
            <p>No events in the selected range</p>
            <button type="button" className={styles.primaryButton} onClick={() => actions.create(cursor)}>
              New event
            </button>
          </div>
        )}
      </div>
      <div className={styles.agendaPane} aria-label="Event details">
        {pane}
      </div>
    </div>
  );
}
