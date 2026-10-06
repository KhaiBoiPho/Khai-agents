import { AlertTriangle } from "lucide-react";
import { useState, type CSSProperties, type FormEvent } from "react";

import { Dropdown } from "../../../../components/Dropdown";
import { daysBetween, formatLongDate, isDateKey, startOfWeek } from "../dates";
import { cx, memberName } from "../labels";
import {
  MAX_FILL_DAYS,
  SHIFT_COLOR_NAMES,
  shiftColor,
  type ExtraShift,
  type Override,
  type Pattern,
  type PatternKind,
  type ScheduleEntry,
  type ScheduleState,
  type ShiftColor,
  type ShiftType,
} from "../model";
import {
  clockLabel,
  findOverlappingActivePattern,
  rangeDifference,
  shiftMinutes,
  formatHours,
  typeLabel,
  type DayGroup,
} from "../occurrences";
import {
  addExtras,
  deleteExtras,
  deleteOverrides,
  fillOverrides,
  upsertPattern,
  upsertShiftType,
} from "../scheduleStore";
import { ALL_PRESETS } from "../seed";
import styles from "../SchedulePage.module.css";
import { Avatar, Field, FieldGroup, MemberPicker, Modal, Segmented, Swatch, TypePicker } from "./ui";

type Apply = (edit: (state: ScheduleState) => ScheduleState) => string | null;

interface BaseProps {
  state: ScheduleState;
  apply: Apply;
  onClose(): void;
  onDone(message: string): void;
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className={styles.formError} role="alert">
      <AlertTriangle size={14} /> {message}
    </p>
  );
}

function Footer({ onCancel, submitLabel, form, danger }: { onCancel(): void; submitLabel: string; form: string; danger?: boolean }) {
  return (
    <>
      <button type="button" className={styles.secondary} onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" form={form} className={danger ? styles.dangerButton : styles.primaryButton}>
        {submitLabel}
      </button>
    </>
  );
}

/* ---------- Shift type ---------- */

export function ShiftTypeDialog({ apply, onClose, onDone, type }: Omit<BaseProps, "state"> & { type?: ShiftType }) {
  const [name, setName] = useState(type?.name ?? "");
  const [shortCode, setShortCode] = useState(type?.shortCode ?? "");
  const [allDay, setAllDay] = useState(type ? !type.start : false);
  const [start, setStart] = useState(type?.start ?? "09:00");
  const [end, setEnd] = useState(type?.end ?? "17:00");
  const [color, setColor] = useState<ShiftColor>(type?.color ?? "teal");
  const [error, setError] = useState<string | null>(null);
  const draft: ShiftType = {
    id: type?.id ?? "draft",
    name: name || "New shift type",
    shortCode,
    start: allDay ? null : start,
    end: allDay ? null : end,
    color,
  };
  const minutes = shiftMinutes(draft);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const failure = apply((current) =>
      upsertShiftType(current, { name, shortCode, start: allDay ? null : start, end: allDay ? null : end, color }, type?.id),
    );
    if (failure) setError(failure);
    else onDone(type ? "Shift type saved." : `Added “${name.trim()}”.`);
  };

  return (
    <Modal
      title={type ? "Edit shift type" : "Add shift type"}
      onClose={onClose}
      footer={<Footer onCancel={onClose} submitLabel="Save" form="schedule-type-form" />}
    >
      <form id="schedule-type-form" className={styles.form} onSubmit={submit}>
        {!type ? (
          <FieldGroup label="Preset">
            <Dropdown
              triggerLabel="Preset"
              trigger="Start from a preset…"
              sections={[
                {
                  items: ALL_PRESETS.map((preset) => ({
                    id: preset.key,
                    label: preset.name,
                    description: preset.start ? `${preset.start}–${preset.end}` : "All day",
                    icon: <Swatch type={{ ...preset, id: preset.key }} />,
                    onSelect: () => {
                      setName(preset.name);
                      setShortCode(preset.shortCode);
                      setAllDay(!preset.start);
                      if (preset.start && preset.end) {
                        setStart(preset.start);
                        setEnd(preset.end);
                      }
                      setColor(preset.color);
                    },
                  })),
                },
              ]}
            />
          </FieldGroup>
        ) : null}
        <div className={styles.formRow}>
          <Field label="Name">
            <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </Field>
          <Field label="Short code" hint="Shown in the compact roster.">
            <input className={styles.input} value={shortCode} onChange={(e) => setShortCode(e.target.value)} maxLength={12} />
          </Field>
        </div>
        <label className={styles.toggleRow}>
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          <span>
            All day <small>— for absences such as vacation or sick days</small>
          </span>
        </label>
        {!allDay ? (
          <div className={styles.formRow}>
            <Field label="Start time">
              <input className={styles.input} type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
            </Field>
            <Field label="End time" hint="An end at or before the start crosses midnight.">
              <input className={styles.input} type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </Field>
          </div>
        ) : null}
        <FieldGroup label="Color">
          <div className={styles.colorRow}>
            {SHIFT_COLOR_NAMES.map((option) => (
              <button
                key={option}
                type="button"
                className={styles.colorOption}
                style={{ "--shift": shiftColor(option) } as CSSProperties}
                aria-label={option}
                aria-pressed={option === color}
                onClick={() => setColor(option)}
              />
            ))}
          </div>
        </FieldGroup>
        <div className={styles.preview} aria-live="polite">
          <Swatch type={draft} />
          <strong>{typeLabel(draft)}</strong>
          <span>{clockLabel(draft)}</span>
          {minutes != null ? <span>{formatHours(minutes)}</span> : null}
        </div>
        <ErrorLine message={error} />
      </form>
    </Modal>
  );
}

