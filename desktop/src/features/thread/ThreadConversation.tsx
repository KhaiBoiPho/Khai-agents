import { ArrowDown } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  Approval,
  ApprovalDecision,
  Item,
  Turn,
} from "../../generated/app-server";
import type { CompactionEntry, TurnPlanState } from "../../app/workspaceState";
import type { DesktopInspectorTab } from "../../app/useDesktopUi";
import { CompactionNotice } from "./CompactionNotice";
import { CitationContext } from "./citations";
import {
  requestFilePreview,
  type LineRange,
} from "../inspector/filePreviewRequests";
import {
  buildConversationTurns,
  reuseUnchangedTurns,
  type ConversationTurn,
} from "./conversationModel";
import styles from "./ThreadConversation.module.css";
import { TurnBlock } from "./TurnBlock";
import type { TranscriptMode } from "./transcriptMode";

interface ThreadConversationProps {
  turns: Turn[];
  items: Item[];
  approvals: Approval[];
  plansByTurnId: Record<string, TurnPlanState>;
  /** `/compact` runs, placed after the Turn they followed. */
  compactions?: CompactionEntry[];
  selectedItemId: string | null;
  transcriptMode: TranscriptMode;
  busy: boolean;
  planProgressExpanded?: boolean;
  onSelectItem(itemId: string): void;
  onOpenInspector(tab?: DesktopInspectorTab): void;
  onRespondToApproval(approvalId: string, decision: ApprovalDecision): void;
  onRetryTurn(turnId: string): void;
  onCancelQueuedTurn(turnId: string): void;
}

const FOLLOW_THRESHOLD = 120;

/**
 * A callback whose identity never changes but which always calls the latest
 * `handler`, so memoized Turns are not re-rendered by a parent that passes
 * inline arrows.
 */
function useStableHandler<Args extends unknown[], Result>(
  handler: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}

