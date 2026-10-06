/**
 * Schedule — rotating shift plans and fixed weekly timetables for the people
 * in this workspace and the agent: on-call rotations, focus blocks, the
 * agent's nightly maintenance window.
 *
 * Ported from Yuvomi's Schedule module (MIT, © 2026 ulsklyc).
 *
 * TODO(backend): preview data lives in browser storage. Shift-start
 * reminders, the per-member ICS feed, custom fields, holiday banners and
 * per-member write permissions need the planning service and are not ported.
 */

import { AlertTriangle, CalendarDays, Clock, Layers, Plus, Sun } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { Dropdown } from "../../../components/Dropdown";
import { LiveDot } from "../../../components/Motion";
import pageStyles from "../../pages/Pages.module.css";
import { MEMBERS } from "../shared/members";
import { ConfirmDialog, EntryDetailDialog, OccurrenceDialog, PatternDialog, ShiftTypeDialog, type OccurrenceMode } from "./components/dialogs";
import { MonthView } from "./components/MonthView";
import { PlanningView } from "./components/PlanningView";
import { ShiftTypesView } from "./components/ShiftTypesView";
import { StatisticsView } from "./components/StatisticsView";
import { Avatar } from "./components/ui";
import { WeekView } from "./components/WeekView";
import { addDays, formatDayMonth, formatLongDate, toMinutes } from "./dates";
import { cx, memberName } from "./labels";
import { shiftColor, type ExtraShift, type Override, type Pattern, type ScheduleEntry, type ShiftType } from "./model";
import { clockLabel, groupConsecutive, scheduleData, typeLabel, type DayGroup } from "./occurrences";
import { deleteExtras, deleteOverrides, deletePattern, deleteShiftType, shiftTypeInUse, todayKey, useScheduleStore } from "./scheduleStore";
import styles from "./SchedulePage.module.css";

type Tab = "week" | "month" | "planning" | "types" | "statistics";

const TABS: { id: Tab; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "planning", label: "Planning" },
  { id: "types", label: "Shift types" },
  { id: "statistics", label: "Statistics" },
];

type DialogState =
  | { kind: "type"; type?: ShiftType }
  | { kind: "pattern"; pattern?: Pattern }
  | {
      kind: "occurrence";
      mode: OccurrenceMode;
      memberId: string;
      from: string;
      overrideGroup?: DayGroup<Override>;
      extraGroup?: DayGroup<ExtraShift>;
    }
  | { kind: "entry"; entry: ScheduleEntry }
  | { kind: "confirm"; title: string; detail: string; confirmLabel: string; run(): string | null };

const MEMBER_IDS = MEMBERS.map((member) => member.id);

function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function isLive(entry: ScheduleEntry, minutes: number): boolean {
  const type = entry.shiftType;
  if (!type?.start || !type.end) return false;
  const start = toMinutes(type.start);
  const end = toMinutes(type.end);
  return end <= start ? minutes >= start : minutes >= start && minutes < end;
}

