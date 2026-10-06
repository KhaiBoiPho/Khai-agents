/**
 * Calendar — month, week, day and agenda views over local events, with the
 * Tasks and Schedule modules and holidays and birthdays as layers.
 *
 * TODO(backend): events live in browser storage (planner store) and the
 * layers are preview data. Google, CalDAV and Outlook sync, ICS
 * subscriptions, attachments and reminder delivery need the calendar
 * service; their controls are shown disabled as "coming soon".
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useEscapeLayer } from "../../../app/escapeLayer";
import { readScheduleOccurrences, type ScheduleOccurrence } from "../schedule/calendarFeed";
import { readCalendarTasks, type CalendarTask } from "../tasks/calendarFeed";
import { AgendaView } from "./AgendaView";
import { CalendarToolbar } from "./CalendarToolbar";
import styles from "./CalendarPage.module.css";
import { dayRange, defaultStartTime, localKey, type DateKey } from "./dates";
import { EventEditor, type EditorRequest } from "./EventEditor";
import { DayList, EmptyPane, EventDetail, ScheduleDetail, TaskDetail } from "./EventDetail";
import {
  activeFilterCount,
  createChanges,
  deleteChanges,
  moveChanges,
  passesPeople,
  updateChanges,
  useCalendarEvents,
  useCalendarPrefs,
  type CalendarView,
  type Change,
  type EventDraft,
  type Scope,
} from "./eventStore";
import { FilterPanel } from "./FilterPanel";
import { compareOccurrences, expandEvents, firstDay, lastDay } from "./layout";
import { layerOccurrences, type Occurrence } from "./model";
import { MonthView } from "./MonthView";
import { dataRange, newEventDay, periodLabel, stepCursor, stepLabels, todayInView, visibleRange } from "./periods";
import { Popover } from "./Popover";
import { ScopeDialog } from "./ScopeDialog";
import { searchEvents, SEARCH_LIMIT } from "./search";
import { SearchResults } from "./SearchResults";
import { TimeGridView } from "./TimeGridView";
import { UndoToast, type ToastState } from "./UndoToast";
import type { DayItems, ViewActions } from "./viewTypes";
import { rectOf, type AnchorRect } from "./visuals";

type DetailState =
  | { kind: "occurrence"; key: string; fallback: Occurrence; anchor: AnchorRect | null }
  | { kind: "task"; task: CalendarTask; anchor: AnchorRect | null }
  | { kind: "schedule"; entry: ScheduleOccurrence; anchor: AnchorRect | null }
  | { kind: "more"; day: DateKey; anchor: AnchorRect | null };

type ScopeRequest =
  | { action: "save"; occurrence: Occurrence; draft: EventDraft }
  | { action: "delete"; occurrence: Occurrence };

const EMPTY: DayItems = { occurrences: [], tasks: [], schedule: [] };

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest?.("input, textarea, select, [contenteditable='true'], dialog"));
}

export function CalendarPage() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = localKey(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const { events, commit, revert } = useCalendarEvents(today);
  const [prefs, updatePrefs] = useCalendarPrefs();
  // A drill-in to a day is navigation, not a setting: only the tabs persist the view.
  const [view, setView] = useState<CalendarView>(prefs.view);
  const [cursor, setCursor] = useState<DateKey>(today);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [agendaKey, setAgendaKey] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const [scope, setScope] = useState<ScopeRequest | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [filters, setFilters] = useState<{ anchor: AnchorRect | null; trigger: HTMLElement } | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  // Tasks and Schedule keep their own stores; re-read them when the window regains focus.
  const [feedTick, setFeedTick] = useState(0);
  useEffect(() => {
    const refresh = () => setFeedTick((n) => n + 1);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const weekStart = prefs.weekStart;
  const { from, to } = dataRange(view, cursor, weekStart);

  const occurrences = useMemo(() => {
    const own = expandEvents(events, from, to).filter((o) => passesPeople(o.event.attendeeIds, prefs));
    const layers = layerOccurrences(from, to, { holidays: prefs.layers.holidays, birthdays: prefs.layers.birthdays });
    return [...layers, ...own].sort(compareOccurrences);
  }, [events, from, to, prefs]);

  const tasks = useMemo(() => {
    void feedTick;
    if (!prefs.layers.tasks) return [];
    return readCalendarTasks(from, to).filter((task) => !task.done && passesPeople(task.assigneeIds, prefs));
  }, [from, to, prefs, feedTick]);

  const schedule = useMemo(() => {
    void feedTick;
    if (!prefs.layers.schedule) return [];
    return readScheduleOccurrences(from, to).filter((entry) => passesPeople(entry.memberId ? [entry.memberId] : [], prefs));
  }, [from, to, prefs, feedTick]);

  const byDay = useMemo(() => {
    const map = new Map<DateKey, DayItems>();
    for (const day of dayRange(from, to)) map.set(day, { occurrences: [], tasks: [], schedule: [] });
    for (const o of occurrences) {
      const first = firstDay(o) > from ? firstDay(o) : from;
      const last = lastDay(o) < to ? lastDay(o) : to;
      for (const day of dayRange(first, last)) map.get(day)?.occurrences.push(o);
    }
    for (const task of tasks) map.get(task.dueDate)?.tasks.push(task);
    for (const sorted of map.values()) sorted.tasks.sort((a, b) => (a.dueTime ?? "").localeCompare(b.dueTime ?? ""));
    for (const entry of schedule) map.get(entry.date)?.schedule.push(entry);
    return map;
  }, [from, to, occurrences, tasks, schedule]);

  const itemsOn = useCallback((day: DateKey) => byDay.get(day) ?? EMPTY, [byDay]);

  // --- animation: periods slide in from the side you paged to, views fade ---
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const motion = useRef<{ key: string; dir: number }>({ key: "", dir: 0 });
  const periodKey = `${view}|${visibleRange(view, cursor, weekStart).from}|${search !== null}`;
  useLayoutEffect(() => {
    const previous = motion.current.key;
    const dir = motion.current.dir;
    motion.current = { key: periodKey, dir: 0 };
    const body = bodyRef.current;
    if (!previous || previous === periodKey || !body || typeof body.animate !== "function" || prefersReducedMotion()) return;
    const sameView = previous.split("|")[0] === periodKey.split("|")[0];
    body.animate(
      sameView && dir
        ? [
            { opacity: 0.4, transform: `translateX(${dir * 18}px)` },
            { opacity: 1, transform: "none" },
          ]
        : [{ opacity: 0.4 }, { opacity: 1 }],
      { duration: sameView && dir ? 240 : 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [periodKey]);

  const goTo = useCallback(
    (day: DateKey) => {
      motion.current.dir = day > cursor ? 1 : day < cursor ? -1 : 0;
      setCursor(day);
    },
    [cursor],
  );

  const navigate = (dir: 1 | -1) => {
    setSearch(null);
    motion.current.dir = dir;
    setCursor(stepCursor(view, cursor, dir, today));
  };

  const goToday = () => {
    setSearch(null);
    goTo(today);
  };

  const chooseView = (next: CalendarView) => {
    setSearch(null);
    setDetail(null);
    setView(next);
    updatePrefs({ view: next });
  };

  const openDay = (day: DateKey) => {
    setDetail(null);
    setSearch(null);
    setView("day");
    goTo(day);
  };

  const dismissToast = useCallback(() => setToast(null), []);
  const notify = (message: string, changes?: Change[]) =>
    setToast({ id: Date.now(), message, undo: changes ? () => revert(changes) : undefined });

  const startCreate = (day?: DateKey, time?: string) => {
    const date = day ?? newEventDay(view, cursor, weekStart, today);
    setDetail(null);
    setFilters(null);
    setEditor({ mode: "create", date, time, defaultTime: defaultStartTime(date, today, now) });
  };

  const startEdit = (occurrence: Occurrence) => {
    setDetail(null);
    setEditor({ mode: "edit", occurrence, defaultTime: "09:00" });
  };

  const applySave = (occurrence: Occurrence, draft: EventDraft, how: Scope) => {
    const changes = updateChanges(events, occurrence, draft, how);
    commit(changes);
    setEditor(null);
    setScope(null);
    notify("Event saved", changes);
  };

  const applyDelete = (occurrence: Occurrence, how: Scope) => {
    const changes = deleteChanges(events, occurrence, how);
    commit(changes);
    setEditor(null);
    setScope(null);
    setDetail(null);
    setAgendaKey(null);
    notify("Event deleted", changes);
  };

  const requestDelete = (occurrence: Occurrence) => {
    if (occurrence.recurring) setScope({ action: "delete", occurrence });
    else applyDelete(occurrence, "series");
  };

  const onSave = (draft: EventDraft) => {
    if (!editor) return;
    if (editor.mode === "create") {
      const changes = createChanges(draft);
      commit(changes);
      setEditor(null);
      const day = draft.start.slice(0, 10);
      const shown = visibleRange(view, cursor, weekStart);
      if (day < shown.from || day > shown.to) goTo(day);
      notify("Event created", changes);
      return;
    }
    const occurrence = editor.occurrence!;
    if (occurrence.recurring) setScope({ action: "save", occurrence, draft });
    else applySave(occurrence, draft, "series");
  };

  const actions: ViewActions = {
    openOccurrence: (occurrence, anchor) => {
      setFilters(null);
      if (view === "agenda") {
        setAgendaKey(occurrence.key);
        return;
      }
      setDetail({ kind: "occurrence", key: occurrence.key, fallback: occurrence, anchor: rectOf(anchor) });
    },
    openTask: (task, anchor) => setDetail({ kind: "task", task, anchor: rectOf(anchor) }),
    openSchedule: (entry, anchor) => setDetail({ kind: "schedule", entry, anchor: rectOf(anchor) }),
    create: (day, time) => startCreate(day, time),
    openDay,
    showMore: (day, anchor) => setDetail({ kind: "more", day, anchor: rectOf(anchor) }),
    move: (occurrence, day) => {
      const changes = moveChanges(events, occurrence, day);
      if (!changes.length) return;
      commit(changes);
      notify("Event moved", changes);
    },
    jumpTo: goTo,
  };

  // The open detail follows edits: look the occurrence up again by key.
  const detailOccurrence =
    detail?.kind === "occurrence" ? (occurrences.find((o) => o.key === detail.key) ?? null) : null;
  const agendaOccurrence = agendaKey ? (occurrences.find((o) => o.key === agendaKey) ?? null) : null;

  // --- search ---
  const searchHits = useMemo(() => (search === null ? [] : searchEvents(events, search, today)), [events, search, today]);
  useEscapeLayer(() => setSearch(null), search !== null && !editor && !scope && !detail);

  // --- shortcuts (Google Calendar's keys, as in Yuvomi) ---
  const shortcutRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    shortcutRef.current = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (editor || scope || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      const views: Record<string, CalendarView> = { m: "month", w: "week", d: "day", a: "agenda" };
      if (key === "t") goToday();
      else if (key === "j") navigate(1);
      else if (key === "k") navigate(-1);
      else if (key === "n") startCreate();
      else if (key === "/") setSearch((current) => current ?? "");
      else if (views[key]) chooseView(views[key]!);
      else return;
      event.preventDefault();
    };
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => shortcutRef.current(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const viewProps = {
    cursor,
    today,
    nowMinutes,
    weekStart,
    scheduleDisplay: prefs.scheduleDisplay,
    itemsOn,
    selectedKey: detail?.kind === "occurrence" ? detail.key : agendaKey,
    actions,
  };
  const labels = stepLabels(view);
  const shown = visibleRange(view, cursor, weekStart);
  const closeDetail = () => setDetail(null);

  return (
    <div className={styles.page}>
      <CalendarToolbar
        view={view}
        label={periodLabel(view, cursor, weekStart)}
        prevLabel={labels.prev}
        nextLabel={labels.next}
        todayInView={todayInView(view, cursor, weekStart, today)}
        cursor={cursor}
        today={today}
        weekStart={weekStart}
        filterCount={activeFilterCount(prefs)}
        filtersOpen={Boolean(filters)}
        searchOpen={search !== null}
        onPrev={() => navigate(-1)}
        onNext={() => navigate(1)}
        onToday={goToday}
        onJump={(day) => {
          setSearch(null);
          goTo(day);
        }}
        onView={chooseView}
        onToggleFilters={(trigger) => setFilters((open) => (open ? null : { anchor: rectOf(trigger), trigger }))}
        onToggleSearch={() => setSearch((current) => (current === null ? "" : null))}
        onCreate={() => startCreate()}
      />

      {search !== null ? (
        <div className={styles.searchBar} id="cal-search" role="search">
          <input
            autoFocus
            type="search"
            aria-label="Search by title, location or note"
            placeholder="Search by title, location or note"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setSearch(null);
              }
            }}
          />
          <button type="button" className={styles.iconButton} aria-label="Close search" onClick={() => setSearch(null)}>
            <X size={15} />
          </button>
          <span className={styles.srOnly} role="status" aria-live="polite">
            {search.trim().length >= 2 ? `${Math.min(searchHits.length, SEARCH_LIMIT)} results` : ""}
          </span>
        </div>
      ) : null}

      <div
        id="cal-body"
        ref={bodyRef}
        className={styles.body}
        role="tabpanel"
        aria-labelledby={`cal-tab-${view}`}
        data-view={view}
      >
        {search !== null ? (
          <SearchResults
            query={search}
            results={searchHits.slice(0, SEARCH_LIMIT)}
            total={searchHits.length}
            today={today}
            onCreate={() => startCreate()}
            onOpen={(occurrence) => {
              setSearch(null);
              setView("day");
              goTo(occurrence.slot);
              setDetail({ kind: "occurrence", key: occurrence.key, fallback: occurrence, anchor: null });
            }}
          />
        ) : view === "month" ? (
          <MonthView {...viewProps} />
        ) : view === "week" ? (
          <TimeGridView {...viewProps} mode="week" days={dayRange(shown.from, shown.to)} />
        ) : view === "day" ? (
          <TimeGridView {...viewProps} mode="day" days={[cursor]} />
        ) : (
          <AgendaView
            {...viewProps}
            pane={
              agendaOccurrence ? (
                <EventDetail
                  occurrence={agendaOccurrence}
                  onEdit={() => startEdit(agendaOccurrence)}
                  onDelete={() => requestDelete(agendaOccurrence)}
                />
              ) : (
                <EmptyPane />
              )
            }
          />
        )}
      </div>

      {detail ? (
        <Popover anchor={detail.anchor} onClose={closeDetail} label="Details">
          {detail.kind === "occurrence" ? (
            <EventDetail
              occurrence={detailOccurrence ?? detail.fallback}
              onClose={closeDetail}
              onEdit={() => startEdit(detailOccurrence ?? detail.fallback)}
              onDelete={() => requestDelete(detailOccurrence ?? detail.fallback)}
            />
          ) : detail.kind === "task" ? (
            <TaskDetail task={detail.task} onClose={closeDetail} />
          ) : detail.kind === "schedule" ? (
            <ScheduleDetail entry={detail.entry} onClose={closeDetail} />
          ) : (
            <DayList
              day={detail.day}
              items={itemsOn(detail.day)}
              onClose={closeDetail}
              onOpenDay={() => openDay(detail.day)}
              onOpenOccurrence={(o, el) => setDetail({ kind: "occurrence", key: o.key, fallback: o, anchor: rectOf(el) })}
              onOpenTask={(task, el) => setDetail({ kind: "task", task, anchor: rectOf(el) })}
              onOpenSchedule={(entry, el) => setDetail({ kind: "schedule", entry, anchor: rectOf(el) })}
            />
          )}
        </Popover>
      ) : null}

      {filters ? (
        <Popover
          anchor={filters.anchor}
          side="below"
          width={300}
          label="Filters"
          onClose={() => setFilters(null)}
          trigger={filters.trigger}
          returnFocus={filters.trigger}
          className={styles.filtersPopover}
        >
          <FilterPanel prefs={prefs} onChange={updatePrefs} />
        </Popover>
      ) : null}

      {editor ? (
        <EventEditor
          request={editor}
          onSave={onSave}
          onClose={() => setEditor(null)}
          onDelete={editor.occurrence ? () => requestDelete(editor.occurrence!) : undefined}
        />
      ) : null}

      {scope ? (
        <ScopeDialog
          action={scope.action}
          occurrence={scope.occurrence}
          onChoose={(how) => {
            if (!how) setScope(null);
            else if (scope.action === "save") applySave(scope.occurrence, scope.draft, how);
            else applyDelete(scope.occurrence, how);
          }}
        />
      ) : null}

      {toast ? <UndoToast toast={toast} onDone={dismissToast} /> : null}
    </div>
  );
}
