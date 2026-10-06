/**
 * Where occurrences go on the grid: which days they touch, whether they are a
 * band across days or a block in the time grid, how overlapping blocks share
 * a column, and how many chips a month cell can show before "+N more".
 *
 * Everything here is pure so the rules that took Yuvomi several issues to get
 * right (#225, #804, #1313, #1607) stay pinned by tests.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import {
  addDays,
  datePart,
  daysBetween,
  minutesBetween,
  timePart,
  timeToMinutes,
  type DateKey,
} from "./dates";
import type { CalendarEvent, Occurrence } from "./model";
import { expandSeries } from "./recurrence";

// --- expansion ------------------------------------------------------------------

/** Every occurrence of `events` that touches [from, to]. */
export function expandEvents(events: readonly CalendarEvent[], from: DateKey, to: DateKey): Occurrence[] {
  const out: Occurrence[] = [];
  for (const event of events) {
    const startDay = datePart(event.start);
    const spanDays = Math.max(0, daysBetween(startDay, datePart(event.end)));
    // A multi-day occurrence that began before `from` still shows inside it.
    const slots = expandSeries(startDay, event.rrule, addDays(from, -spanDays), to, event.exdates);
    for (const slot of slots) {
      const shift = daysBetween(startDay, slot);
      const start = shift ? shiftValue(event.start, shift) : event.start;
      const end = shift ? shiftValue(event.end, shift) : event.end;
      const occurrence: Occurrence = {
        key: `${event.id}@${slot}`,
        event,
        slot,
        start,
        end,
        allDay: event.allDay,
        recurring: Boolean(event.rrule),
        layer: "event",
      };
      if (lastDay(occurrence) >= from && datePart(start) <= to) out.push(occurrence);
    }
  }
  return out;
}

function shiftValue(value: string, days: number): string {
  const time = timePart(value);
  const date = addDays(datePart(value), days);
  return time ? `${date}T${time}` : date;
}

// --- day membership -------------------------------------------------------------

type Span = Pick<Occurrence, "start" | "end" | "allDay">;

export function firstDay(o: Span): DateKey {
  return datePart(o.start);
}

/**
 * Last calendar day an occurrence appears on. A timed event ending exactly at
 * midnight does not occupy the next day — 21:00–24:00 is a Friday event
 * (#804). All-day ends are inclusive and exempt.
 */
export function lastDay(o: Span): DateKey {
  const start = datePart(o.start);
  const end = datePart(o.end);
  if (end <= start) return start;
  if (o.allDay || o.end.length <= 10) return end;
  return timePart(o.end) === "00:00" ? addDays(end, -1) : end;
}

export function touchesDay(o: Span, day: DateKey): boolean {
  return firstDay(o) <= day && lastDay(o) >= day;
}

export function isMultiDay(o: Span): boolean {
  return firstDay(o) !== lastDay(o);
}

/** Lasts 24 hours or more — the difference between a band and a night block (#1313). */
export function spansFullDayOrLonger(o: Span): boolean {
  if (o.allDay) return true;
  return minutesBetween(o.start, o.end) >= 24 * 60;
}

/** Drawn in the all-day row rather than the time grid. */
export function isAllDayLike(o: Span): boolean {
  return o.allDay || o.start.length <= 10 || (isMultiDay(o) && spansFullDayOrLonger(o));
}

/** Drawn as one band across its days. */
export function isBand(o: Span): boolean {
  return isMultiDay(o) && isAllDayLike(o);
}

export type SegmentKind = "all-day" | "single" | "start" | "middle" | "end";

/** What part of a multi-day occurrence `day` is, for time labels. */
export function segmentKind(o: Span, day: DateKey): SegmentKind {
  if (o.allDay || o.start.length <= 10) return "all-day";
  if (!isMultiDay(o)) return "single";
  if (day === firstDay(o)) return "start";
  if (day === lastDay(o)) return "end";
  return "middle";
}

/** "Day 2 of 3", or null for single-day occurrences. */
export function multiDayPosition(o: Span, day: DateKey): { day: number; count: number } | null {
  if (!isMultiDay(o)) return null;
  const count = daysBetween(firstDay(o), lastDay(o)) + 1;
  const index = daysBetween(firstDay(o), day) + 1;
  return index >= 1 && index <= count ? { day: index, count } : null;
}

// --- time grid ---------------------------------------------------------------------

export interface MinuteRange {
  start: number;
  end: number;
}

/**
 * Minutes since midnight, clamped to `day`. An occurrence that began earlier
 * starts at 0 here; one that ends later runs to 24:00. "Ends later" asks the
 * real end day, so 23:00–00:00 is a full hour, not a sliver (#1607).
 */
export function timeRange(o: Span, day: DateKey | null = null): MinuteRange {
  const startsEarlier = day !== null && day > firstDay(o);
  const start = startsEarlier ? 0 : timeToMinutes(timePart(o.start));
  const endsLater = day !== null && day < datePart(o.end);
  const end = o.end ? (endsLater ? 24 * 60 : timeToMinutes(timePart(o.end))) : start + 60;
  return { start, end: Math.max(end, start + 30) };
}

export interface LanePlacement {
  column: number;
  columns: number;
}

/**
 * Overlapping items share a cluster and split its width into columns.
 * Half-open: one ending exactly where the next begins does not overlap.
 * Keyed by item identity — two occurrences of one series can sit in the same
 * column after a midnight-crossing block (#1313).
 */
