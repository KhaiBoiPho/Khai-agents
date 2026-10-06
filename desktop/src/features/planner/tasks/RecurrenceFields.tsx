import { Dropdown } from "../../../components/Dropdown";
import { buildRule, parseRule, unitLabel, weekdayOf, type Frequency, type RecurrenceRule } from "./recurrence";

import styles from "./TaskDetail.module.css";

const FREQUENCIES: ReadonlyArray<{ id: Frequency | ""; label: string }> = [
  { id: "", label: "Does not repeat" },
  { id: "DAILY", label: "Daily" },
  { id: "WEEKLY", label: "Weekly" },
  { id: "MONTHLY", label: "Monthly" },
  { id: "YEARLY", label: "Yearly" },
];

// Monday first, as the week runs in the rule arithmetic.
const DAYS = [
  { day: 1, label: "M", name: "Monday" },
  { day: 2, label: "T", name: "Tuesday" },
  { day: 3, label: "W", name: "Wednesday" },
  { day: 4, label: "T", name: "Thursday" },
  { day: 5, label: "F", name: "Friday" },
  { day: 6, label: "S", name: "Saturday" },
  { day: 0, label: "S", name: "Sunday" },
];

export function RecurrenceFields({
  rule,
  fromCompletion,
  dueDate,
  onChange,
}: {
  rule: string | null;
  fromCompletion: boolean;
  dueDate: string | null;
  onChange(rule: string | null, fromCompletion: boolean): void;
}) {
  const parsed = parseRule(rule);
  const emit = (patch: Partial<RecurrenceRule>, nextFromCompletion = fromCompletion) => {
    if (!parsed) return;
    onChange(buildRule({ ...parsed, ...patch }), nextFromCompletion);
  };
  // A weekly rule without days repeats on its due date's weekday: show that
  // day as active instead of seven buttons that all look off.
  const impliedDay = parsed && !parsed.byday.length && dueDate ? weekdayOf(dueDate) : null;

  return (
    <div className={styles.recurrence}>
      <Dropdown
        triggerClassName={styles.pill}
        trigger={FREQUENCIES.find((entry) => entry.id === (parsed?.freq ?? ""))!.label}
        triggerLabel="Repeat"
        sections={[
          {
            items: FREQUENCIES.map((entry) => ({
              id: entry.id || "none",
              label: entry.label,
              selected: (parsed?.freq ?? "") === entry.id,
              onSelect: () =>
                onChange(
                  entry.id
                    ? buildRule({ freq: entry.id, interval: parsed?.interval ?? 1, byday: [], until: parsed?.until ?? null, lastDay: false })
                    : null,
                  entry.id ? fromCompletion : false,
                ),
            })),
          },
        ]}
      />

      {parsed ? (
        <>
          <label className={styles.inline}>
            Every
            <input
              type="number"
              min={1}
              max={99}
              value={parsed.interval}
              aria-label="Interval"
              onChange={(event) => emit({ interval: Math.max(1, Math.min(99, Number(event.target.value) || 1)) })}
            />
            {unitLabel(parsed.freq, parsed.interval)}
          </label>

          {parsed.freq === "WEEKLY" ? (
            <div className={styles.weekdays} role="group" aria-label="On these days">
              {DAYS.map(({ day, label, name }) => {
                const implied = day === impliedDay;
                const active = implied || parsed.byday.includes(day);
                return (
                  <button
                    type="button"
                    key={day}
                    aria-pressed={active}
                    aria-label={name}
                    title={implied ? `${name} (from the due date)` : name}
                    data-implied={implied || undefined}
                    onClick={() => {
                      const base = parsed.byday.length ? parsed.byday : impliedDay !== null ? [impliedDay] : [];
                      const next = base.includes(day) ? base.filter((entry) => entry !== day) : [...base, day];
                      emit({ byday: next });
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {parsed.freq === "MONTHLY" ? (
            <label className={styles.check}>
              <input type="checkbox" checked={parsed.lastDay} onChange={(event) => emit({ lastDay: event.target.checked })} />
              On the last day of the month
            </label>
          ) : null}

          <label className={styles.inline}>
            Ends
            <input
              type="date"
              value={parsed.until ?? ""}
              aria-label="Repeat until"
              onChange={(event) => emit({ until: event.target.value || null })}
            />
          </label>

          <label className={styles.check}>
            <input
              type="checkbox"
              checked={fromCompletion}
              onChange={(event) => emit({}, event.target.checked)}
            />
            Count from when it’s ticked off
          </label>
          <p className={styles.hint}>
            {fromCompletion
              ? "The interval starts the day it's done — right for chores whose clock starts with the action."
              : "Stays on the due-date grid; an overdue task catches up to the next date on or after today."}
          </p>
        </>
      ) : (
        <p className={styles.hint}>The next one appears when this one is ticked off.</p>
      )}
    </div>
  );
}