function TodayCard({ entries, today, onOpen }: { entries: ScheduleEntry[]; today: string; onOpen(entry: ScheduleEntry): void }) {
  const [minutes, setMinutes] = useState(nowMinutes);
  useEffect(() => {
    const timer = window.setInterval(() => setMinutes(nowMinutes()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const byMember = MEMBER_IDS.map((memberId) => ({
    memberId,
    entries: entries.filter((entry) => entry.memberId === memberId),
  })).filter((row) => row.entries.length);

  return (
    <section className={styles.today} aria-label="Today">
      <header>
        <Sun size={14} />
        <strong>Today</strong>
        <span>{formatLongDate(today)}</span>
      </header>
      {byMember.length ? (
        <ul>
          {byMember.map((row, index) => (
            <li key={row.memberId} style={{ "--i": index } as CSSProperties}>
              <Avatar memberId={row.memberId} size={22} />
              <span className={styles.todayName}>{memberName(row.memberId)}</span>
              <span className={styles.todayEntries}>
                {row.entries.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className={cx(styles.todayChip, !entry.shiftType && styles.todayFree)}
                    style={entry.shiftType ? ({ "--shift": shiftColor(entry.shiftType.color) } as CSSProperties) : undefined}
                    onClick={() => onOpen(entry)}
                    aria-label={`${memberName(row.memberId)}: ${typeLabel(entry.shiftType)}${entry.shiftType ? `, ${clockLabel(entry.shiftType)}` : ""}`}
                  >
                    {isLive(entry, minutes) ? <LiveDot className={styles.live} /> : null}
                    <strong>{entry.shiftType ? entry.shiftType.shortCode || entry.shiftType.name : "Free"}</strong>
                    {entry.shiftType ? <small>{clockLabel(entry.shiftType)}</small> : null}
                    {entry.source === "extra" ? <em>Extra</em> : null}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.todayEmpty}>No schedule entries today.</p>
      )}
    </section>
  );
}

export function SchedulePage() {
  const { state, apply } = useScheduleStore();
  const [today] = useState(todayKey);
  const [tab, setTab] = useState<Tab>(() => (state.types.length ? "week" : "types"));
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const notify = (text: string) => {
    window.clearTimeout(noticeTimer.current);
    setNotice({ id: Date.now(), text });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200);
  };
  const close = () => setDialog(null);
  const done = (text: string) => {
    setDialog(null);
    notify(text);
  };

  const todayEntries = useMemo(() => scheduleData(state, today, today, MEMBER_IDS).entries, [state, today]);
  // Overlaps are allowed, never silent: name them for the next eight weeks.
  const warnings = useMemo(() => {
    const raw = scheduleData(state, today, addDays(today, 55), MEMBER_IDS).warnings;
    const spans: { memberId: string; from: string; to: string }[] = [];
    for (const warning of raw) {
      const last = spans[spans.length - 1];
      if (last && last.memberId === warning.memberId && addDays(last.to, 1) === warning.date) last.to = warning.date;
      else spans.push({ memberId: warning.memberId, from: warning.date, to: warning.date });
    }
    return spans;
  }, [state, today]);

  const openDay = (memberId: string, date: string) => {
    const group = groupConsecutive(state.overrides).find(
      (item) => item.memberId === memberId && item.from <= date && item.to >= date,
    );
    setDialog({ kind: "occurrence", mode: "override", memberId, from: date, overrideGroup: group });
  };

  const confirmDelete = (title: string, detail: string, run: () => string | null) =>
    setDialog({ kind: "confirm", title, detail, confirmLabel: "Delete", run });

  return (
    <div className={cx(pageStyles.page, styles.page)}>
      <header className={cx(pageStyles.header, styles.header)}>
        <h1>Schedule</h1>
        <div className={pageStyles.tabs} role="tablist" aria-label="Schedule views">
          {TABS.map(({ id, label }) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className={pageStyles.headerActions}>
          <Dropdown
            align="end"
            triggerClassName={pageStyles.primary}
            trigger={
              <>
                <Plus size={14} /> New
              </>
            }
            triggerLabel="New schedule entry"
            sections={[
              {
                items: [
                  {
                    id: "pattern",
                    label: "Schedule plan",
                    description: "Rotation or weekly timetable",
                    icon: <Layers size={14} />,
                    onSelect: () => setDialog({ kind: "pattern" }),
                  },
                  {
                    id: "override",
                    label: "Override",
                    description: "Replace one day or a range",
                    icon: <CalendarDays size={14} />,
                    onSelect: () => setDialog({ kind: "occurrence", mode: "override", memberId: "me", from: today }),
                  },
                  {
                    id: "extra",
                    label: "Extra shift",
                    description: "Add on top of the day",
                    icon: <Plus size={14} />,
                    disabled: !state.types.length,
                    onSelect: () => setDialog({ kind: "occurrence", mode: "extra", memberId: "me", from: today }),
                  },
                  {
                    id: "type",
                    label: "Shift type",
                    description: "Name, code, times and colour",
                    icon: <Clock size={14} />,
                    onSelect: () => setDialog({ kind: "type" }),
                  },
                ],
              },
            ]}
          />
        </div>
      </header>

      <TodayCard entries={todayEntries} today={today} onOpen={(entry) => setDialog({ kind: "entry", entry })} />

      {warnings.length ? (
        <div className={styles.warnings} role="status">
          <AlertTriangle size={14} />
          <ul>
            {warnings.slice(0, 3).map((warning) => (
              <li key={`${warning.memberId}-${warning.from}`}>
                Overlapping schedules for {memberName(warning.memberId)} on{" "}
                {warning.from === warning.to
                  ? formatDayMonth(warning.from)
                  : `${formatDayMonth(warning.from)} – ${formatDayMonth(warning.to)}`}
                ; the newer schedule plan is shown.
              </li>
            ))}
            {warnings.length > 3 ? <li>and {warnings.length - 3} more.</li> : null}
          </ul>
        </div>
      ) : null}

      <div key={tab} className={styles.tabPanel} role="tabpanel" aria-label={TABS.find((item) => item.id === tab)?.label}>
        {tab === "week" ? (
          <WeekView state={state} today={today} onOpenEntry={(entry) => setDialog({ kind: "entry", entry })} />
        ) : null}
        {tab === "month" ? <MonthView state={state} today={today} onEditDay={openDay} /> : null}
        {tab === "planning" ? (
          <PlanningView
            state={state}
            apply={apply}
            today={today}
            onNotice={notify}
            onGoToTypes={() => setTab("types")}
            onNewPattern={() => setDialog({ kind: "pattern" })}
            onEditPattern={(pattern) => setDialog({ kind: "pattern", pattern })}
            onDeletePattern={(pattern) =>
              confirmDelete(
                `Delete schedule plan “${pattern.name}”?`,
                `Its ${pattern.days.length === 1 ? "one cycle day goes" : `${pattern.days.length} cycle days go`} with it. This cannot be undone.`,
                () => apply((current) => deletePattern(current, pattern.id)),
              )
            }
            onNewOccurrence={(mode) => setDialog({ kind: "occurrence", mode, memberId: "me", from: today })}
            onEditOverride={(group) =>
              setDialog({ kind: "occurrence", mode: "override", memberId: group.memberId, from: group.from, overrideGroup: group })
            }
            onDeleteOverride={(group) =>
              confirmDelete(
                "Delete this range?",
                `This removes every override for ${memberName(group.memberId)} from ${formatLongDate(group.from)} to ${formatLongDate(group.to)}. This cannot be undone.`,
                () => apply((current) => deleteOverrides(current, group.memberId, group.from, group.to)),
              )
            }
            onEditExtra={(group) =>
              setDialog({ kind: "occurrence", mode: "extra", memberId: group.memberId, from: group.from, extraGroup: group })
            }
            onDeleteExtra={(group) =>
              confirmDelete(
                "Delete this extra shift?",
                `This removes ${group.ids.length === 1 ? "the extra shift" : `${group.ids.length} extra shifts`} for ${memberName(group.memberId)}.`,
                () => apply((current) => deleteExtras(current, group.ids)),
              )
            }
          />
        ) : null}
        {tab === "types" ? (
          <ShiftTypesView
            state={state}
            apply={apply}
            onNotice={notify}
            onNew={() => setDialog({ kind: "type" })}
            onEdit={(type) => setDialog({ kind: "type", type })}
            onDelete={(type) => {
              if (shiftTypeInUse(state, type.id)) {
                notify("This shift type is still used by a schedule plan, override, or extra shift. Remove those uses first.");
                return;
              }
              confirmDelete(
                "Delete this shift type?",
                `This permanently removes ${type.name} for everyone. This cannot be undone.`,
                () => apply((current) => deleteShiftType(current, type.id)),
              );
            }}
          />
        ) : null}
        {tab === "statistics" ? <StatisticsView state={state} apply={apply} today={today} /> : null}
      </div>

      {notice ? (
        <div key={notice.id} className={styles.notice} role="status">
          {notice.text}
        </div>
      ) : null}

      {dialog?.kind === "type" ? <ShiftTypeDialog apply={apply} type={dialog.type} onClose={close} onDone={done} /> : null}
      {dialog?.kind === "pattern" ? (
        <PatternDialog
          state={state}
          apply={apply}
          pattern={dialog.pattern}
          today={today}
          defaultMember="me"
          onClose={close}
          onDone={(text) => {
            done(text);
            setTab("planning");
          }}
        />
      ) : null}
      {dialog?.kind === "occurrence" ? (
        <OccurrenceDialog
          state={state}
          apply={apply}
          mode={dialog.mode}
          memberId={dialog.memberId}
          from={dialog.from}
          overrideGroup={dialog.overrideGroup}
          extraGroup={dialog.extraGroup}
          onClose={close}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === "entry" ? (
        <EntryDetailDialog
          entry={dialog.entry}
          state={state}
          onClose={close}
          onOverride={() => openDay(dialog.entry.memberId, dialog.entry.date)}
          onDeleteExtra={() => {
            const id = dialog.entry.key.split(":")[3] ?? "";
            const failure = apply((current) => deleteExtras(current, [id]));
            done(failure ?? "Extra shift deleted.");
          }}
        />
      ) : null}
      {dialog?.kind === "confirm" ? (
        <ConfirmDialog
          title={dialog.title}
          detail={dialog.detail}
          confirmLabel={dialog.confirmLabel}
          onClose={close}
          onConfirm={() => done(dialog.run() ?? "Deleted.")}
        />
      ) : null}
    </div>
  );
}
