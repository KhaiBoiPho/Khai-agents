import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";

import { MEMBERS } from "../../shared/members";
import { addMonths, dateKeysInRange, formatLongDate, formatMonth, monthBounds, WEEKDAY_SHORT, weekdayIndex } from "../dates";
import { cx, memberName } from "../labels";
import { shiftColor, type ScheduleEntry, type ScheduleState } from "../model";
import { scheduleData, typeLabel } from "../occurrences";
import styles from "../SchedulePage.module.css";
import { Avatar, Swatch } from "./ui";

/**
 * Per-member roster: one row per person, one column per day, short codes in
 * the cells. Clicking a cell opens that day's override.
 */
export function MonthView({
  state,
  today,
  onEditDay,
}: {
  state: ScheduleState;
  today: string;
  onEditDay(memberId: string, date: string): void;
}) {
  const [month, setMonth] = useState(() => monthBounds(today).from);
  const [direction, setDirection] = useState<"prev" | "next" | null>(null);
  const bounds = monthBounds(month);
  const days = useMemo(() => dateKeysInRange(bounds.from, bounds.to), [bounds.from, bounds.to]);
  const memberIds = useMemo(() => MEMBERS.map((member) => member.id), []);
  const { entries, warnings } = useMemo(
    () => scheduleData(state, bounds.from, bounds.to, memberIds),
    [state, bounds.from, bounds.to, memberIds],
  );
  const byCell = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>();
    for (const entry of entries) {
      const key = `${entry.memberId}:${entry.date}`;
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    return map;
  }, [entries]);
  const warned = useMemo(() => new Set(warnings.map((warning) => `${warning.memberId}:${warning.date}`)), [warnings]);
  const usedTypes = useMemo(() => {
    const seen = new Map<string, NonNullable<ScheduleEntry["shiftType"]>>();
    for (const entry of entries) if (entry.shiftType) seen.set(entry.shiftType.id, entry.shiftType);
    return [...seen.values()];
  }, [entries]);

  const move = (delta: number) => {
    setDirection(delta < 0 ? "prev" : "next");
    setMonth((current) => addMonths(current, delta));
  };
  const showsToday = today >= bounds.from && today <= bounds.to;

  return (
    <section className={styles.view} aria-label="Month roster">
      <div className={styles.toolbar}>
        <div className={styles.stepper}>
          <button type="button" aria-label="Previous month" onClick={() => move(-1)}>
            <ChevronLeft size={16} />
          </button>
          <strong aria-live="polite">{formatMonth(month)}</strong>
          <button type="button" aria-label="Next month" onClick={() => move(1)}>
            <ChevronRight size={16} />
          </button>
          {!showsToday ? (
            <button
              type="button"
              className={styles.todayButton}
              onClick={() => {
                setDirection(today < month ? "prev" : "next");
                setMonth(monthBounds(today).from);
              }}
            >
              Today
            </button>
          ) : null}
        </div>
        <p className={styles.toolbarHint}>Click a day to override it.</p>
      </div>

      <div className={styles.gridScroll}>
        <table
          key={month}
          className={cx(styles.roster, direction === "prev" && styles.slidePrev, direction === "next" && styles.slideNext)}
          style={{ "--days": days.length } as CSSProperties}
        >
          <thead>
            <tr>
              <th scope="col" className={styles.rosterCorner}>
                Person
              </th>
              {days.map((date) => (
                <th
                  key={date}
                  scope="col"
                  className={cx(weekdayIndex(date) >= 5 && styles.weekend, date === today && styles.rosterToday)}
                >
                  <span>{WEEKDAY_SHORT[weekdayIndex(date)]!.slice(0, 2)}</span>
                  <strong>{Number(date.slice(8))}</strong>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {memberIds.map((memberId) => (
              <tr key={memberId}>
                <th scope="row" className={styles.rosterPerson}>
                  <Avatar memberId={memberId} size={20} />
                  <span>{memberName(memberId)}</span>
                </th>
                {days.map((date) => {
                  const cell = byCell.get(`${memberId}:${date}`) ?? [];
                  const typed = cell.filter((entry) => entry.shiftType);
                  const description = cell.length
                    ? cell.map((entry) => `${typeLabel(entry.shiftType)}${entry.source === "extra" ? " (extra)" : ""}`).join(", ")
                    : "Nothing planned";
                  return (
                    <td
                      key={date}
                      className={cx(
                        weekdayIndex(date) >= 5 && styles.weekend,
                        date === today && styles.rosterToday,
                        warned.has(`${memberId}:${date}`) && styles.rosterWarn,
                      )}
                    >
                      <button
                        type="button"
                        className={styles.rosterCell}
                        aria-label={`${memberName(memberId)}, ${formatLongDate(date)}: ${description}`}
                        title={description}
                        onClick={() => onEditDay(memberId, date)}
                      >
                        {typed.slice(0, 2).map((entry) => (
                          <span
                            key={entry.key}
                            className={cx(styles.rosterCode, entry.source === "extra" && styles.rosterExtra)}
                            style={{ "--shift": shiftColor(entry.shiftType!.color) } as CSSProperties}
                          >
                            {entry.shiftType!.shortCode || entry.shiftType!.name.slice(0, 2)}
                          </span>
                        ))}
                        {typed.length > 2 ? <span className={styles.rosterMore}>+{typed.length - 2}</span> : null}
                        {!typed.length && cell.length ? <span className={styles.rosterFree}>·</span> : null}
                        {cell.some((entry) => entry.source === "override") ? (
                          <span className={styles.overrideMark} aria-hidden="true" />
                        ) : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {usedTypes.length ? (
        <ul className={styles.legend} aria-label="Legend">
          {usedTypes.map((type) => (
            <li key={type.id}>
              <Swatch type={type} />
              {typeLabel(type)}
            </li>
          ))}
          <li>
            <span className={styles.legendOverride} aria-hidden="true" /> Override
          </li>
        </ul>
      ) : null}
    </section>
  );
}
