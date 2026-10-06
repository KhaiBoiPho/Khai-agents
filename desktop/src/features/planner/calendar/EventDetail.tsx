/**
 * Read views: what a tap on an event, task, shift or "+N more" opens.
 *
 * The event view shows everything the editor holds — repeat, reminders and
 * visibility used to be visible only by opening the form (Yuvomi #474). Edit
 * is the primary action; delete sits back at the start of the footer.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import {
  AlignLeft,
  Bell,
  CalendarDays,
  CheckSquare,
  Clock,
  Eye,
  Hourglass,
  MapPin,
  Pencil,
  Repeat,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import type { ReactNode } from "react";

import type { ScheduleOccurrence } from "../schedule/calendarFeed";
import { memberById } from "../shared/members";
import type { CalendarTask } from "../tasks/calendarFeed";
import styles from "./CalendarPage.module.css";
import { formatClock, formatWeekdayDate, type DateKey } from "./dates";
import type { Occurrence } from "./model";
import { Avatars, Glyphs } from "./parts";
import { describeRRule } from "./recurrence";
import { mapUrl, occurrenceTimeText, reminderLabel, VISIBILITY_LABELS, whenText } from "./text";
import type { DayItems } from "./viewTypes";
import { assigneeNames, colorStyle } from "./visuals";

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailIcon} aria-hidden="true">
        {icon}
      </span>
      <div>
        <span className={styles.detailLabel}>{label}</span>
        <div className={styles.detailValue}>{children}</div>
      </div>
    </div>
  );
}

interface EventDetailProps {
  occurrence: Occurrence;
  onEdit?(): void;
  onDelete?(): void;
  onClose?(): void;
}

export function EventDetail({ occurrence, onEdit, onDelete, onClose }: EventDetailProps) {
  const { event } = occurrence;
  const editable = occurrence.layer === "event";
  const rule = describeRRule(event.rrule);
  const url = mapUrl(event.location);
  return (
    <div className={styles.detail} style={colorStyle(occurrence)}>
      <header className={styles.detailHead}>
        <span className={styles.detailSwatch} aria-hidden="true" />
        <h2 data-autofocus tabIndex={-1}>
          <Glyphs occurrence={occurrence} size={14} />
          {event.title}
        </h2>
        {onClose ? (
          <button type="button" className={styles.iconButton} aria-label="Close" onClick={onClose}>
            <X size={15} />
          </button>
        ) : null}
      </header>
      <div className={styles.detailBody}>
        <Row icon={<CalendarDays size={14} />} label="Calendar">
          <span className={styles.calendarTag}>
            {occurrence.layer === "holiday" ? "Public holidays" : occurrence.layer === "birthday" ? "Birthdays" : "Local calendar"}
          </span>
        </Row>
        <Row icon={<Clock size={14} />} label="Time">
          {whenText(occurrence)}
        </Row>
        {rule ? (
          <Row icon={<Repeat size={14} />} label="Recurrence">
            {rule}
          </Row>
        ) : null}
        {event.location ? (
          <Row icon={<MapPin size={14} />} label="Location">
            <span>{event.location}</span>
            {url ? (
              <a className={styles.inlineLink} href={url} target="_blank" rel="noopener noreferrer">
                Open in Maps
              </a>
            ) : null}
          </Row>
        ) : null}
        {event.attendeeIds.length ? (
          <Row icon={<UserRound size={14} />} label="Assigned to">
            <span className={styles.detailPeople}>
              <Avatars ids={event.attendeeIds} size={20} max={4} />
              {assigneeNames(event.attendeeIds)}
            </span>
          </Row>
        ) : null}
        {event.reminders.length ? (
          <Row icon={<Bell size={14} />} label={event.reminders.length > 1 ? "Reminders" : "Reminder"}>
            {event.reminders.map(reminderLabel).join(", ")}
          </Row>
        ) : null}
        {editable && event.visibility !== "all" ? (
          <Row icon={<Eye size={14} />} label="Visibility">
            {VISIBILITY_LABELS[event.visibility]}
          </Row>
        ) : null}
        {event.countdown ? (
          <Row icon={<Hourglass size={14} />} label="Countdown">
            Counts down on the overview
          </Row>
        ) : null}
        {event.description ? (
          <Row icon={<AlignLeft size={14} />} label="Description">
            <p className={styles.detailText}>{event.description.slice(0, 500)}</p>
          </Row>
        ) : null}
      </div>
      {editable && (onEdit || onDelete) ? (
        <footer className={styles.detailFoot}>
          {onDelete ? (
            <button type="button" className={styles.dangerGhost} onClick={onDelete}>
              <Trash2 size={14} /> Delete
            </button>
          ) : null}
          {onEdit ? (
            <button type="button" className={styles.primaryButton} onClick={onEdit}>
              <Pencil size={14} /> Edit
            </button>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}

const PRIORITY_LABELS: Record<CalendarTask["priority"], string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export function TaskDetail({ task, onClose }: { task: CalendarTask; onClose(): void }) {
  return (
    <div className={styles.detail} style={{ ["--ev" as string]: "var(--module-tasks)" }}>
      <header className={styles.detailHead}>
        <span className={styles.detailSwatch} aria-hidden="true" />
        <h2 data-autofocus tabIndex={-1}>
          <CheckSquare size={14} className={styles.glyph} aria-hidden="true" />
          {task.title}
        </h2>
        <button type="button" className={styles.iconButton} aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <div className={styles.detailBody}>
        <Row icon={<Clock size={14} />} label="Due">
          {formatWeekdayDate(task.dueDate, true)}
          {task.dueTime ? `, ${formatClock(task.dueTime)}` : ""}
        </Row>
        <Row icon={<CheckSquare size={14} />} label="Status">
          {task.done ? "Done" : "Open"}
          {task.priority !== "none" ? ` · Priority: ${PRIORITY_LABELS[task.priority]}` : ""}
        </Row>
        {task.assigneeIds.length ? (
          <Row icon={<UserRound size={14} />} label="Assigned to">
            <span className={styles.detailPeople}>
              <Avatars ids={task.assigneeIds} size={20} max={4} />
              {assigneeNames(task.assigneeIds)}
            </span>
          </Row>
        ) : null}
        <p className={styles.detailNote}>Tasks are edited in the Tasks module.</p>
      </div>
    </div>
  );
}

export function ScheduleDetail({ entry, onClose }: { entry: ScheduleOccurrence; onClose(): void }) {
  const member = memberById(entry.memberId);
  return (
    <div className={styles.detail} style={{ ["--ev" as string]: entry.color }}>
      <header className={styles.detailHead}>
        <span className={styles.detailSwatch} aria-hidden="true" />
        <h2 data-autofocus tabIndex={-1}>
          {entry.label}
        </h2>
        <button type="button" className={styles.iconButton} aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <div className={styles.detailBody}>
        <Row icon={<CalendarDays size={14} />} label="Calendar">
          <span className={styles.calendarTag}>Schedule</span>
        </Row>
        <Row icon={<Clock size={14} />} label="Time">
          {formatWeekdayDate(entry.date, true)}
          {entry.start && entry.end ? `, ${formatClock(entry.start)} - ${formatClock(entry.end)}` : " · All day"}
        </Row>
        {member ? (
          <Row icon={<UserRound size={14} />} label="Person">
            <span className={styles.detailPeople}>
              <Avatars ids={[member.id]} size={20} />
              {member.name}
            </span>
          </Row>
        ) : null}
        <p className={styles.detailNote}>Shifts and timetables are edited in the Schedule module.</p>
      </div>
    </div>
  );
}

interface DayListProps {
  day: DateKey;
  items: DayItems;
  onOpenOccurrence(occurrence: Occurrence, anchor: HTMLElement): void;
  onOpenTask(task: CalendarTask, anchor: HTMLElement): void;
  onOpenSchedule(entry: ScheduleOccurrence, anchor: HTMLElement): void;
  onOpenDay(): void;
  onClose(): void;
}

/** Everything on one day — what "+N more" opens. */
export function DayList({ day, items, onOpenOccurrence, onOpenTask, onOpenSchedule, onOpenDay, onClose }: DayListProps) {
  return (
    <div className={styles.detail}>
      <header className={styles.detailHead}>
        <h2>
          <button type="button" className={styles.linkButton} onClick={onOpenDay} data-autofocus>
            {formatWeekdayDate(day, true)}
          </button>
        </h2>
        <button type="button" className={styles.iconButton} aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <ul className={styles.dayList}>
        {items.occurrences.map((o) => (
          <li key={o.key}>
            <button type="button" style={colorStyle(o)} onClick={(event) => onOpenOccurrence(o, event.currentTarget)}>
              <Glyphs occurrence={o} size={11} />
              <span>{o.event.title}</span>
              <small>{occurrenceTimeText(o, day)}</small>
            </button>
          </li>
        ))}
        {items.schedule.map((entry) => (
          <li key={entry.id}>
            <button type="button" style={{ ["--ev" as string]: entry.color }} onClick={(event) => onOpenSchedule(entry, event.currentTarget)}>
              <span>{entry.label}</span>
              <small>{entry.start && entry.end ? `${formatClock(entry.start)} - ${formatClock(entry.end)}` : "All day"}</small>
            </button>
          </li>
        ))}
        {items.tasks.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              style={{ ["--ev" as string]: "var(--module-tasks)" }}
              onClick={(event) => onOpenTask(task, event.currentTarget)}
            >
              <CheckSquare size={11} aria-hidden="true" />
              <span>{task.title}</span>
              {task.dueTime ? <small>{formatClock(task.dueTime)}</small> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EmptyPane() {
  return (
    <div className={styles.emptyPane}>
      <CalendarDays size={26} aria-hidden="true" />
      <strong>Choose an event</strong>
      <p>Time, place and reminders appear here.</p>
    </div>
  );
}
