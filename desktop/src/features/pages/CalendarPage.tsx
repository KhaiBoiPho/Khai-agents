/**
 * Calendar — preview of scheduled agent runs, deadlines and events.
 *
 * TODO(backend): events are sample data; wire to scheduled runs and an
 * external calendar connector when they exist.
 */

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import styles from "./Pages.module.css";

type Kind = "run" | "deadline" | "meeting";

interface CalendarEvent {
  day: number; // offset from today
  time: string;
  title: string;
  kind: Kind;
}

const EVENTS: CalendarEvent[] = [
  { day: 0, time: "09:00", title: "Daily code review run", kind: "run" },
  { day: 0, time: "15:30", title: "Sync with team", kind: "meeting" },
  { day: 1, time: "10:00", title: "Dependency audit run", kind: "run" },
  { day: 2, time: "17:00", title: "Ship settings redesign", kind: "deadline" },
  { day: 4, time: "14:00", title: "Demo prep", kind: "meeting" },
  { day: 6, time: "09:00", title: "Weekly report draft", kind: "run" },
  { day: 9, time: "23:59", title: "Paper2Code submission", kind: "deadline" },
  { day: -2, time: "11:00", title: "Sprint retro", kind: "meeting" },
  { day: -5, time: "09:00", title: "Security scan run", kind: "run" },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function CalendarPage() {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of EVENTS) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + event.day);
      const key = dateKey(date);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [today]);

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first grid
  const cells = Array.from({ length: 42 }, (_, index) =>
    new Date(cursor.getFullYear(), cursor.getMonth(), index - lead + 1),
  );
  const upcoming = [...EVENTS]
    .filter((event) => event.day >= 0)
    .sort((left, right) => left.day - right.day || left.time.localeCompare(right.time))
    .slice(0, 6);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Calendar</h1>
        <div className={styles.monthNav}>
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            <ChevronLeft size={16} />
          </button>
          <strong>
            {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </strong>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            className={styles.todayButton}
            onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
          >
            Today
          </button>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.primary} title="Coming soon">
            <Plus size={15} /> New event
          </button>
        </div>
      </header>

      <div className={styles.calendarLayout}>
        <div className={styles.calendar}>
          {WEEKDAYS.map((day) => (
            <span key={day} className={styles.weekday}>
              {day}
            </span>
          ))}
          {cells.map((date) => {
            const events = byDay.get(dateKey(date)) ?? [];
            return (
              <div
                key={date.toISOString()}
                className={styles.dayCell}
                data-outside={date.getMonth() !== cursor.getMonth() || undefined}
                data-today={dateKey(date) === dateKey(today) || undefined}
              >
                <span className={styles.dayNumber}>{date.getDate()}</span>
                {events.slice(0, 2).map((event) => (
                  <span key={event.title} className={styles.event} data-kind={event.kind}>
                    {event.title}
                  </span>
                ))}
                {events.length > 2 ? (
                  <small className={styles.more}>+{events.length - 2} more</small>
                ) : null}
              </div>
            );
          })}
        </div>

        <aside className={styles.upcoming}>
          <strong>Upcoming</strong>
          {upcoming.map((event) => {
            const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + event.day);
            return (
              <div key={event.title} className={styles.upcomingItem} data-kind={event.kind}>
                <span>
                  {event.day === 0
                    ? "Today"
                    : event.day === 1
                      ? "Tomorrow"
                      : date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                  {" · "}
                  {event.time}
                </span>
                <strong>{event.title}</strong>
              </div>
            );
          })}
          <p className={styles.previewNote}>Preview — sample events.</p>
        </aside>
      </div>
    </div>
  );
}
