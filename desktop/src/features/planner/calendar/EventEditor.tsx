/**
 * Create and edit form for an event.
 *
 * Field order follows how often each is used (Yuvomi Critique 2026-09-24):
 * title, when, who, repeat, reminders, place, notes — then "More settings"
 * for the choices few events need (visibility, countdown, colour, icon, sync
 * target, attachment). Changing the start carries the end along by the
 * duration last chosen, as Yuvomi's wireDurationMemory does.
 *
 * TODO(backend): sync targets (Google, CalDAV, Outlook) and attachments need
 * the calendar service; they show as disabled "coming soon" controls.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { AlertTriangle, Check, Paperclip, Trash2 } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";

import { initials, MEMBERS } from "../shared/members";
import {
  addDays,
  addMinutes,
  datePart,
  daysBetween,
  isDateKey,
  minutesBetween,
  timePart,
  type DateKey,
} from "./dates";
import { Dialog } from "./Dialog";
import styles from "./EventEditor.module.css";
import type { EventDraft } from "./eventStore";
import { EVENT_COLORS, type Occurrence, type Visibility } from "./model";
import { recurrenceFromRule, ruleEndsBeforeStart, ruleFromRecurrence, type RecurrenceState } from "./recurrence";
import { RecurrenceFields } from "./RecurrenceFields";
import { ReminderFields } from "./ReminderFields";
import { REMINDER_PRESETS, reminderRowMinutes, splitMinutes, type ReminderRow } from "./text";
import { EVENT_ICONS } from "./visuals";

export interface EditorRequest {
  mode: "create" | "edit";
  occurrence?: Occurrence;
  date?: DateKey;
  time?: string;
  /** Suggested start time when none was clicked. */
  defaultTime: string;
}

interface FormState {
  title: string;
  allDay: boolean;
  startDate: DateKey;
  startTime: string;
  endDate: DateKey;
  endTime: string;
  attendeeIds: string[];
  recurrence: RecurrenceState;
  reminders: ReminderRow[];
  location: string;
  description: string;
  visibility: Visibility;
  countdown: boolean;
  color: string | null;
  icon: string | null;
}

let rowCounter = 0;
const nextRowId = () => `r${++rowCounter}`;

function reminderRows(minutes: readonly number[]): ReminderRow[] {
  return minutes.map((m) => {
    const preset = REMINDER_PRESETS.some((p) => p.minutes === m);
    const { amount, unit } = splitMinutes(m);
    return { id: nextRowId(), choice: preset ? String(m) : "custom", amount, unit };
  });
}

function initialForm(request: EditorRequest): FormState {
  const o = request.occurrence;
  if (request.mode === "edit" && o) {
    const e = o.event;
    const startDate = datePart(o.start);
    return {
      title: e.title,
      allDay: e.allDay,
      startDate,
      startTime: timePart(o.start) || "09:00",
      endDate: datePart(o.end),
      endTime: timePart(o.end) || "10:00",
      attendeeIds: [...e.attendeeIds],
      recurrence: recurrenceFromRule(e.rrule),
      reminders: reminderRows(e.reminders),
      location: e.location,
      description: e.description,
      visibility: e.visibility,
      countdown: e.countdown,
      color: e.color,
      icon: e.icon,
    };
  }
  const date = request.date ?? "";
  const time = request.time ?? request.defaultTime;
  const end = addMinutes(date, time, 60);
  return {
    title: "",
    allDay: false,
    startDate: date,
    startTime: time,
    endDate: end.date,
    endTime: end.time,
    attendeeIds: [],
    recurrence: recurrenceFromRule(null),
    reminders: [],
    location: "",
    description: "",
    visibility: "all",
    countdown: false,
    color: null,
    icon: null,
  };
}

type Errors = Partial<Record<"title" | "start" | "end" | "until", string>>;

interface EventEditorProps {
  request: EditorRequest;
  onSave(draft: EventDraft): void;
  onDelete?(): void;
  onClose(): void;
}

