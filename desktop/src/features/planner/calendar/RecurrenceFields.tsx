/**
 * The repeat section of the event form, after Yuvomi's rrule-ui.
 *
 * Weekly series show the start's weekday as chosen until someone picks days
 * themselves ("implied" — it is not written into the rule, so moving the
 * start moves it along). "Last day of the month" is the one monthly choice a
 * start date cannot express, so it is the only extra monthly field (#960).
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import styles from "./EventEditor.module.css";
import type { DateKey } from "./dates";
import {
  intervalUnitLabel,
  monthEndHint,
  WEEKDAY_CODES,
  weekdayCodeOf,
  type Freq,
  type RecurrenceState,
  type WeekdayCode,
} from "./recurrence";

const FREQ_OPTIONS: ReadonlyArray<{ value: Freq | ""; label: string }> = [
  { value: "", label: "No recurrence" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
];

const DAY_LABELS: Record<WeekdayCode, string> = {
  MO: "Mo", TU: "Tu", WE: "We", TH: "Th", FR: "Fr", SA: "Sa", SU: "Su",
};

interface RecurrenceFieldsProps {
  value: RecurrenceState;
  startDate: DateKey;
  onChange(next: RecurrenceState): void;
  untilError?: string;
}

export function RecurrenceFields({ value, startDate, onChange, untilError }: RecurrenceFieldsProps) {
  const set = (patch: Partial<RecurrenceState>) => onChange({ ...value, ...patch });
  const implied = value.byday.length ? null : weekdayCodeOf(startDate);
  const toggleDay = (code: WeekdayCode) => {
    const chosen = value.byday.includes(code) ? value.byday.filter((d) => d !== code) : [...value.byday, code];
    set({ byday: chosen });
  };

  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.label}>Recurrence</legend>
      <select
        className={styles.input}
        aria-label="Recurrence"
        value={value.freq}
        onChange={(event) => set({ freq: event.target.value as Freq | "" })}
        aria-describedby={value.freq ? undefined : "cal-rrule-hint"}
      >
        {FREQ_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {!value.freq ? (
        <p className={styles.hint} id="cal-rrule-hint">
          Once you pick one, the interval is yours to set - every 2 weeks, or every 3 months.
        </p>
      ) : (
        <div className={styles.rruleDetails}>
          <div className={styles.row}>
            <label className={styles.inline}>
              <span className={styles.label}>Every</span>
              <span className={styles.interval}>
                <input
                  className={styles.input}
                  type="number"
                  min={1}
                  max={99}
                  inputMode="numeric"
                  value={value.interval}
                  onChange={(event) => set({ interval: parseInt(event.target.value, 10) || 1 })}
                />
                <span>{intervalUnitLabel(value.freq, value.interval)}</span>
              </span>
            </label>
            <label className={styles.inline}>
              <span className={styles.label}>Ends</span>
              <select
                className={styles.input}
                value={value.endMode}
                onChange={(event) => set({ endMode: event.target.value as RecurrenceState["endMode"] })}
              >
                <option value="never">Never</option>
                <option value="until">On date</option>
                <option value="count">After</option>
              </select>
            </label>
            {value.endMode === "until" ? (
              <label className={styles.inline}>
                <span className={styles.label}>Ends on</span>
                <input
                  className={styles.input}
                  type="date"
                  value={value.until}
                  min={startDate}
                  aria-invalid={untilError ? true : undefined}
                  aria-describedby={untilError ? "cal-rrule-until-error" : undefined}
                  onChange={(event) => set({ until: event.target.value })}
                />
              </label>
            ) : null}
            {value.endMode === "count" ? (
              <label className={styles.inline}>
                <span className={styles.label}>Number of occurrences</span>
                <span className={styles.interval}>
                  <input
                    className={styles.input}
                    type="number"
                    min={1}
                    max={999}
                    inputMode="numeric"
                    value={value.count}
                    onChange={(event) => set({ count: parseInt(event.target.value, 10) || 1 })}
                  />
                  <span>occurrences</span>
                </span>
              </label>
            ) : null}
          </div>
          {untilError ? (
            <p className={styles.error} id="cal-rrule-until-error" role="alert">
              {untilError}
            </p>
          ) : null}
          {value.freq === "WEEKLY" ? (
            <div role="group" aria-label="On these days" className={styles.weekdays}>
              {WEEKDAY_CODES.map((code) => {
                const active = value.byday.includes(code) || code === implied;
                return (
                  <button
                    key={code}
                    type="button"
                    className={styles.weekday}
                    aria-pressed={active}
                    data-implied={code === implied || undefined}
                    onClick={() => toggleDay(code)}
                  >
                    {DAY_LABELS[code]}
                  </button>
                );
              })}
            </div>
          ) : null}
          {value.freq === "MONTHLY" ? (
            <div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={value.lastDay}
                  aria-describedby={value.lastDay ? "cal-rrule-lastday-hint" : undefined}
                  onChange={(event) => set({ lastDay: event.target.checked })}
                />
                <span>On the last day of the month</span>
              </label>
              {value.lastDay ? (
                <p className={styles.hint} id="cal-rrule-lastday-hint">
                  {monthEndHint(startDate)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </fieldset>
  );
}
