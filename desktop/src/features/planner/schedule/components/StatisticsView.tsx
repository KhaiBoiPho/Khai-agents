import { AlertTriangle } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";

import { daysBetween, formatLongDate, monthBounds } from "../dates";
import { memberName } from "../labels";
import { DEFAULT_WEEKLY_HOURS, MAX_RANGE_DAYS, shiftColor, type ScheduleState, type ShiftType } from "../model";
import { formatHours, overtimeInfo, scheduleData, statisticsSummary, typeLabel } from "../occurrences";
import { setWeeklyHours } from "../scheduleStore";
import styles from "../SchedulePage.module.css";
import { Field, FieldGroup, MemberPicker, Segmented } from "./ui";

type Apply = (edit: (state: ScheduleState) => ScheduleState) => string | null;
type Range = "current" | "months" | "custom";

interface BarItem {
  id: string;
  type: ShiftType | null;
  label: string;
  value: number;
  display: string;
}

/** Bars scale to the largest item in this list; a floor keeps the smallest visible. */
function Bars({ items, empty }: { items: BarItem[]; empty: string }) {
  if (!items.length) return <p className={styles.statEmpty}>{empty}</p>;
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <ul className={styles.bars}>
      {items.map((item) => (
        <li key={item.id}>
          <span className={styles.barHead}>
            <span>{item.label}</span>
            <strong>{item.display}</strong>
          </span>
          <span className={styles.barTrack}>
            <span
              className={styles.barFill}
              style={
                {
                  "--shift": item.type ? shiftColor(item.type.color) : "var(--text-tertiary)",
                  "--scale": Math.max(0.03, item.value / max).toFixed(3),
                } as CSSProperties
              }
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StatisticsView({ state, apply, today }: { state: ScheduleState; apply: Apply; today: string }) {
  const [memberId, setMemberId] = useState("me");
  const [range, setRange] = useState<Range>("current");
  const [monthFrom, setMonthFrom] = useState(today.slice(0, 7));
  const [monthTo, setMonthTo] = useState(today.slice(0, 7));
  const [from, setFrom] = useState(monthBounds(today).from);
  const [to, setTo] = useState(monthBounds(today).to);

  const bounds = useMemo(() => {
    if (range === "current") return monthBounds(today);
    if (range === "months") {
      if (!/^\d{4}-\d{2}$/.test(monthFrom) || !/^\d{4}-\d{2}$/.test(monthTo) || monthFrom > monthTo) return null;
      return { from: monthBounds(`${monthFrom}-01`).from, to: monthBounds(`${monthTo}-01`).to };
    }
    const span = daysBetween(from, to);
    return span === null || span < 0 ? null : { from, to };
  }, [range, today, monthFrom, monthTo, from, to]);

  const entries = useMemo(
    () => (bounds ? scheduleData(state, bounds.from, bounds.to, [memberId]).entries : []),
    [state, bounds, memberId],
  );
  const summary = useMemo(() => statisticsSummary(entries), [entries]);
  const weeklyHours = state.settings.weeklyHours[memberId] ?? DEFAULT_WEEKLY_HOURS;
  const overtime = state.settings.overtimeEnabled ? overtimeInfo(entries, weeklyHours) : null;
  const tooLong = bounds ? (daysBetween(bounds.from, bounds.to) ?? 0) >= MAX_RANGE_DAYS : false;

  const countItems: BarItem[] = summary.values.map((item) => ({
    id: item.type.id,
    type: item.type,
    label: typeLabel(item.type),
    value: item.count,
    display: String(item.count),
  }));
  if (summary.freeDays) {
    countItems.push({ id: "free", type: null, label: "Free days", value: summary.freeDays, display: String(summary.freeDays) });
  }
  const hourItems: BarItem[] = summary.values
    .filter((item) => item.hasHours)
    .map((item) => ({
      id: item.type.id,
      type: item.type,
      label: typeLabel(item.type),
      value: item.minutes,
      display: formatHours(item.minutes),
    }));

  return (
    <section className={styles.view}>
      <div className={styles.statFilters}>
        <FieldGroup label="Person">
          <MemberPicker value={memberId} onChange={setMemberId} label="Person" />
        </FieldGroup>
        <FieldGroup label="Period">
          <Segmented
            label="Period"
            value={range}
            onChange={setRange}
            options={[
              ["current", "Current month"],
              ["months", "Full months"],
              ["custom", "Custom range"],
            ]}
          />
        </FieldGroup>
        {range === "months" ? (
          <>
            <Field label="Month from">
              <input className={styles.input} type="month" value={monthFrom} onChange={(e) => setMonthFrom(e.target.value)} />
            </Field>
            <Field label="Month to">
              <input className={styles.input} type="month" value={monthTo} onChange={(e) => setMonthTo(e.target.value)} />
            </Field>
          </>
        ) : null}
        {range === "custom" ? (
          <>
            <Field label="From">
              <input className={styles.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <input className={styles.input} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </>
        ) : null}
      </div>

      {!bounds ? (
        <p className={styles.statEmpty} role="status">
          Choose a valid period.
        </p>
      ) : (
        <>
          <p className={styles.statPeriod}>
            {memberName(memberId)} · {formatLongDate(bounds.from)} to {formatLongDate(bounds.to)}
            {tooLong ? " · only the first two years are counted" : ""}
          </p>
          <div className={styles.metrics}>
            <article className={styles.metric}>
              <span>Shift count</span>
              <strong>{summary.totalCount}</strong>
              <small>shifts</small>
            </article>
            <article className={styles.metric}>
              <span>Total hours</span>
              <strong>{formatHours(summary.totalMinutes)}</strong>
              <small>planned</small>
            </article>
            {overtime?.over ? (
              <article className={`${styles.metric} ${styles.metricWarn}`}>
                <span>
                  <AlertTriangle size={12} /> Overtime
                </span>
                <strong>+{formatHours(overtime.excessMinutes)}</strong>
                <small>Above {weeklyHours} h in a 7-day stretch of this range</small>
              </article>
            ) : null}
          </div>
          <div className={styles.statCards}>
            <section className={styles.statCard}>
              <h3>Shift count</h3>
              <p>Number of scheduled shifts by type.</p>
              <Bars key={`c-${memberId}-${bounds.from}-${bounds.to}`} items={countItems} empty="No schedule entries in the selected period." />
            </section>
            <section className={styles.statCard}>
              <h3>Hours by shift type</h3>
              <p>Scheduled hours by shift type.</p>
              <Bars key={`h-${memberId}-${bounds.from}-${bounds.to}`} items={hourItems} empty="No schedule entries in the selected period." />
            </section>
          </div>
        </>
      )}

      <section className={styles.statCard}>
        <h3>Settings for {memberName(memberId)}</h3>
        <div className={styles.formRow}>
          <Field label="Weekly hours (for the overtime flag)" hint="Flags any 7 consecutive days in the range above this.">
            <input
              className={styles.input}
              type="number"
              min={1}
              max={168}
              value={weeklyHours}
              onChange={(e) => apply((current) => setWeeklyHours(current, memberId, Number(e.target.value) || null))}
            />
          </Field>
          <label className={styles.toggleRow}>
            <input
              type="checkbox"
              checked={state.settings.overtimeEnabled}
              onChange={(e) =>
                apply((current) => ({ ...current, settings: { ...current.settings, overtimeEnabled: e.target.checked } }))
              }
            />
            <span>Track overtime</span>
          </label>
        </div>
      </section>
    </section>
  );
}