export function EventEditor({ request, onSave, onDelete, onClose }: EventEditorProps) {
  const [initial] = useState(() => initialForm(request));
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(
    () => request.mode === "edit" && (initial.visibility !== "all" || initial.countdown),
  );
  // The duration the end follows when the start moves.
  const duration = useRef({
    minutes: Math.max(15, minutesBetween(`${initial.startDate}T${initial.startTime}`, `${initial.endDate}T${initial.endTime}`)),
    days: Math.max(0, daysBetween(initial.startDate, initial.endDate)),
  });
  const titleRef = useRef<HTMLInputElement | null>(null);
  const id = useId();

  const dirty = JSON.stringify({ ...form, reminders: form.reminders.map(reminderRowMinutes) }) !==
    JSON.stringify({ ...initial, reminders: initial.reminders.map(reminderRowMinutes) });

  const set = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  const dismiss = () => {
    if (dirty && !confirmDiscard) setConfirmDiscard(true);
    else onClose();
  };

  const setStart = (startDate: DateKey, startTime: string) => {
    if (form.allDay) {
      set({ startDate, endDate: isDateKey(startDate) ? addDays(startDate, duration.current.days) : form.endDate });
      return;
    }
    if (!isDateKey(startDate) || !startTime) {
      set({ startDate, startTime });
      return;
    }
    const end = addMinutes(startDate, startTime, duration.current.minutes);
    set({ startDate, startTime, endDate: end.date, endTime: end.time });
  };

  const setEnd = (endDate: DateKey, endTime: string) => {
    set({ endDate, endTime });
    if (isDateKey(endDate) && isDateKey(form.startDate)) {
      const minutes = minutesBetween(`${form.startDate}T${form.startTime}`, `${endDate}T${endTime || "00:00"}`);
      if (minutes > 0) duration.current.minutes = minutes;
      const days = daysBetween(form.startDate, endDate);
      if (days >= 0) duration.current.days = days;
    }
  };

  const submit = () => {
    const next: Errors = {};
    const title = form.title.trim();
    if (!title) next.title = "Title is required";
    if (!isDateKey(form.startDate) || (!form.allDay && !form.startTime)) next.start = "Use a valid date and time.";
    if (!isDateKey(form.endDate) || (!form.allDay && !form.endTime)) next.end = "Use a valid date and time.";
    const start = form.allDay ? form.startDate : `${form.startDate}T${form.startTime}`;
    const end = form.allDay ? form.endDate : `${form.endDate}T${form.endTime}`;
    if (!next.start && !next.end && end < start) next.end = "The end date can't be before the start date.";
    let rrule = ruleFromRecurrence(form.recurrence);
    // An unchanged rule is written back verbatim, so parts outside the form survive (#756).
    if (request.occurrence && rrule === ruleFromRecurrence(initial.recurrence)) rrule = request.occurrence.event.rrule;
    if (form.recurrence.endMode === "until" && !isDateKey(form.recurrence.until) && form.recurrence.freq) {
      next.until = "Use a valid date.";
    } else if (!next.start && ruleEndsBeforeStart(rrule, form.startDate)) {
      next.until = "The repeat end can't be before the start date.";
    }
    setErrors(next);
    if (Object.keys(next).length) {
      if (next.title) titleRef.current?.focus();
      return;
    }
    const reminders = [...new Set(form.reminders.map(reminderRowMinutes))].sort((a, b) => a - b).slice(0, 5);
    onSave({
      title,
      description: form.description.trim(),
      location: form.location.trim(),
      allDay: form.allDay,
      start,
      end,
      color: form.color,
      icon: form.icon,
      attendeeIds: form.attendeeIds,
      rrule,
      reminders,
      visibility: form.visibility,
      countdown: form.countdown,
    });
  };

  const onColorKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = [null, ...EVENT_COLORS.map((c) => c.key)];
    const index = keys.indexOf(form.color);
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = keys[(index + step + keys.length) % keys.length]!;
    set({ color: next });
    const target = event.currentTarget.querySelector<HTMLElement>(`[data-color="${next ?? ""}"]`);
    target?.focus();
  };

  const isEdit = request.mode === "edit";
  const visibilityWarning =
    form.visibility === "assignees" && !form.attendeeIds.length
      ? "With no one assigned, only you can see this entry."
      : form.visibility === "private" && form.attendeeIds.some((m) => m !== "me")
        ? "The people assigned won't see this entry while it is private."
        : "";

  const field = (name: keyof Errors) =>
    errors[name] ? { "aria-invalid": true as const, "aria-describedby": `${id}-${name}-error` } : {};
  const errorText = (name: keyof Errors) =>
    errors[name] ? (
      <p className={styles.error} id={`${id}-${name}-error`} role="alert">
        {errors[name]}
      </p>
    ) : null;

  return (
    <Dialog label={isEdit ? "Edit Event" : "New Event"} onDismiss={dismiss}>
      <form
        className={styles.dialogInner}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 className={styles.dialogTitle}>{isEdit ? "Edit Event" : "New Event"}</h2>
        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.label}>
              Title <abbr title="required">*</abbr>
            </span>
            <input
              ref={titleRef}
              data-autofocus
              className={styles.input}
              value={form.title}
              placeholder="e.g. Model eval review"
              required
              {...field("title")}
              onChange={(event) => set({ title: event.target.value })}
            />
            {errorText("title")}
          </label>

          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={form.allDay}
              onChange={(event) => {
                const allDay = event.target.checked;
                set({ allDay, endDate: allDay && form.endDate < form.startDate ? form.startDate : form.endDate });
              }}
            />
            <span>All day</span>
          </label>

          <div className={styles.when} data-allday={form.allDay || undefined}>
            <span className={styles.label} id={`${id}-from`}>
              From
            </span>
            <input
              className={styles.input}
              type="date"
              aria-labelledby={`${id}-from`}
              value={form.startDate}
              {...field("start")}
              onChange={(event) => setStart(event.target.value, form.startTime)}
            />
            {!form.allDay ? (
              <input
                className={styles.input}
                type="time"
                aria-label="Start time"
                value={form.startTime}
                onChange={(event) => setStart(form.startDate, event.target.value)}
              />
            ) : null}
            <span className={styles.label} id={`${id}-to`}>
              To
            </span>
            <input
              className={styles.input}
              type="date"
              aria-labelledby={`${id}-to`}
              value={form.endDate}
              min={form.startDate}
              {...field("end")}
              onChange={(event) => setEnd(event.target.value, form.endTime)}
            />
            {!form.allDay ? (
              <input
                className={styles.input}
                type="time"
                aria-label="End time"
                value={form.endTime}
                onChange={(event) => setEnd(form.endDate, event.target.value)}
              />
            ) : null}
          </div>
          {errorText("start")}
          {errorText("end")}

          <fieldset className={styles.fieldset}>
            <legend className={styles.label}>Assigned to</legend>
            <div className={styles.people}>
              {MEMBERS.map((member) => {
                const on = form.attendeeIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    className={styles.person}
                    aria-pressed={on}
                    onClick={() =>
                      set({ attendeeIds: on ? form.attendeeIds.filter((m) => m !== member.id) : [...form.attendeeIds, member.id] })
                    }
                  >
                    <span className={styles.personAvatar} style={{ background: member.color }} aria-hidden="true">
                      {initials(member.name)}
                    </span>
                    {member.name}
                    {on ? <Check size={13} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <RecurrenceFields
            value={form.recurrence}
            startDate={form.startDate}
            onChange={(recurrence) => set({ recurrence })}
            untilError={errors.until}
          />

          <ReminderFields rows={form.reminders} onChange={(reminders) => set({ reminders })} newId={nextRowId} />

          <label className={styles.field}>
            <span className={styles.label}>Location</span>
            <input
              className={styles.input}
              value={form.location}
              placeholder="Optional"
              onChange={(event) => set({ location: event.target.value })}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Description</span>
            <textarea
              className={styles.input}
              rows={2}
              value={form.description}
              placeholder="Optional…"
              onChange={(event) => set({ description: event.target.value })}
            />
          </label>

          <details
            className={styles.advanced}
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary>
              More settings
              <small>Visibility, countdown, color, icon, sync target and attachment</small>
            </summary>
            <div className={styles.advancedBody}>
              <label className={styles.field}>
                <span className={styles.label}>Visibility</span>
                <select
                  className={styles.input}
                  value={form.visibility}
                  onChange={(event) => set({ visibility: event.target.value as Visibility })}
                >
                  <option value="all">Everyone in the workspace</option>
                  <option value="assignees">Assignees only</option>
                  <option value="private">Only me</option>
                </select>
                <span className={styles.hint}>Controls who can see this entry.</span>
                {visibilityWarning ? (
                  <span className={styles.warn} role="status">
                    <AlertTriangle size={13} aria-hidden="true" />
                    {visibilityWarning}
                  </span>
                ) : null}
              </label>

              <label className={styles.toggle}>
                <input type="checkbox" checked={form.countdown} onChange={(event) => set({ countdown: event.target.checked })} />
                <span>Count down on the overview</span>
              </label>
              <p className={styles.hint}>Shows on the overview how long there is to go - only here, not at your calendar provider.</p>

              <div className={styles.field}>
                <span className={styles.label} id={`${id}-color`}>
                  Color
                </span>
                <div className={styles.swatches} role="radiogroup" aria-labelledby={`${id}-color`} onKeyDown={onColorKey}>
                  <button
                    type="button"
                    role="radio"
                    data-color=""
                    aria-checked={form.color === null}
                    tabIndex={form.color === null ? 0 : -1}
                    className={`${styles.swatch} ${styles.inherit}`}
                    aria-label="Colour of the assigned person"
                    title="The event takes the colour of the first person it is assigned to."
                    onClick={() => set({ color: null })}
                  />
                  {EVENT_COLORS.map((color) => (
                    <button
                      key={color.key}
                      type="button"
                      role="radio"
                      data-color={color.key}
                      aria-checked={form.color === color.key}
                      tabIndex={form.color === color.key ? 0 : -1}
                      className={styles.swatch}
                      style={{ background: color.value }}
                      aria-label={color.label}
                      title={color.label}
                      onClick={() => set({ color: color.key })}
                    />
                  ))}
                </div>
              </div>

              <div className={styles.field}>
                <span className={styles.label} id={`${id}-icon`}>
                  Icon
                </span>
                <div className={styles.icons} role="radiogroup" aria-labelledby={`${id}-icon`}>
                  {EVENT_ICONS.map(({ name, label, Icon }) => {
                    const selected = (form.icon ?? "calendar") === name;
                    return (
                      <button
                        key={name}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={styles.iconChoice}
                        aria-label={label}
                        title={label}
                        onClick={() => set({ icon: name === "calendar" ? null : name })}
                      >
                        <Icon size={15} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className={styles.field}>
                <span className={styles.label}>Sync target</span>
                <select className={styles.input} disabled value="">
                  <option value="">Store locally only</option>
                </select>
                <span className={styles.hint}>Google Calendar, CalDAV and Outlook sync are coming soon.</span>
              </label>

              <div className={styles.field}>
                <span className={styles.label}>Attachment</span>
                <button type="button" className={styles.secondary} disabled title="Coming soon">
                  <Paperclip size={14} /> Attach a file
                </button>
                <span className={styles.hint}>Attachments are coming soon.</span>
              </div>
            </div>
          </details>
        </div>

        {confirmDiscard ? (
          <div className={styles.discard} role="alertdialog" aria-label="Discard changes?">
            <span>Discard your changes?</span>
            <button type="button" className={styles.secondary} onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </button>
            <button type="button" className={styles.dangerOutline} onClick={onClose}>
              Discard
            </button>
          </div>
        ) : null}

        <footer className={styles.footer}>
          {isEdit && onDelete ? (
            <button type="button" className={styles.dangerOutline} onClick={onDelete}>
              <Trash2 size={14} /> Delete
            </button>
          ) : (
            <span />
          )}
          <div className={styles.footerActions}>
            <button type="button" className={styles.secondary} onClick={dismiss}>
              Cancel
            </button>
            <button type="submit" className={styles.primary}>
              {isEdit ? "Save" : "Create"}
            </button>
          </div>
        </footer>
      </form>
    </Dialog>
  );
}
