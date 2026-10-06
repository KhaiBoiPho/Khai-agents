import { CalendarClock, CalendarPlus, ChevronDown, Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";

import { addDays, formatDayMonth, formatLongDate, WEEKDAY_SHORT, weekdayIndex } from "../dates";
import { cx, memberName } from "../labels";
import { shiftColor, type ExtraShift, type Override, type Pattern, type ScheduleState } from "../model";
import { cycleDayDate, groupConsecutive, resolveEntries, resolveWinningPatternId, typeLabel, type DayGroup } from "../occurrences";
import { savePatternDays } from "../scheduleStore";
import styles from "../SchedulePage.module.css";
import { Avatar, EmptyState, Swatch, TypePicker } from "./ui";

type Apply = (edit: (state: ScheduleState) => ScheduleState) => string | null;

interface DraftRow {
  key: string;
  position: number;
  shiftTypeId: string | null;
}

let draftSeq = 0;
const draftKey = () => `row-${(draftSeq += 1)}`;

function CyclePreview({ pattern, state, today }: { pattern: Pattern; state: ScheduleState; today: string }) {
  const length = Math.min(Math.max(pattern.cycleLength, 14), 28);
  const strip = useMemo(() => {
    const types = new Map(state.types.map((type) => [type.id, type]));
    const { entries } = resolveEntries({
      from: today,
      to: addDays(today, length - 1),
      memberId: pattern.memberId,
      patterns: [{ ...pattern, active: true }],
      overrides: [],
      types,
    });
    return Array.from({ length }, (_, index) => {
      const date = addDays(today, index);
      return { date, entries: entries.filter((entry) => entry.date === date) };
    });
  }, [pattern, state.types, today, length]);
  return (
    <div className={styles.cycleStrip} aria-label={`Next ${length} days`}>
      {strip.map(({ date, entries }) => {
        const type = entries.find((entry) => entry.shiftType)?.shiftType ?? null;
        return (
          <span
            key={date}
            className={cx(styles.cycleCell, !entries.length && styles.cycleOutside, !type && entries.length > 0 && styles.cycleFree)}
            style={type ? ({ "--shift": shiftColor(type.color) } as CSSProperties) : undefined}
            title={`${formatLongDate(date)} · ${entries.length ? entries.map((entry) => typeLabel(entry.shiftType)).join(", ") : "Outside the plan"}`}
          >
            {type ? type.shortCode || type.name.slice(0, 1) : ""}
          </span>
        );
      })}
    </div>
  );
}

function PatternCard({
  pattern,
  state,
  apply,
  today,
  onEdit,
  onDelete,
  onNotice,
}: {
  pattern: Pattern;
  state: ScheduleState;
  apply: Apply;
  today: string;
  onEdit(): void;
  onDelete(): void;
  onNotice(message: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftRow[] | null>(null);
  const rows: DraftRow[] =
    draft ?? pattern.days.map((day) => ({ key: day.id, position: day.position, shiftTypeId: day.shiftTypeId }));
  const winning = resolveWinningPatternId(state.patterns, pattern.memberId, today);
  const edit = (next: DraftRow[]) => setDraft(next);

  const save = () => {
    const failure = apply((current) => savePatternDays(current, pattern.id, rows));
    if (failure) onNotice(failure);
    else {
      setDraft(null);
      onNotice("Cycle days saved.");
    }
  };

  const validity =
    pattern.validFrom || pattern.validUntil
      ? `${pattern.validFrom ? formatDayMonth(pattern.validFrom) : "…"} – ${pattern.validUntil ? formatDayMonth(pattern.validUntil) : "open"}`
      : "Open-ended";

  return (
    <article className={cx(styles.patternCard, !pattern.active && styles.inactive)}>
      <header className={styles.patternHead}>
        <button
          type="button"
          className={styles.patternToggle}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronDown size={14} className={styles.chevron} />
          <Avatar memberId={pattern.memberId} size={22} />
          <span className={styles.patternTitle}>
            <strong>{pattern.name}</strong>
            <small>
              {memberName(pattern.memberId)} · {pattern.kind === "timetable" ? (pattern.cycleLength === 14 ? "Week A / week B" : "Weekly timetable") : `${pattern.cycleLength}-day rotation`} · {validity}
            </small>
          </span>
        </button>
        {winning === pattern.id ? <span className={styles.badgeAccent}>Takes precedence</span> : null}
        {!pattern.active ? <span className={styles.badge}>Paused</span> : null}
        {draft ? <span className={styles.badgeAttention}>Unsaved</span> : null}
        <div className={styles.rowActions}>
          <button type="button" className={styles.iconButton} aria-label={`Edit ${pattern.name}`} onClick={onEdit}>
            <Pencil size={14} />
          </button>
          <button type="button" className={styles.iconButton} aria-label={`Delete ${pattern.name}`} onClick={onDelete}>
            <Trash2 size={14} />
          </button>
        </div>
      </header>
      <CyclePreview pattern={pattern} state={state} today={today} />
      {open ? (
        <div className={styles.patternBody}>
          <p className={styles.formHint}>
            {pattern.cycleLength === 1
              ? "The cycle repeats every day from its start."
              : `The cycle repeats every ${pattern.cycleLength} days from ${formatLongDate(pattern.anchorDate)} — days before it follow the same rhythm backwards.`}
          </p>
          <div className={styles.cycleDays}>
            {Array.from({ length: pattern.cycleLength }, (_, position) => {
              const date = cycleDayDate(pattern, position + 1, today);
              const dayRows = rows.filter((row) => row.position === position);
              const heading =
                pattern.kind === "timetable"
                  ? `${pattern.cycleLength === 14 ? (position < 7 ? "A · " : "B · ") : ""}${WEEKDAY_SHORT[position % 7]}`
                  : `Day ${position + 1}`;
              return (
                <div key={position} className={styles.cycleDay}>
                  <span className={styles.cycleDayHead}>
                    <strong>{heading}</strong>
                    <small>
                      {pattern.kind === "timetable" ? "" : `${WEEKDAY_SHORT[weekdayIndex(date)]} `}
                      {formatDayMonth(date)}
                    </small>
                  </span>
                  {dayRows.length ? (
                    dayRows.map((row) => (
                      <div key={row.key} className={styles.cycleRow}>
                        <TypePicker
                          types={state.types}
                          value={row.shiftTypeId}
                          allowFree
                          label={`Shift on ${heading}`}
                          onChange={(id) =>
                            edit(rows.map((item) => (item.key === row.key ? { ...item, shiftTypeId: id } : item)))
                          }
                        />
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={`Remove shift on ${heading}`}
                          onClick={() => edit(rows.filter((item) => item.key !== row.key))}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <span className={styles.cycleEmpty}>Free</span>
                  )}
                  <button
                    type="button"
                    className={styles.addRow}
                    disabled={!state.types.length}
                    onClick={() =>
                      edit([...rows, { key: draftKey(), position, shiftTypeId: state.types[0]?.id ?? null }])
                    }
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>
              );
            })}
          </div>
          <div className={styles.patternFoot}>
            <button type="button" className={styles.secondary} disabled={!draft} onClick={() => setDraft(null)}>
              Discard
            </button>
            <button type="button" className={styles.primaryButton} disabled={!draft} onClick={save}>
              Save cycle days
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function GroupRow<T extends Override | ExtraShift>({
  group,
  state,
  extra,
  onEdit,
  onDelete,
}: {
  group: DayGroup<T>;
  state: ScheduleState;
  extra?: boolean;
  onEdit(): void;
  onDelete(): void;
}) {
  const type = state.types.find((item) => item.id === group.shiftTypeId) ?? null;
  const span = group.from === group.to ? formatLongDate(group.from) : `${formatLongDate(group.from)} – ${formatLongDate(group.to)}`;
  return (
    <li className={styles.groupRow}>
      <Swatch type={type} />
      <Avatar memberId={group.memberId} size={20} />
      <span className={styles.groupMain}>
        <strong>{span}</strong>
        <small>{[memberName(group.memberId), typeLabel(type), group.note].filter(Boolean).join(" · ")}</small>
      </span>
      {extra ? <span className={styles.badge}>Extra</span> : null}
      {group.ids.length > 1 ? <span className={styles.badge}>{group.ids.length} days</span> : null}
      <div className={styles.rowActions}>
        <button type="button" className={styles.iconButton} aria-label={`Edit ${span}`} onClick={onEdit}>
          <Pencil size={14} />
        </button>
        <button type="button" className={styles.iconButton} aria-label={`Delete ${span}`} onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}

export function PlanningView({
  state,
  apply,
  today,
  onNewPattern,
  onEditPattern,
  onDeletePattern,
  onNewOccurrence,
  onEditOverride,
  onDeleteOverride,
  onEditExtra,
  onDeleteExtra,
  onGoToTypes,
  onNotice,
}: {
  state: ScheduleState;
  apply: Apply;
  today: string;
  onNewPattern(): void;
  onEditPattern(pattern: Pattern): void;
  onDeletePattern(pattern: Pattern): void;
  onNewOccurrence(mode: "override" | "extra"): void;
  onEditOverride(group: DayGroup<Override>): void;
  onDeleteOverride(group: DayGroup<Override>): void;
  onEditExtra(group: DayGroup<ExtraShift>): void;
  onDeleteExtra(group: DayGroup<ExtraShift>): void;
  onGoToTypes(): void;
  onNotice(message: string): void;
}) {
  const overrideGroups = useMemo(() => groupConsecutive(state.overrides), [state.overrides]);
  const extraGroups = useMemo(
    () => groupConsecutive(state.extras.map((extra) => ({ ...extra, shiftTypeId: extra.shiftTypeId as string | null }))),
    [state.extras],
  );

  // With no shift type and nothing planned, every form below dead-ends; offer
  // one way forward instead of three empty sections.
  if (!state.types.length && !state.patterns.length && !state.overrides.length && !state.extras.length) {
    return (
      <section className={styles.view}>
        <EmptyState
          icon={<CalendarClock size={20} />}
          title="Add a shift type first"
          description="Schedules, exceptions and extra shifts build on shift types — such as an early shift, a focus block or vacation."
          action={
            <button type="button" className={styles.primaryButton} onClick={onGoToTypes}>
              Go to shift types
            </button>
          }
        />
      </section>
    );
  }

  const patterns = [...state.patterns].sort(
    (a, b) => a.memberId.localeCompare(b.memberId) || a.name.localeCompare(b.name),
  );

  return (
    <section className={styles.view}>
      <div className={styles.sectionHead}>
        <h2>Schedule plans</h2>
        <button type="button" className={styles.ghostButton} onClick={onNewPattern}>
          <Plus size={14} /> New plan
        </button>
      </div>
      {patterns.length ? (
        <div className={styles.patternList}>
          {patterns.map((pattern) => (
            <PatternCard
              key={`${pattern.id}-${pattern.cycleLength}`}
              pattern={pattern}
              state={state}
              apply={apply}
              today={today}
              onEdit={() => onEditPattern(pattern)}
              onDelete={() => onDeletePattern(pattern)}
              onNotice={onNotice}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Layers size={20} />}
          title="No schedule plan yet"
          description="Create a repeating shift cycle or a weekly timetable for someone."
          action={
            <button type="button" className={styles.primaryButton} onClick={onNewPattern}>
              New plan
            </button>
          }
        />
      )}

      <div className={styles.sectionHead}>
        <h2>Overrides</h2>
        <button type="button" className={styles.ghostButton} onClick={() => onNewOccurrence("override")}>
          <Plus size={14} /> Add override
        </button>
      </div>
      {overrideGroups.length ? (
        <ul className={styles.groupList}>
          {overrideGroups.map((group) => (
            <GroupRow
              key={group.ids[0]}
              group={group}
              state={state}
              onEdit={() => onEditOverride(group)}
              onDelete={() => onDeleteOverride(group)}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<CalendarClock size={20} />}
          title="No exceptions yet"
          description="Mark a day — or a whole range — as free or on a specific shift."
        />
      )}

      <div className={styles.sectionHead}>
        <h2>Extra shifts</h2>
        <button type="button" className={styles.ghostButton} onClick={() => onNewOccurrence("extra")} disabled={!state.types.length}>
          <Plus size={14} /> Add extra shift
        </button>
      </div>
      {extraGroups.length ? (
        <ul className={styles.groupList}>
          {extraGroups.map((group) => (
            <GroupRow
              key={group.ids[0]}
              group={group as DayGroup<ExtraShift>}
              state={state}
              extra
              onEdit={() => onEditExtra(group as DayGroup<ExtraShift>)}
              onDelete={() => onDeleteExtra(group as DayGroup<ExtraShift>)}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<CalendarPlus size={20} />}
          title="No extra shifts yet"
          description="Add an extra shift for a day that already has one — on-call alongside a regular shift, for example."
        />
      )}
    </section>
  );
}
