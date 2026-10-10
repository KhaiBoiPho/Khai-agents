import type { Item, Turn } from "../../generated/app-server";

export interface TimelineItemEntry {
  type: "item";
  id: string;
  item: Item;
}

export interface TimelineActivityGroup {
  type: "activity_group";
  id: string;
  activityKind: "exploration";
  items: Item[];
}

export type TimelineEntry = TimelineItemEntry | TimelineActivityGroup;

export interface ConversationTurn {
  id: string;
  turn: Turn | null;
  userMessages: Item[];
  timeline: TimelineEntry[];
  completion: Item | null;
}

interface MutableConversationTurn
  extends Omit<ConversationTurn, "timeline"> {
  timelineItems: Item[];
  sortOrdinal: number;
}

function createGroup(turn: Turn): MutableConversationTurn {
  return {
    id: turn.id,
    turn,
    userMessages: [],
    timelineItems: [],
    completion: null,
    sortOrdinal: turn.ordinal,
  };
}

const groupedActivityKinds = new Set(["read", "search", "list"]);

function itemActivityKind(item: Item): string | null {
  const activity = item.payload.activity;
  if (
    typeof activity !== "object" ||
    activity === null ||
    Array.isArray(activity)
  ) {
    return null;
  }
  return typeof activity.kind === "string" ? activity.kind : null;
}

function canJoinExplorationGroup(item: Item): boolean {
  const activityKind = itemActivityKind(item);
  return activityKind !== null && groupedActivityKinds.has(activityKind);
}

function compactTimeline(items: Item[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let index = 0;

  while (index < items.length) {
    const item = items[index];
    if (!canJoinExplorationGroup(item)) {
      entries.push({ type: "item", id: item.id, item });
      index += 1;
      continue;
    }

    const adjacent: Item[] = [item];
    let cursor = index + 1;
    while (cursor < items.length && canJoinExplorationGroup(items[cursor])) {
      adjacent.push(items[cursor]);
      cursor += 1;
    }

    if (adjacent.length === 1) {
      entries.push({ type: "item", id: item.id, item });
    } else {
      entries.push({
        type: "activity_group",
        id: `exploration:${item.id}`,
        activityKind: "exploration",
        items: adjacent,
      });
    }
    index = cursor;
  }

  return entries;
}

export function buildConversationTurns(
  turns: Turn[],
  items: Item[],
): ConversationTurn[] {
  const isTurnInterruptMarker = (item: Item) =>
    item.kind === "user_message" && item.payload.source === "turn_interrupt";
  const visibleItems = items.filter((item) => !isTurnInterruptMarker(item));
  const markerOnlyTurnIds = new Set(
    items
      .filter(isTurnInterruptMarker)
      .filter(
        (marker) => !visibleItems.some((item) => item.turnId === marker.turnId),
      )
      .map((marker) => marker.turnId),
  );
  const groups = new Map(
    turns
      .filter((turn) => !markerOnlyTurnIds.has(turn.id))
      .map((turn) => [turn.id, createGroup(turn)]),
  );
  let orphanOrdinal = turns.reduce(
    (largest, turn) => Math.max(largest, turn.ordinal),
    0,
  );

  for (const item of [...visibleItems].sort((left, right) => {
    const leftTurn = groups.get(left.turnId)?.sortOrdinal ?? Number.MAX_SAFE_INTEGER;
    const rightTurn =
      groups.get(right.turnId)?.sortOrdinal ?? Number.MAX_SAFE_INTEGER;
    return leftTurn - rightTurn || left.ordinal - right.ordinal;
  })) {
    let group = groups.get(item.turnId);
    if (!group) {
      orphanOrdinal += 1;
      group = {
        id: item.turnId,
        turn: null,
        userMessages: [],
        timelineItems: [],
        completion: null,
        sortOrdinal: orphanOrdinal,
      };
      groups.set(item.turnId, group);
    }
    switch (item.kind) {
      case "user_message":
        group.userMessages.push(item);
        break;
      case "completion":
        group.completion = item;
        break;
      default:
        group.timelineItems.push(item);
    }
  }

  return [...groups.values()]
    .sort((left, right) => left.sortOrdinal - right.sortOrdinal)
    .map((group) => ({
      id: group.id,
      turn: group.turn,
      userMessages: group.userMessages,
      timeline: compactTimeline(group.timelineItems),
      completion: group.completion,
    }));
}

function sameItems(left: readonly Item[], right: readonly Item[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function sameEntry(left: TimelineEntry, right: TimelineEntry): boolean {
  if (left.type === "item" && right.type === "item") {
    return left.id === right.id && left.item === right.item;
  }
  if (left.type === "activity_group" && right.type === "activity_group") {
    return left.id === right.id && sameItems(left.items, right.items);
  }
  return false;
}

/**
 * Hands back the previous object for every Turn group (and timeline entry)
 * whose Items are unchanged, so memoized renderers skip them. Items keep
 * their identity in workspace state until they change, which is what makes
 * an identity comparison sufficient here.
 */
export function reuseUnchangedTurns(
  previous: readonly ConversationTurn[],
  next: ConversationTurn[],
): ConversationTurn[] {
  if (previous.length === 0) return next;
  const previousById = new Map(previous.map((group) => [group.id, group]));
  return next.map((group) => {
    const before = previousById.get(group.id);
    if (!before) return group;
    const previousEntries = new Map(
      before.timeline.map((entry) => [entry.id, entry]),
    );
    let timelineSame = before.timeline.length === group.timeline.length;
    const timeline = group.timeline.map((entry, index) => {
      const old = previousEntries.get(entry.id);
      const kept = old && sameEntry(old, entry) ? old : entry;
      if (kept !== before.timeline[index]) timelineSame = false;
      return kept;
    });
    if (
      timelineSame &&
      before.turn === group.turn &&
      before.completion === group.completion &&
      sameItems(before.userMessages, group.userMessages)
    ) {
      return before;
    }
    return { ...group, timeline };
  });
}

export function turnDurationSeconds(
  turn: Turn | null,
  now = Date.now(),
): number | null {
  if (!turn?.startedAt) return null;
  const start = new Date(turn.startedAt).getTime();
  const end = turn.completedAt ? new Date(turn.completedAt).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

export function formatTurnDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return `${hours}h ${minuteRemainder.toString().padStart(2, "0")}m`;
}