export function ThreadConversation({
  turns,
  items,
  approvals,
  plansByTurnId,
  compactions = [],
  selectedItemId,
  transcriptMode,
  busy,
  planProgressExpanded = false,
  onSelectItem,
  onOpenInspector,
  onRespondToApproval,
  onRetryTurn,
  onCancelQueuedTurn,
}: ThreadConversationProps) {
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [thinkingDisclosure, setThinkingDisclosure] = useState<"default" | "collapsed" | "expanded">("default");
  const previousTurnsRef = useRef<ConversationTurn[]>([]);
  const groupedTurns = useMemo(
    () => reuseUnchangedTurns(previousTurnsRef.current, buildConversationTurns(turns, items)),
    [items, turns],
  );
  useEffect(() => {
    previousTurnsRef.current = groupedTurns;
  }, [groupedTurns]);
  const handleSelectItem = useStableHandler(onSelectItem);
  const handleOpenInspector = useStableHandler(onOpenInspector);
  const handleRespondToApproval = useStableHandler(onRespondToApproval);
  const handleRetryTurn = useStableHandler(onRetryTurn);
  const handleCancelQueuedTurn = useStableHandler(onCancelQueuedTurn);
  const toggleActivity = useCallback(
    () => setThinkingDisclosure((mode) => mode === "collapsed" ? "expanded" : "collapsed"),
    [],
  );
  const compactionsAfter = useMemo(() => {
    const known = new Set(groupedTurns.map((group) => group.id));
    const placed = new Map<string, CompactionEntry[]>();
    const trailing: CompactionEntry[] = [];
    for (const entry of compactions) {
      if (entry.afterTurnId && known.has(entry.afterTurnId)) {
        placed.set(entry.afterTurnId, [
          ...(placed.get(entry.afterTurnId) ?? []),
          entry,
        ]);
      } else {
        // Still running (no anchor yet) or anchored to an unloaded Turn.
        trailing.push(entry);
      }
    }
    return { placed, trailing };
  }, [compactions, groupedTurns]);
  const approvalsByItem = useMemo(
    () => new Map(approvals.map((approval) => [approval.itemId, approval])),
    [approvals],
  );
  const activeTurn = useMemo(
    () =>
      [...turns]
        .reverse()
        .find(
          (turn) =>
            turn.status === "queued" ||
            turn.status === "running" ||
            turn.status === "waiting_approval",
        ) ?? null,
    [turns],
  );
  const activePlan = activeTurn ? plansByTurnId[activeTurn.id] ?? null : null;
  const latestItem = items.at(-1);
  // An Item is replaced, never mutated, when it changes, so its identity (and
  // its payload's) stands in for serializing the payload on every render.
  const itemUpdate = latestItem
    ? `${latestItem.id}:${latestItem.status}:${latestItem.updatedAt}`
    : `${turns.at(-1)?.id ?? "empty"}:${turns.at(-1)?.status ?? "idle"}`;
  const latestPayload = latestItem?.payload;
  const latestCompaction = compactions.at(-1);
  const latestUpdate = `${itemUpdate}:${activePlan?.updatedAt ?? "no-plan"}:${latestCompaction ? `${latestCompaction.id}:${latestCompaction.status}` : "no-compaction"}`;
  const followFrameRef = useRef<number | null>(null);
  const scrollToLatest = useCallback((behavior: ScrollBehavior) => {
    const viewport = scrollViewportRef.current;
    if (typeof viewport?.scrollTo === "function") {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
      return;
    }
    const end = endRef.current;
    if (typeof end?.scrollIntoView === "function") {
      end.scrollIntoView({ block: "end", behavior });
    }
  }, []);

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const handleScroll = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const nearBottom = distanceFromBottom <= FOLLOW_THRESHOLD;
      followingRef.current = nearBottom;
      setShowJumpToLatest(!nearBottom);
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, []);

  // Following a stream: jump (not smooth-scroll) to the end, at most once per
  // frame. A smooth scroll restarted on every token never settles.
  useEffect(() => {
    if (!followingRef.current) return;
    if (typeof window.requestAnimationFrame !== "function") {
      scrollToLatest("auto");
      return;
    }
    if (followFrameRef.current !== null) return;
    followFrameRef.current = window.requestAnimationFrame(() => {
      followFrameRef.current = null;
      if (followingRef.current) scrollToLatest("auto");
    });
  }, [latestItem?.status, latestPayload, latestUpdate, scrollToLatest]);

  useEffect(
    () => () => {
      if (followFrameRef.current !== null) {
        window.cancelAnimationFrame(followFrameRef.current);
        followFrameRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (planProgressExpanded && followingRef.current) {
      scrollToLatest("smooth");
    }
  }, [planProgressExpanded, scrollToLatest]);

  const jumpToLatest = () => {
    followingRef.current = true;
    setShowJumpToLatest(false);
    scrollToLatest("smooth");
  };

  // A citation in a reply (【file:12-30】) opens that file at those lines.
  const openCitation = useCallback(
    (path: string, lines: LineRange) => {
      requestFilePreview(path, lines);
      handleOpenInspector("files");
    },
    [handleOpenInspector],
  );

  if (groupedTurns.length === 0) {
    return (
      <div className={styles.conversationFrame}>
        <div className={styles.conversationScroller}>
          {/* Empty threads show the centered composer and its greeting. */}
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.conversationFrame}
      data-plan-active={Boolean(activePlan)}
      data-plan-expanded={planProgressExpanded || undefined}
    >
      <div
        className={styles.conversationScroller}
        aria-label="Thread conversation"
        ref={scrollViewportRef}
      >
        <div className={styles.conversation}>
          <CitationContext.Provider value={openCitation}>
            {groupedTurns.map((group) => (
              <Fragment key={group.id}>
                <TurnBlock
                  group={group}
                  approvalsByItem={approvalsByItem}
                  selectedItemId={selectedItemId}
                  transcriptMode={transcriptMode}
                  thinkingCollapsed={thinkingDisclosure === "collapsed"}
                  thinkingExpanded={thinkingDisclosure === "expanded"}
                  onToggleActivity={toggleActivity}
                  busy={busy}
                  onSelectItem={handleSelectItem}
                  onOpenInspector={handleOpenInspector}
                  onRespondToApproval={handleRespondToApproval}
                  onRetryTurn={handleRetryTurn}
                  onCancelQueuedTurn={handleCancelQueuedTurn}
                />
                {compactionsAfter.placed.get(group.id)?.map((entry) => (
                  <CompactionNotice key={entry.id} entry={entry} />
                ))}
              </Fragment>
            ))}
          </CitationContext.Provider>
          {compactionsAfter.trailing.map((entry) => (
            <CompactionNotice key={entry.id} entry={entry} />
          ))}
          <div className={styles.conversationEnd} ref={endRef} />
        </div>
      </div>

      {showJumpToLatest ? (
        <button
          type="button"
          className={styles.jumpToLatest}
          onClick={jumpToLatest}
        >
          <ArrowDown size={14} />
          Latest
        </button>
      ) : null}
    </div>
  );
}