/* ---------- Pattern ---------- */

export function PatternDialog({
  state,
  apply,
  onClose,
  onDone,
  pattern,
  today,
  defaultMember,
}: BaseProps & { pattern?: Pattern; today: string; defaultMember: string }) {
  const [memberId, setMemberId] = useState(pattern?.memberId ?? defaultMember);
  const [name, setName] = useState(pattern?.name ?? "");
  const [kind, setKind] = useState<PatternKind>(pattern?.kind ?? "rotation");
  const [anchorDate, setAnchorDate] = useState(pattern?.anchorDate ?? today);
  const [cycleLength, setCycleLength] = useState(String(pattern?.cycleLength ?? 8));
  const [validFrom, setValidFrom] = useState(pattern?.validFrom ?? "");
  const [validUntil, setValidUntil] = useState(pattern?.validUntil ?? "");
  const [active, setActive] = useState(pattern?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<Pattern | null>(null);

  const changeKind = (next: PatternKind) => {
    setKind(next);
    if (next === "timetable") {
      // A timetable reads by weekday, so day 1 must be a Monday.
      setAnchorDate((current) => startOfWeek(isDateKey(current) ? current : today));
      setCycleLength((current) => (current === "14" ? "14" : "7"));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input = {
      memberId,
      name,
      kind,
      anchorDate,
      cycleLength: Number(cycleLength),
      validFrom: validFrom || null,
      validUntil: validUntil || null,
      active,
    };
    // Overlap is allowed (the newest validFrom wins) but never silent.
    const competitor = active
      ? findOverlappingActivePattern(state.patterns, memberId, input.validFrom, input.validUntil, pattern?.id ?? null)
      : undefined;
    const reactivating = !pattern || !pattern.active || pattern.memberId !== memberId;
    if (competitor && reactivating && overlap?.id !== competitor.id) {
      setOverlap(competitor);
      return;
    }
    const failure = apply((current) => upsertPattern(current, input, pattern?.id));
    if (failure) setError(failure);
    else onDone(pattern ? "Schedule plan saved." : "Schedule plan created — set its cycle days below.");
  };

  return (
    <Modal
      title={pattern ? "Edit schedule plan" : "New schedule plan"}
      onClose={onClose}
      footer={<Footer onCancel={onClose} submitLabel={overlap ? "Replace" : "Save"} form="schedule-pattern-form" />}
    >
      <form id="schedule-pattern-form" className={styles.form} onSubmit={submit}>
        <FieldGroup label="Type">
          <Segmented
            label="Plan type"
            value={kind}
            onChange={changeKind}
            options={[
              ["rotation", "Rotating shifts"],
              ["timetable", "Weekly timetable"],
            ]}
          />
        </FieldGroup>
        <div className={styles.formRow}>
          <Field label="Name">
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "timetable" ? "Work week" : "On-call rotation"}
              required
            />
          </Field>
          <FieldGroup label="Owner">
            <MemberPicker value={memberId} onChange={setMemberId} />
          </FieldGroup>
        </div>
        <div className={styles.formRow}>
          <Field
            label="Cycle starts on"
            hint={kind === "timetable" ? "Day 1 is this Monday." : "Days before it follow the same rhythm backwards."}
          >
            <input className={styles.input} type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} required />
          </Field>
          {kind === "timetable" ? (
            <FieldGroup label="Repeats">
              <Segmented
                label="Repeats"
                value={cycleLength === "14" ? "14" : "7"}
                onChange={setCycleLength}
                options={[
                  ["7", "Every week"],
                  ["14", "Week A / week B"],
                ]}
              />
            </FieldGroup>
          ) : (
            <Field label="Cycle length (days)">
              <input
                className={styles.input}
                type="number"
                min={1}
                max={366}
                value={cycleLength}
                onChange={(e) => setCycleLength(e.target.value)}
                required
              />
            </Field>
          )}
        </div>
        <div className={styles.formRow}>
          <Field label="Valid from" hint="Optional">
            <input className={styles.input} type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field label="Valid until" hint="Optional">
            <input className={styles.input} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
        </div>
        <label className={styles.toggleRow}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>Active</span>
        </label>
        {overlap ? (
          <div className={styles.confirmBox} role="alert">
            <strong>Replace {memberName(memberId)}’s current schedule?</strong>
            <p>
              The new plan takes precedence wherever both apply. “{overlap.name}” stays saved but stops showing while
              they overlap.
            </p>
          </div>
        ) : null}
        <ErrorLine message={error} />
      </form>
    </Modal>
  );
}