export function assignColumns<T>(items: readonly T[], range: (item: T) => MinuteRange): Map<T, LanePlacement> {
  const layout = new Map<T, LanePlacement>();
  const sorted = [...items].sort((a, b) => {
    const ra = range(a);
    const rb = range(b);
    return ra.start - rb.start || ra.end - rb.end;
  });
  let cluster: T[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const columnEnds: number[] = [];
    const placed: Array<[T, number]> = [];
    for (const item of cluster) {
      const r = range(item);
      let column = columnEnds.findIndex((end) => end <= r.start);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(r.end);
      } else {
        columnEnds[column] = r.end;
      }
      placed.push([item, column]);
    }
    for (const [item, column] of placed) layout.set(item, { column, columns: Math.max(1, columnEnds.length) });
  };
  for (const item of sorted) {
    const r = range(item);
    if (cluster.length && r.start >= clusterEnd) {
      flush();
      cluster = [];
    }
    cluster.push(item);
    clusterEnd = cluster.length === 1 ? r.end : Math.max(clusterEnd, r.end);
  }
  if (cluster.length) flush();
  return layout;
}

// --- bands -----------------------------------------------------------------------------

export interface Band {
  occurrence: Occurrence;
  /** Column indices within the row, inclusive and clamped to it. */
  first: number;
  last: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface BandRow {
  bands: Band[];
  laneCount: number;
  /** Lanes occupied per column (highest lane + 1). */
  depth: number[];
  /** Keys of occurrences drawn as bands, which cells leave out of their chips. */
  keys: Set<string>;
}

/** First-fit lane packing, as Yuvomi's week strip does it. */
export function packLanes(spans: ReadonlyArray<{ first: number; last: number }>): { lanes: number[]; laneCount: number } {
  const laneEnds: number[] = [];
  const lanes = spans.map(({ first, last }) => {
    let lane = laneEnds.findIndex((end) => end < first);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = last;
    return lane;
  });
  return { lanes, laneCount: laneEnds.length };
}

/**
 * Bands for one row of consecutive days (a month week or the week view).
 * Sorted by real start, then longer first, so an event arriving from the
 * previous week keeps the same order in every row.
 */
export function bandSegments(days: readonly DateKey[], occurrences: readonly Occurrence[]): BandRow {
  const rowStart = days[0]!;
  const rowEnd = days[days.length - 1]!;
  const entries = occurrences
    .filter((o) => isBand(o) && firstDay(o) <= rowEnd && lastDay(o) >= rowStart)
    .map((occurrence) => {
      const start = firstDay(occurrence);
      const end = lastDay(occurrence);
      return {
        occurrence,
        start,
        end,
        first: Math.max(0, daysBetween(rowStart, start)),
        last: Math.min(days.length - 1, daysBetween(rowStart, end)),
        continuesBefore: start < rowStart,
        continuesAfter: end > rowEnd,
      };
    })
    .sort(
      (a, b) =>
        a.start.localeCompare(b.start) ||
        daysBetween(b.start, b.end) - daysBetween(a.start, a.end) ||
        a.occurrence.key.localeCompare(b.occurrence.key),
    );
  const { lanes, laneCount } = packLanes(entries);
  const bands: Band[] = entries.map((entry, i) => ({
    occurrence: entry.occurrence,
    first: entry.first,
    last: entry.last,
    lane: lanes[i]!,
    continuesBefore: entry.continuesBefore,
    continuesAfter: entry.continuesAfter,
  }));
  const depth = days.map((_, column) =>
    bands.reduce((max, band) => (band.first <= column && column <= band.last ? Math.max(max, band.lane + 1) : max), 0),
  );
  return { bands, laneCount, depth, keys: new Set(bands.map((band) => band.occurrence.key)) };
}

// --- month overflow ------------------------------------------------------------------

export interface MonthCellInput {
  /** Chips the cell itself draws (everything but bands). */
  chips: number;
  /** Lanes of the bands covering this cell. */
  bandLanes: number[];
  depth: number;
}

export interface MonthCellFit {
  visibleChips: number;
  more: number;
}

/**
 * How much of one month week fits, given `slots` chip lines per cell.
 *
 * Bands belong to the whole row: every cell in a week is the same height, so
 * a lane that has to yield for a "+N" line yields in all seven. When anything
 * overflows, one line is reserved for "+N" and the lanes shrink to fit above
 * it; a cell never looks empty while it has chips (Yuvomi's fitMonthDayCells).
 */
export function fitMonthRow(
  cells: readonly MonthCellInput[],
  laneCount: number,
  slots: number,
): { lanesShown: number; cells: MonthCellFit[] } {
  const room = Math.max(1, slots);
  const everythingFits = cells.every((cell) => cell.depth + cell.chips <= room);
  const lanesShown = everythingFits ? laneCount : Math.min(laneCount, Math.max(0, room - 1));
  return {
    lanesShown,
    cells: cells.map((cell) => {
      const occupied = Math.min(cell.depth, lanesShown);
      const bandsShown = cell.bandLanes.filter((lane) => lane < lanesShown).length;
      const bandsHidden = cell.bandLanes.length - bandsShown;
      if (bandsHidden === 0 && occupied + cell.chips <= room) {
        return { visibleChips: cell.chips, more: 0 };
      }
      const floor = cell.chips > 0 && bandsShown === 0 ? 1 : 0;
      const visibleChips = Math.max(floor, Math.min(cell.chips, room - occupied - 1));
      return { visibleChips, more: bandsHidden + cell.chips - visibleChips };
    }),
  };
}

// --- ordering ----------------------------------------------------------------------------

/** All-day first, then by start time, then longer first, then title. */
export function compareOccurrences(a: Occurrence, b: Occurrence): number {
  const aAll = isAllDayLike(a) ? 0 : 1;
  const bAll = isAllDayLike(b) ? 0 : 1;
  return (
    aAll - bAll ||
    a.start.localeCompare(b.start) ||
    b.end.localeCompare(a.end) ||
    a.event.title.localeCompare(b.event.title)
  );
}
