import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";

import { MEMBERS } from "../../shared/members";
import { addDays, formatDayMonth, startOfWeek, toMinutes, WEEKDAY_SHORT, weekdayIndex } from "../dates";
import { cx, memberName } from "../labels";
import { shiftColor, type ScheduleEntry, type ScheduleState } from "../model";
import {
  buildLanes,
  clockLabel,
  collapsedMinutes,
  computeActiveHours,
  scheduleData,
  touchesVisibleDay,
  typeLabel,
  type LaneEntry,
} from "../occurrences";
import styles from "../SchedulePage.module.css";
import { Avatar, EmptyState, Segmented } from "./ui";

const HOUR_PX = 44;

function TimedBlock({ entry, activeHours, onOpen }: { entry: LaneEntry; activeHours: number[]; onOpen(): void }) {
  const type = entry.shiftType!;
  const start = entry.continuation ? 0 : toMinutes(type.start!);
  const rawEnd = toMinutes(type.end!);
  // The start-day half stops at midnight; the continuation carries the rest.
  const end = entry.continuation ? rawEnd : rawEnd <= start ? 24 * 60 : rawEnd;
  const top = collapsedMinutes(start, activeHours) ?? 0;
  const bottom = collapsedMinutes(end, activeHours) ?? top;
  const label = typeLabel(type);
  const time = entry.continuation ? `…continues until ${type.end}` : clockLabel(type);
  return (
    <button
      type="button"
      className={cx(styles.block, entry.source === "extra" && styles.blockExtra, entry.continuation && styles.blockContinuation)}
      style={
        {
          "--shift": shiftColor(type.color),
          top: (top / 60) * HOUR_PX,
          height: Math.max(((bottom - top) / 60) * HOUR_PX, 20),
        } as CSSProperties
      }
      title={`${label} · ${time}${entry.note ? ` · ${entry.note}` : ""}`}
      aria-label={`${memberName(entry.memberId)}: ${label}, ${time}`}
      onClick={onOpen}
    >
      <span className={styles.blockTitle}>{type.shortCode || type.name}</span>
      <small>{time}</small>
    </button>
  );
}