/* ---------- Override / extra ---------- */

export type OccurrenceMode = "override" | "extra";

export function OccurrenceDialog({
  state,
  apply,
  onClose,
  onDone,
  mode: initialMode,
  memberId: initialMember,
  from: initialFrom,
  to: initialTo,
  overrideGroup,
  extraGroup,
}: BaseProps & {
  mode: OccurrenceMode;
  memberId: string;
  from: string;
  to?: string;
  overrideGroup?: DayGroup<Override>;
  extraGroup?: DayGroup<ExtraShift>;
}) {
  const editing = overrideGroup ?? extraGroup;
  const [mode, setMode] = useState<OccurrenceMode>(initialMode);
  const [memberId, setMemberId] = useState(editing?.memberId ?? initialMember);
  const [from, setFrom] = useState(editing?.from ?? initialFrom);
  const [to, setTo] = useState(editing?.to ?? initialTo ?? initialFrom);
  const [overrideType, setOverrideType] = useState<string | null>(overrideGroup ? overrideGroup.shiftTypeId : null);
  const [extraType, setExtraType] = useState<string | null>(extraGroup?.shiftTypeId ?? state.types[0]?.id ?? null);
  const [note, setNote] = useState(editing?.note ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const span = (daysBetween(from, to) ?? -1) + 1;
  const typeId = mode === "override" ? overrideType : extraType;
  const typeName = typeLabel(state.types.find((type) => type.id === typeId) ?? null);
  // A multi-day fill overwrites existing overrides in range; ask first.
  const needsConfirm = mode === "override" && span > 1 && !confirmed;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (span < 1) return setError("Choose a valid period.");
    if (span > MAX_FILL_DAYS) return setError(`A range covers at most ${MAX_FILL_DAYS} days.`);
    if (needsConfirm) return setConfirmed(true);
    const failure = apply((current) => {
      if (mode === "override") {
        let next = current;
        if (overrideGroup) {
          // Editing a group reconciles: whatever fell outside the new span goes.
          for (const piece of rangeDifference(overrideGroup.from, overrideGroup.to, from, to)) {
            next = deleteOverrides(next, overrideGroup.memberId, piece.from, piece.to);
          }
          if (overrideGroup.memberId !== memberId) {
            next = deleteOverrides(next, overrideGroup.memberId, overrideGroup.from, overrideGroup.to);
          }
        }
        return fillOverrides(next, memberId, from, to, overrideType, note);
      }
      const base = extraGroup ? deleteExtras(current, extraGroup.ids) : current;
      return addExtras(base, memberId, from, to, extraType ?? "", note);
    });
    if (failure) setError(failure);
    else onDone(mode === "override" ? "Override saved." : "Extra shift saved.");
  };

  const title = editing
    ? mode === "override"
      ? "Edit override"
      : "Edit extra shift"
    : mode === "override"
      ? "Add override"
      : "Add extra shift";

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <Footer
          onCancel={onClose}
          submitLabel={needsConfirm ? "Fill range" : confirmed && mode === "override" && span > 1 ? "Confirm" : "Save"}
          form="schedule-occurrence-form"
        />
      }
    >
      <form id="schedule-occurrence-form" className={styles.form} onSubmit={submit}>
        {!editing ? (
          <Segmented
            label="Entry kind"
            value={mode}
            onChange={(next) => {
              setMode(next);
              setConfirmed(false);
            }}
            options={[
              ["override", "Replace the day"],
              ["extra", "Add on top"],
            ]}
          />
        ) : null}
        <p className={styles.formHint}>
          {mode === "override"
            ? "An override replaces what the plan says for these days. A free day is an explicit day off."
            : "An extra shift stacks on whatever the day already has — on-call next to a regular shift, for example."}
        </p>
        <div className={styles.formRow}>
          <FieldGroup label="Owner">
            <MemberPicker value={memberId} onChange={setMemberId} />
          </FieldGroup>
          <FieldGroup label="Shift type">
            {mode === "override" ? (
              <TypePicker types={state.types} value={overrideType} onChange={setOverrideType} allowFree />
            ) : state.types.length ? (
              <TypePicker types={state.types} value={extraType} onChange={setExtraType} allowFree={false} />
            ) : (
              <p className={styles.formHint}>No shift types yet — create one on the Shift types tab first.</p>
            )}
          </FieldGroup>
        </div>
        <div className={styles.formRow}>
          <Field label="From">
            <input
              className={styles.input}
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setConfirmed(false);
                if (e.target.value > to) setTo(e.target.value);
              }}
              required
            />
          </Field>
          <Field label="To">
            <input
              className={styles.input}
              type="date"
              value={to}
              min={from}
              onChange={(e) => {
                setTo(e.target.value);
                setConfirmed(false);
              }}
              required
            />
          </Field>
        </div>
        <Field label="Note">
          <input className={styles.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        {confirmed && mode === "override" && span > 1 ? (
          <div className={styles.confirmBox} role="alert">
            <strong>Fill this date range?</strong>
            <p>
              This sets {typeName} for every day from {formatLongDate(from)} to {formatLongDate(to)}, replacing any
              existing entries in that range.
            </p>
          </div>
        ) : null}
        <ErrorLine message={error} />
      </form>
    </Modal>
  );
}

