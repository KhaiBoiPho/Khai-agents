/**
 * Search results, grouped by day, past to future, opened scrolled to the
 * first upcoming day (Yuvomi #471).
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { AlertTriangle, CalendarSearch, Search } from "lucide-react";
import { useLayoutEffect, useMemo, useRef } from "react";

import styles from "./CalendarPage.module.css";
import { formatWeekdayDate, type DateKey } from "./dates";
import type { Occurrence } from "./model";
import { Glyphs } from "./parts";
import { occurrenceTimeText } from "./text";
import { colorStyle } from "./visuals";

interface SearchResultsProps {
  query: string;
  results: Occurrence[];
  total: number;
  today: DateKey;
  onOpen(occurrence: Occurrence, anchor: HTMLElement): void;
  onCreate(): void;
}

export function SearchResults({ query, results, total, today, onOpen, onCreate }: SearchResultsProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const groups = useMemo(() => {
    const byDay = new Map<DateKey, Occurrence[]>();
    for (const o of results) byDay.set(o.slot, [...(byDay.get(o.slot) ?? []), o]);
    return [...byDay.entries()];
  }, [results]);
  const upcoming = groups.find(([day]) => day >= today)?.[0];

  useLayoutEffect(() => {
    if (!upcoming) return;
    listRef.current?.querySelector(`[data-day="${upcoming}"]`)?.scrollIntoView?.({ block: "start" });
  }, [upcoming]);

  if (query.trim().length < 2) {
    return (
      <div className={styles.searchStatus}>
        <Search size={26} aria-hidden="true" />
        <p>Find an event - even when you don't know the date.</p>
      </div>
    );
  }
  if (!results.length) {
    return (
      <div className={styles.searchStatus}>
        <CalendarSearch size={26} aria-hidden="true" />
        <p>No events found for “{query.trim()}”.</p>
        <button type="button" className={styles.secondaryButton} onClick={onCreate}>
          New event
        </button>
      </div>
    );
  }
  return (
    <div className={styles.searchResults} ref={listRef}>
      <p className={styles.searchCount}>
        {total > results.length ? `${results.length} of ${total} results` : `${results.length} ${results.length === 1 ? "result" : "results"}`}
      </p>
      {groups.map(([day, list]) => (
        <section key={day} className={styles.agendaDay} data-day={day}>
          <h3 className={styles.agendaHead} data-today={day === today || undefined}>
            <span>{formatWeekdayDate(day, true)}</span>
          </h3>
          {list.map((o, i) => (
            <button
              key={o.key}
              type="button"
              className={styles.agendaRow}
              style={colorStyle(o, { ["--i" as string]: Math.min(i, 14) })}
              onClick={(event) => onOpen(o, event.currentTarget)}
            >
              <span className={styles.agendaTitle}>
                <Glyphs occurrence={o} size={13} />
                <span>{o.event.title}</span>
              </span>
              <span className={styles.agendaMeta}>
                <span>{occurrenceTimeText(o, day)}</span>
                {o.event.location ? <span>{o.event.location}</span> : null}
              </span>
            </button>
          ))}
        </section>
      ))}
      {total > results.length ? (
        <p className={styles.searchCount}>
          <AlertTriangle size={12} aria-hidden="true" /> Showing the first {results.length}. Refine the search to see more.
        </p>
      ) : null}
    </div>
  );
}
