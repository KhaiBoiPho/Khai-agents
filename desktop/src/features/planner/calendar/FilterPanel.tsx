/**
 * Layers, calendars, people and display options — Yuvomi's filter sheet,
 * shown as a popover at the filter button so the calendar stays visible while
 * each switch applies live. It is a view panel, not a form: every change is
 * saved as it is made, so there is nothing to discard on close.
 *
 * It is deliberately no colour legend: an event's colour comes from its own
 * choice, then its first assignee, so "this colour = that calendar" would be
 * wrong for most events. People are the one unambiguous axis.
 *
 * TODO(backend): external calendars (Google, CalDAV, Outlook) and ICS
 * subscriptions are listed as coming soon.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { initials, MEMBERS } from "../shared/members";
import styles from "./CalendarPage.module.css";
import { BIRTHDAY_COLOR, HOLIDAY_COLOR } from "./model";
import { DEFAULT_PREFS, UNASSIGNED, type CalendarPrefs } from "./eventStore";

interface FilterPanelProps {
  prefs: CalendarPrefs;
  onChange(patch: Partial<CalendarPrefs>): void;
}

function Toggle({
  label,
  checked,
  onChange,
  swatch,
  avatar,
  disabled,
  note,
}: {
  label: string;
  checked: boolean;
  onChange?(checked: boolean): void;
  swatch?: string;
  avatar?: { color: string; text: string };
  disabled?: boolean;
  note?: string;
}) {
  return (
    <label className={styles.filterRow} data-disabled={disabled || undefined}>
      {avatar ? (
        <span className={styles.avatar} style={{ background: avatar.color, ["--avatar" as string]: "20px" }} aria-hidden="true">
          {avatar.text}
        </span>
      ) : swatch ? (
        <span className={styles.filterSwatch} style={{ background: swatch }} aria-hidden="true" />
      ) : null}
      <span className={styles.filterLabel}>
        {label}
        {note ? <small>{note}</small> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        className={styles.switch}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
      />
    </label>
  );
}

export function FilterPanel({ prefs, onChange }: FilterPanelProps) {
  const layer = (key: keyof CalendarPrefs["layers"], on: boolean) => onChange({ layers: { ...prefs.layers, [key]: on } });

  const everyone = [...MEMBERS.map((m) => m.id), UNASSIGNED];
  const personOn = (id: string) => !prefs.people.length || prefs.people.includes(id);
  const togglePerson = (id: string, on: boolean) => {
    // Leaving "everyone" turns the empty set into the rest; choosing all again
    // clears it, so no filter stays active that removes nothing.
    const current = prefs.people.length ? prefs.people : everyone;
    const next = on ? [...new Set([...current, id])] : current.filter((p) => p !== id);
    onChange({ people: next.length === everyone.length ? [] : next });
  };

  return (
    <div className={styles.filters}>
      <section>
        <h3>Layers</h3>
        <Toggle label="Tasks with due dates" checked={prefs.layers.tasks} swatch="var(--module-tasks)" onChange={(on) => layer("tasks", on)} />
        <Toggle label="Schedule" checked={prefs.layers.schedule} swatch="var(--module-schedule)" onChange={(on) => layer("schedule", on)} />
        <Toggle label="Public holidays" checked={prefs.layers.holidays} swatch={HOLIDAY_COLOR} onChange={(on) => layer("holidays", on)} />
        <Toggle label="Birthdays" checked={prefs.layers.birthdays} swatch={BIRTHDAY_COLOR} onChange={(on) => layer("birthdays", on)} />
      </section>
      <section>
        <h3>Calendars</h3>
        <Toggle label="Local calendar" checked swatch="var(--module-calendar)" disabled note="Always shown" />
        <Toggle label="Google Calendar" checked={false} disabled note="Coming soon" />
        <Toggle label="CalDAV / Apple" checked={false} disabled note="Coming soon" />
        <Toggle label="Outlook" checked={false} disabled note="Coming soon" />
        <Toggle label="ICS subscriptions" checked={false} disabled note="Coming soon" />
      </section>
      <section>
        <h3>People</h3>
        <Toggle label="Assigned to me" checked={prefs.assignedToMe} onChange={(on) => onChange({ assignedToMe: on })} />
        {MEMBERS.map((member) => (
          <Toggle
            key={member.id}
            label={member.name}
            checked={personOn(member.id)}
            avatar={{ color: member.color, text: initials(member.name) }}
            onChange={(on) => togglePerson(member.id, on)}
          />
        ))}
        <Toggle label="Unassigned" checked={personOn(UNASSIGNED)} onChange={(on) => togglePerson(UNASSIGNED, on)} />
      </section>
      <section>
        <h3>Display</h3>
        <Toggle
          label="Show shifts as time blocks"
          checked={prefs.scheduleDisplay === "blocks"}
          onChange={(on) => onChange({ scheduleDisplay: on ? "blocks" : "compact" })}
        />
        <p className={styles.filterHint}>Off: shifts appear as compact all-day chips in Week and Day view.</p>
        <Toggle label="Week starts on Sunday" checked={prefs.weekStart === 0} onChange={(on) => onChange({ weekStart: on ? 0 : 1 })} />
      </section>
      <footer>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() =>
            onChange({ layers: DEFAULT_PREFS.layers, assignedToMe: false, people: [] })
          }
        >
          Clear all filters
        </button>
      </footer>
    </div>
  );
}
