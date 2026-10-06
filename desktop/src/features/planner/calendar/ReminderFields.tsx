/**
 * Up to five reminders per event, each a lead time before the start: a
 * preset or a custom number of minutes, hours, days or weeks.
 *
 * TODO(backend): reminders are stored with the event but nothing delivers
 * them yet; Yuvomi sends them through its reminders service.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { Plus, X } from "lucide-react";

import styles from "./EventEditor.module.css";
import { REMINDER_PRESETS, type ReminderRow, type ReminderUnit } from "./text";

export const MAX_REMINDERS = 5;

interface ReminderFieldsProps {
  rows: ReminderRow[];
  onChange(rows: ReminderRow[]): void;
  newId(): string;
}

export function ReminderFields({ rows, onChange, newId }: ReminderFieldsProps) {
  const update = (id: string, patch: Partial<ReminderRow>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.label}>{rows.length > 1 ? "Reminders" : "Reminder"}</legend>
      {rows.map((row, index) => (
        <div className={styles.reminderRow} key={row.id}>
          <select
            className={styles.input}
            aria-label={`Reminder ${index + 1}`}
            value={row.choice}
            onChange={(event) => update(row.id, { choice: event.target.value })}
          >
            {REMINDER_PRESETS.map((preset) => (
              <option key={preset.minutes} value={String(preset.minutes)}>
                {preset.label}
              </option>
            ))}
            <option value="custom">Custom...</option>
          </select>
          {row.choice === "custom" ? (
            <>
              <input
                className={`${styles.input} ${styles.amount}`}
                type="number"
                min={1}
                max={999}
                aria-label="Number"
                value={row.amount}
                onChange={(event) => update(row.id, { amount: Math.max(1, parseInt(event.target.value, 10) || 1) })}
              />
              <select
                className={styles.input}
                aria-label="Unit"
                value={row.unit}
                onChange={(event) => update(row.id, { unit: event.target.value as ReminderUnit })}
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
              </select>
            </>
          ) : null}
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Remove reminder"
            onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      {rows.length < MAX_REMINDERS ? (
        <button
          type="button"
          className={styles.addButton}
          onClick={() => onChange([...rows, { id: newId(), choice: rows.length ? "60" : "15", amount: 1, unit: "hours" }])}
        >
          <Plus size={14} /> Add reminder
        </button>
      ) : null}
      {rows.length ? <p className={styles.hint}>Anyone assigned to this event gets this reminder too.</p> : null}
    </fieldset>
  );
}