/* ---------- Entry detail ---------- */

export function EntryDetailDialog({
  entry,
  state,
  onClose,
  onOverride,
  onDeleteExtra,
}: {
  entry: ScheduleEntry;
  state: ScheduleState;
  onClose(): void;
  onOverride(): void;
  onDeleteExtra(): void;
}) {
  const type = entry.shiftType;
  const pattern = state.patterns.find((item) => item.id === entry.patternId);
  const origin =
    entry.source === "pattern"
      ? `Schedule plan · ${pattern?.name ?? "removed"}${entry.position != null ? ` · day ${entry.position + 1}` : ""}`
      : entry.source === "override"
        ? "Override"
        : "Extra shift";
  return (
    <Modal
      title="Shift details"
      size="sm"
      onClose={onClose}
      footer={
        <>
          {entry.source === "extra" ? (
            <button type="button" className={styles.dangerGhost} onClick={onDeleteExtra}>
              Delete extra
            </button>
          ) : null}
          <button type="button" className={styles.secondary} onClick={onOverride} data-autofocus>
            {entry.source === "override" ? "Edit override" : "Override this day"}
          </button>
        </>
      }
    >
      <div className={styles.detailHead}>
        <Swatch type={type} />
        <strong>{typeLabel(type)}</strong>
        {entry.source === "extra" ? <span className={styles.badge}>Extra</span> : null}
      </div>
      <dl className={styles.detailRows}>
        <div>
          <dt>Date</dt>
          <dd>{formatLongDate(entry.date)}</dd>
        </div>
        {type ? (
          <div>
            <dt>Time</dt>
            <dd>{clockLabel(type)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Owner</dt>
          <dd className={styles.detailOwner}>
            <Avatar memberId={entry.memberId} size={18} /> {memberName(entry.memberId)}
          </dd>
        </div>
        {entry.note ? (
          <div>
            <dt>Note</dt>
            <dd>{entry.note}</dd>
          </div>
        ) : null}
        <div>
          <dt>Origin</dt>
          <dd>{origin}</dd>
        </div>
      </dl>
    </Modal>
  );
}

/* ---------- Confirm ---------- */

export function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  detail: string;
  confirmLabel: string;
  onConfirm(): void;
  onClose(): void;
}) {
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={styles.secondary} onClick={onClose} data-autofocus>
            Cancel
          </button>
          <button type="button" className={cx(styles.dangerButton)} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className={styles.confirmText}>{detail}</p>
    </Modal>
  );
}
