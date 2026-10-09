import { ArrowDown } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
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
import { buildConversationTurns } from "./conversationModel";
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
  const groupedTurns = useMemo(
    () => buildConversationTurns(turns, items),
    [items, turns],
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
  const itemUpdate = latestItem
    ? `${latestItem.id}:${latestItem.status}:${latestItem.updatedAt}:${JSON.stringify(latestItem.payload).length}`
    : `${turns.at(-1)?.id ?? "empty"}:${turns.at(-1)?.status ?? "idle"}`;
  const latestCompaction = compactions.at(-1);
  const latestUpdate = `${itemUpdate}:${activePlan?.updatedAt ?? "no-plan"}:${latestCompaction ? `${latestCompaction.id}:${latestCompaction.status}` : "no-compaction"}`;
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

  useEffect(() => {
    if (!followingRef.current) return;
    scrollToLatest(latestItem?.status === "in_progress" ? "smooth" : "auto");
  }, [latestItem?.status, latestUpdate, scrollToLatest]);

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
          {groupedTurns.map((group) => (
            <Fragment key={group.id}>
              <TurnBlock
                group={group}
                approvalsByItem={approvalsByItem}
                selectedItemId={selectedItemId}
                transcriptMode={transcriptMode}
                thinkingCollapsed={thinkingDisclosure === "collapsed"}
                thinkingExpanded={thinkingDisclosure === "expanded"}
                onToggleActivity={() => setThinkingDisclosure((mode) => mode === "collapsed" ? "expanded" : "collapsed")}
                busy={busy}
                onSelectItem={onSelectItem}
                onOpenInspector={onOpenInspector}
                onRespondToApproval={onRespondToApproval}
                onRetryTurn={onRetryTurn}
                onCancelQueuedTurn={onCancelQueuedTurn}
              />
              {compactionsAfter.placed.get(group.id)?.map((entry) => (
                <CompactionNotice key={entry.id} entry={entry} />
              ))}
            </Fragment>
          ))}
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
