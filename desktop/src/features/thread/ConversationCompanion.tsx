import { ArrowDownToLine, ArrowUp, FileText, Loader2, MessageCircle, Plus, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { initialWorkspaceState, workspaceReducer } from "../../app/workspaceState";
import { ThreadEventStream } from "../../app/threadEventStream";
import { presentItem } from "../execution/itemPresentation";
import type { Thread, Turn, Item, Event } from "../../generated/app-server";
import type { ClientRuntime, AnyRpcNotification } from "../../rpc/contracts";
import { MarkdownContent } from "./MarkdownContent";
import { CompanionResizer } from "./CompanionResizer";
import styles from "./ConversationCompanion.module.css";
import { ThreadNotesPanel } from "./ThreadNotesPanel";
import {
  companionLabel,
  companionsOf,
  companionTitle,
  lastCursor,
  mainChatBlock,
  visibleQuestion,
} from "./companionContext";

interface Props {
  runtime: ClientRuntime;
  thread: Thread;
  turns: Turn[];
  items: Item[];
  width: number;
  onResize(width: number): void;
  onClose(): void;
}

const SUGGESTIONS = [
  "Tóm tắt nhanh cuộc trò chuyện này",
  "File vừa tạo có nội dung gì?",
  "Những quyết định chính là gì?",
];

/** The companion id the panel last showed for a parent; a convenience only. */
const LAST_OPEN_PREFIX = "deepcode.desktop.companion.open.";

function rememberOpen(parentId: string, childId: string | null): void {
  try {
    if (childId) localStorage.setItem(`${LAST_OPEN_PREFIX}${parentId}`, childId);
    else localStorage.removeItem(`${LAST_OPEN_PREFIX}${parentId}`);
  } catch { /* storage may be unavailable; the list still comes from the server */ }
}

function lastOpen(parentId: string): string | null {
  try { return localStorage.getItem(`${LAST_OPEN_PREFIX}${parentId}`); } catch { return null; }
}

function isMissingThread(reason: unknown): boolean {
  const text = reason instanceof Error ? reason.message : String(reason);
  return /not[ _]found|thread_not_found|unknown thread/i.test(text);
}

export function ConversationCompanion({ runtime, thread, turns, items, width, onResize, onClose }: Props) {
  // Companion sessions live on the server as child threads of this chat, so
  // they follow the user to any browser, like the main chat itself.
  const [companions, setCompanions] = useState<Thread[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "notes">("chat");
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const refresh = useCallback(async () => {
    try {
      const { threads } = await runtime.request("thread/list", { projectId: thread.projectId, limit: 500 });
      const found = companionsOf(thread, threads);
      setCompanions(found);
      setListError(null);
      return found;
    } catch (reason) {
      setCompanions((current) => current ?? []);
      setListError(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
  }, [runtime, thread]);

  useEffect(() => {
    let alive = true;
    // refresh() sets state only after its request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().then((found) => {
      if (!alive || !found) return;
      const remembered = lastOpen(thread.id);
      setActiveId(found.find((entry) => entry.id === remembered)?.id ?? found[0]?.id ?? null);
    });
    return () => { alive = false; };
    // Load once per parent chat; refresh() runs again after sends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const select = (id: string | null) => {
    setActiveId(id);
    rememberOpen(thread.id, id);
  };

  const remove = async (companion: Thread, label: string) => {
    if (!window.confirm(`Xoá chat phụ "${label}"? Không thể hoàn tác.`)) return;
    try {
      await runtime.request("thread/delete", { threadId: companion.id });
    } catch (reason) {
      if (!isMissingThread(reason)) {
        setListError(reason instanceof Error ? reason.message : String(reason));
        return;
      }
    }
    const rest = (companions ?? []).filter((entry) => entry.id !== companion.id);
    setCompanions(rest);
    if (activeId === companion.id) select(rest[0]?.id ?? null);
  };

  // Stable: the session's stream effect depends on these.
  const onCreated = useCallback((created: Thread) => {
    setCompanions((current) => [created, ...(current ?? []).filter((entry) => entry.id !== created.id)]);
    setActiveId(created.id);
    rememberOpen(thread.id, created.id);
  }, [thread.id]);

  // A companion deleted elsewhere drops out; its panel becomes a new one.
  const onMissing = useCallback((missingId: string) => {
    setCompanions((current) => (current ?? []).filter((entry) => entry.id !== missingId));
    setActiveId((current) => (current === missingId ? null : current));
  }, []);

  const onSent = useCallback(() => { void refresh(); }, [refresh]);

  return (
    <aside className={styles.panel} data-companion-panel="true" aria-label="Hỏi về cuộc trò chuyện">
      <CompanionResizer width={width} onResize={onResize} />
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.headingIcon}><MessageCircle size={15} /></span>
          <div>
            <strong>{activeTab === "chat" ? "Hỏi phụ" : "Ghi chú chat"}</strong>
            <small>{thread.title || "Cuộc trò chuyện hiện tại"}</small>
          </div>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Đóng khung hỏi phụ" title="Đóng · Esc"><X size={17} /></button>
      </header>
      <nav className={styles.tabs} aria-label="Công cụ chat">
        <button type="button" className={styles.tab} data-active={activeTab === "chat"} onClick={() => setActiveTab("chat")}><MessageCircle size={14} /> Hỏi phụ</button>
        <button type="button" className={styles.tab} data-active={activeTab === "notes"} onClick={() => setActiveTab("notes")}><FileText size={14} /> Ghi chú</button>
      </nav>

      <div className={styles.chatHost} hidden={activeTab !== "chat"}>
        <div className={styles.sessions} role="tablist" aria-label="Các chat phụ">
          <button
            type="button"
            className={styles.newSession}
            data-active={activeId === null || undefined}
            onClick={() => select(null)}
            title="Chat phụ mới"
          >
            <Plus size={14} /> Mới
          </button>
          {companions === null ? <span className={styles.sessionsLoading}><Loader2 size={13} className={styles.spin} /> Đang tải…</span> : null}
          {(companions ?? []).map((companion, index) => {
            const label = companionLabel(thread, companion, (companions?.length ?? 0) - 1 - index);
            const active = companion.id === activeId;
            return (
              <span key={companion.id} className={styles.session} data-active={active || undefined}>
                <button type="button" role="tab" aria-selected={active} onClick={() => select(companion.id)} title={label}>
                  {label}
                </button>
                <button type="button" className={styles.sessionClose} onClick={() => void remove(companion, label)} aria-label={`Xoá chat phụ ${label}`} title="Xoá chat phụ">
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
        {listError ? <p className={styles.error} role="alert">{listError}</p> : null}
        <CompanionSession
          key={activeId ?? "new"}
          runtime={runtime}
          parent={thread}
          turns={turns}
          items={items}
          childId={activeId}
          visible={activeTab === "chat"}
          onCreated={onCreated}
          onMissing={onMissing}
          onSent={onSent}
        />
      </div>
      <div className={styles.notesHost} hidden={activeTab !== "notes"}><ThreadNotesPanel threadId={thread.id} threadTitle={thread.title || "Cuộc trò chuyện"} /></div>
    </aside>
  );
}

interface SessionProps {
  runtime: ClientRuntime;
  parent: Thread;
  turns: Turn[];
  items: Item[];
  /** Null starts a new companion with the first question. */
  childId: string | null;
  visible: boolean;
  onCreated(thread: Thread): void;
  onMissing(threadId: string): void;
  onSent(): void;
}

/** One companion conversation: its stream, messages and composer. */
function CompanionSession({ runtime, parent, turns, items, childId, visible, onCreated, onMissing, onSent }: SessionProps) {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);
  const [ready, setReady] = useState(childId === null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<ThreadEventStream | null>(null);

  const messages = useMemo(() => {
    const ordered = [...state.items].sort((a, b) => a.ordinal - b.ordinal);
    return ordered.flatMap((item) => {
      if (item.kind !== "user_message" && item.kind !== "assistant_message") return [];
      const rawText = presentItem(item).body ?? item.summary;
      const text = item.kind === "user_message" ? visibleQuestion(rawText) : rawText;
      return text ? [{ id: item.id, role: item.kind === "user_message" ? "user" : "assistant", text }] : [];
    });
  }, [state.items]);
  // Tools the companion is running right now (reading a file, searching).
  const working = useMemo(
    () => state.items.filter((item) => item.kind === "tool_call" && item.status === "in_progress").at(-1)?.summary ?? null,
    [state.items],
  );
  const active = state.turns.some((turn) =>
    ["running", "queued", "waiting_approval"].includes(turn.status),
  );

  useEffect(() => {
    if (!childId) return;
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    const stream = new ThreadEventStream(runtime, childId, (event) => dispatch({ type: "event", event }), (reason) => {
      if (!alive) return;
      if (isMissingThread(reason)) onMissing(childId);
      else setError(reason instanceof Error ? reason.message : String(reason));
    });
    streamRef.current = stream;
    void (async () => {
      try {
        unsubscribe = await runtime.onNotification((notification: AnyRpcNotification) => {
          if (notification.method === "thread.updated" || notification.method.startsWith("turn.") || notification.method.startsWith("item.") || notification.method.startsWith("approval.")) {
            stream.receive(notification.params as Event);
          }
        });
        if (!alive) { unsubscribe?.(); return; }
        await stream.recover();
      } catch (reason) {
        if (!alive) return;
        if (isMissingThread(reason)) onMissing(childId);
        else setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
      unsubscribe?.();
      stream.stop();
      streamRef.current = null;
    };
  }, [childId, onMissing, runtime]);

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    const viewport = messagesRef.current;
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
  }, [messages.length, active, working]);

  const createChild = useCallback(async (question: string) => {
    const result = await runtime.request("thread/start", {
      projectId: parent.projectId,
      parentThreadId: parent.id,
      // Same folder as the main chat, so the companion can read its files.
      workspacePath: parent.workspacePath,
      title: companionTitle(question),
      mode: "code",
      agentPreset: "chat-companion",
      ...(parent.connectionId ? { connectionId: parent.connectionId } : {}),
      ...(parent.model ? { model: parent.model } : {}),
      ...(parent.reasoningEffort ? { reasoningEffort: parent.reasoningEffort } : {}),
      ...(parent.contextWindow ? { contextWindow: parent.contextWindow } : {}),
    });
    return result.thread;
  }, [parent, runtime]);

  const send = useCallback(async (text?: string) => {
    const question = (text ?? draft).trim();
    if (!question || sending || active || !ready) return;
    setSending(true);
    setError(null);
    try {
      const ask = async (targetId: string, cursor: string | null) => {
        const prompt = [
          mainChatBlock(parent, turns, items, cursor),
          "<question>", question, "</question>",
        ].join("\n\n");
        return runtime.request("turn/start", {
          threadId: targetId,
          prompt,
          messageId: `companion-${crypto.randomUUID()}`,
        });
      };
      let snapshot;
      if (childId) {
        try {
          snapshot = await ask(childId, lastCursor(state.items));
        } catch (reason) {
          if (!isMissingThread(reason)) throw reason;
          // Deleted elsewhere: start over in a fresh companion, full context.
          onMissing(childId);
          const created = await createChild(question);
          snapshot = await ask(created.id, null);
          onCreated(created);
          return;
        }
        dispatch({ type: "snapshot", snapshot });
        await streamRef.current?.recover();
      } else {
        const created = await createChild(question);
        await ask(created.id, null);
        // The keyed session for the new id takes over the stream.
        onCreated(created);
      }
      setDraft("");
      if (inputRef.current) inputRef.current.style.height = "42px";
      onSent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  }, [active, childId, createChild, draft, items, onCreated, onMissing, onSent, parent, ready, runtime, sending, state.items, turns]);

  const insertIntoMainChat = (text: string) => {
    window.dispatchEvent(new CustomEvent("deepcode:companion-insert", {
      detail: { threadId: parent.id, text },
    }));
  };

  const busy = sending || active;

  return (
    <>
      <div ref={messagesRef} className={styles.messages} aria-live="polite">
        {!ready ? <div className={styles.loading}><Loader2 size={16} className={styles.spin} /> Đang mở chat phụ…</div> : null}
        {ready && messages.length === 0 && !busy ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}><Sparkles size={18} /></span>
            <strong>Hỏi nhanh về chat này</strong>
            <p>Chat phụ hiểu nội dung chat chính và đọc được file trong đó, nhưng không làm thay đổi gì.</p>
            <div className={styles.suggestions}>
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => void send(suggestion)}>{suggestion}</button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((message) => <article key={message.id} className={styles.message} data-role={message.role}>
          {message.role === "assistant" ? <span className={styles.assistantAvatar} aria-hidden="true"><Sparkles size={14} /></span> : null}
          <div className={styles.bubble}>
            <MarkdownContent>{message.text}</MarkdownContent>
            {message.role === "assistant" ? <button type="button" className={styles.insert} onClick={() => insertIntoMainChat(message.text)}><ArrowDownToLine size={13} /> Chèn vào chat chính</button> : null}
          </div>
        </article>)}
        {busy ? (
          <div className={styles.thinking}>
            <Loader2 size={13} className={styles.spin} />
            {working ? <span className={styles.workingText}>{working}</span> : <>Đang trả lời<span className={styles.dots}>…</span></>}
          </div>
        ) : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </div>
      <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <textarea ref={inputRef} value={draft} onChange={(event) => { setDraft(event.target.value); const field = event.currentTarget; field.style.height = "auto"; field.style.height = `${Math.min(field.scrollHeight, 148)}px`; }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder={childId ? "Hỏi tiếp…" : "Hỏi điều gì đó về chat này…"} rows={1} aria-label="Câu hỏi về chat chính" />
        <button type="submit" disabled={!draft.trim() || busy || !ready} aria-label="Gửi câu hỏi" title="Gửi câu hỏi">{busy ? <Loader2 size={16} className={styles.spin} /> : <ArrowUp size={17} />}</button>
      </form>
    </>
  );
}