export function WeekView({
  state,
  today,
  onOpenEntry,
}: {
  state: ScheduleState;
  today: string;
  onOpenEntry(entry: ScheduleEntry): void;
}) {
  const [mode, setMode] = useState<"week" | "day">("week");
  const [cursor, setCursor] = useState(today);
  const [selected, setSelected] = useState<string[]>(() => MEMBERS.map((member) => member.id));
  const [direction, setDirection] = useState<"prev" | "next" | null>(null);

  const days = useMemo(
    () => (mode === "day" ? [cursor] : Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor), index))),
    [cursor, mode],
  );
  // One day earlier so an overnight shift from the day before still shows.
  const { entries } = useMemo(
    () => scheduleData(state, addDays(days[0]!, -1), days[days.length - 1]!, selected),
    [state, days, selected],
  );
  const visible = useMemo(() => new Set(days), [days]);
  const activeHours = useMemo(
    () => computeActiveHours(entries.filter((entry) => touchesVisibleDay(entry, visible))),
    [entries, visible],
  );
  const columns = useMemo(() => buildLanes(days, selected, entries), [days, selected, entries]);
  const height = activeHours.length * HOUR_PX;
  const showsToday = days.includes(today);
  const step = mode === "day" ? 1 : 7;

  const move = (delta: number) => {
    setDirection(delta < 0 ? "prev" : "next");
    setCursor((current) => addDays(current, delta * step));
  };
  const toggle = (memberId: string) =>
    setSelected((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : MEMBERS.map((member) => member.id).filter((id) => id === memberId || current.includes(id)),
    );

  const label = mode === "day" ? formatDayMonth(days[0]!) : `${formatDayMonth(days[0]!)} – ${formatDayMonth(days[6]!)}`;

  return (
    <section className={styles.view} aria-label="Week grid">
      <div className={styles.toolbar}>
        <div className={styles.people} role="group" aria-label="Compare people">
          {MEMBERS.map((member) => (
            <button
              key={member.id}
              type="button"
              className={styles.personChip}
              aria-pressed={selected.includes(member.id)}
              onClick={() => toggle(member.id)}
            >
              <Avatar memberId={member.id} size={18} />
              {member.name}
            </button>
          ))}
        </div>
        <div className={styles.toolbarEnd}>
          <Segmented
            label="Range"
            value={mode}
            onChange={setMode}
            options={[
              ["week", "Week"],
              ["day", "Day"],
            ]}
          />
          <div className={styles.stepper}>
            <button type="button" aria-label={mode === "day" ? "Previous day" : "Previous week"} onClick={() => move(-1)}>
              <ChevronLeft size={16} />
            </button>
            <strong aria-live="polite">{label}</strong>
            <button type="button" aria-label={mode === "day" ? "Next day" : "Next week"} onClick={() => move(1)}>
              <ChevronRight size={16} />
            </button>
            {!showsToday ? (
              <button
                type="button"
                className={styles.todayButton}
                onClick={() => {
                  setDirection(today < cursor ? "prev" : "next");
                  setCursor(today);
                }}
              >
                Today
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {!selected.length ? (
        <EmptyState
          icon={<Users size={20} />}
          title="Pick people to compare"
          description="Select at least one person above to see their timetables side by side."
        />
      ) : (
        <div className={styles.gridScroll}>
          <div
            key={`${mode}-${days[0]}`}
            className={cx(styles.weekGrid, direction === "prev" && styles.slidePrev, direction === "next" && styles.slideNext)}
            style={{ "--lanes": selected.length, "--days": days.length } as CSSProperties}
          >
            <div className={styles.gutter}>
              <div className={styles.dayHead} />
              <div className={styles.laneHeads} />
              <div className={styles.allDayRow} />
              <div className={styles.laneBody} style={{ height }}>
                {activeHours.map((hour, index) => (
                  <span key={hour} className={styles.hourLabel} style={{ top: index * HOUR_PX }}>
                    {String(hour).padStart(2, "0")}:00
                  </span>
                ))}
              </div>
            </div>
            {columns.map(({ date, lanes }) => (
              <div key={date} className={cx(styles.dayColumn, date === today && styles.dayToday)}>
                <div className={styles.dayHead}>
                  <span>{WEEKDAY_SHORT[weekdayIndex(date)]}</span>
                  <strong>{formatDayMonth(date)}</strong>
                </div>
                <div className={styles.laneHeads}>
                  {lanes.map((lane) => (
                    <span key={lane.memberId} title={memberName(lane.memberId)}>
                      <Avatar memberId={lane.memberId} size={18} />
                    </span>
                  ))}
                </div>
                <div className={styles.allDayRow}>
                  {lanes.map((lane) => (
                    <div key={lane.memberId} className={styles.allDayCell}>
                      {lane.entries
                        .filter((entry) => !entry.shiftType?.start)
                        .map((entry) => (
                          <button
                            key={entry.key}
                            type="button"
                            className={cx(styles.allDayChip, !entry.shiftType && styles.allDayFree)}
                            style={entry.shiftType ? ({ "--shift": shiftColor(entry.shiftType.color) } as CSSProperties) : undefined}
                            title={`${typeLabel(entry.shiftType)}${entry.note ? ` · ${entry.note}` : ""}`}
                            aria-label={`${memberName(entry.memberId)}: ${typeLabel(entry.shiftType)}`}
                            onClick={() => onOpenEntry(entry)}
                          >
                            {entry.shiftType ? entry.shiftType.shortCode || entry.shiftType.name : "Free"}
                          </button>
                        ))}
                    </div>
                  ))}
                </div>
                <div className={styles.lanes} style={{ height }}>
                  {activeHours.map((hour, index) => (
                    <span key={hour} className={styles.hourLine} style={{ top: index * HOUR_PX }} />
                  ))}
                  {lanes.map((lane) => (
                    <div key={lane.memberId} className={styles.lane}>
                      {lane.entries
                        .filter((entry) => entry.shiftType?.start)
                        .map((entry) => (
                          <TimedBlock key={entry.key} entry={entry} activeHours={activeHours} onOpen={() => onOpenEntry(entry)} />
                        ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
