import type { Item, Thread, Turn } from "../../generated/app-server";
import { presentItem } from "../execution/itemPresentation";
import { COMPANION_THREAD_PREFIX, isCompanionThread } from "../../app/chats";

/** First message: a snapshot of the main chat, newest part kept. */
export const SNAPSHOT_CHARS = 16_000;
/** Later messages: only what the main chat added since the last question. */
export const UPDATE_CHARS = 8_000;
/** One long message keeps its head and tail; the middle rarely matters. */
const MESSAGE_CHARS = 3_000;
const TOOL_CHARS = 160;

const TOOL_KINDS = new Set<Item["kind"]>([
  "tool_call",
  "command_execution",
  "file_change",
  "artifact",
  "error",
]);

/** `through="<item id>"` on a block marks the last main-chat item it carried. */
const CURSOR = /<main_chat_(?:context|update) through="([^"]*)"/g;

function clip(text: string, limit: number): string {
  const clean = text.trim();
  if (clean.length <= limit) return clean;
  const half = Math.floor((limit - 5) / 2);
  return `${clean.slice(0, half)} […] ${clean.slice(-half)}`;
}

/** Main-chat items in conversation order: by turn, then within the turn. */
export function orderedItems(turns: Turn[], items: Item[]): Item[] {
  const turnOrder = new Map(turns.map((turn) => [turn.id, turn.ordinal]));
  return [...items].sort(
    (a, b) =>
      (turnOrder.get(a.turnId) ?? 0) - (turnOrder.get(b.turnId) ?? 0) ||
      a.ordinal - b.ordinal,
  );
}

function line(item: Item): string | null {
  if (item.kind === "user_message" || item.kind === "assistant_message") {
    const body = presentItem(item).body ?? item.summary;
    if (!body?.trim()) return null;
    const who = item.kind === "user_message" ? "Người dùng" : "Trợ lý";
    return `${who}: ${clip(body, MESSAGE_CHARS)}`;
  }
  // Tools as one line each: enough to know a file exists and where, without
  // paying for its content. The companion reads files itself when needed.
  if (TOOL_KINDS.has(item.kind) && item.summary?.trim()) {
    const state = item.status === "failed" ? " (lỗi)" : "";
    return `• ${clip(item.summary, TOOL_CHARS)}${state}`;
  }
  return null;
}

/** The newest lines that fit the budget, oldest first. */
function fit(lines: string[], budget: number): { text: string; trimmed: boolean } {
  const kept: string[] = [];
  let size = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    size += lines[index].length + 2;
    if (size > budget && kept.length) return { text: kept.reverse().join("\n\n"), trimmed: true };
    kept.push(lines[index]);
  }
  return { text: kept.reverse().join("\n\n"), trimmed: false };
}

/** The last main-chat item id the companion has already been sent. */
export function lastCursor(companionItems: Item[]): string | null {
  let cursor: string | null = null;
  for (const item of companionItems) {
    if (item.kind !== "user_message") continue;
    const text = presentItem(item).body ?? item.summary ?? "";
    for (const match of text.matchAll(CURSOR)) cursor = match[1] || cursor;
  }
  return cursor;
}

/**
 * The main-chat block for the next companion question.
 *
 * The companion thread keeps its own history, so each question only adds
 * what changed in the main chat since the previous one. Re-sending the full
 * transcript every time would cost N copies of it by the Nth question.
 */
export function mainChatBlock(
  thread: Thread,
  turns: Turn[],
  items: Item[],
  cursor: string | null,
): string {
  const ordered = orderedItems(turns, items);
  // Point the cursor at the last finished item: one still streaming is sent
  // as it stands now and again, complete, with the next question.
  const settled = ordered.filter((item) => item.status !== "pending" && item.status !== "in_progress");
  const last = settled.at(-1)?.id ?? cursor ?? "";
  const start = cursor ? ordered.findIndex((item) => item.id === cursor) : -1;

  if (cursor && start >= 0) {
    const fresh = ordered.slice(start + 1).map(line).filter((text): text is string => Boolean(text));
    if (!fresh.length) {
      return `<main_chat_update through="${cursor}">(Chat chính không có gì mới.)</main_chat_update>`;
    }
    const { text, trimmed } = fit(fresh, UPDATE_CHARS);
    return [
      `<main_chat_update through="${last}">`,
      trimmed ? "[Phần đầu của cập nhật đã được lược bớt]" : null,
      text,
      "</main_chat_update>",
    ].filter(Boolean).join("\n");
  }

  // First question, or the cursor's item is gone from the main chat.
  const lines = ordered.map(line).filter((text): text is string => Boolean(text));
  const { text, trimmed } = fit(lines, SNAPSHOT_CHARS);
  return [
    `<main_chat_context through="${last}">`,
    `Chat chính: "${thread.title || "Cuộc trò chuyện"}". Thư mục làm việc: ${thread.workspacePath}.`,
    "Dòng bắt đầu bằng • là thao tác tool; dùng read/grep/glob để xem nội dung file khi câu hỏi cần.",
    trimmed ? "[Đoạn đầu cuộc trò chuyện đã được lược bớt]" : null,
    text || "(Chat chính chưa có tin nhắn.)",
    "</main_chat_context>",
  ].filter(Boolean).join("\n");
}

/** What the user typed, without the context block that rode along. */
export function visibleQuestion(text: string): string {
  return text.match(/<question>\s*([\s\S]*?)\s*<\/question>/)?.[1] ?? text;
}

/** Companion sessions of one main chat, newest first. */
export function companionsOf(parent: Thread, threads: Thread[]): Thread[] {
  const legacyPrefix = `${COMPANION_THREAD_PREFIX}${parent.id}:`;
  return threads
    .filter(
      (candidate) =>
        isCompanionThread(candidate) &&
        !candidate.archivedAt &&
        (candidate.parentThreadId === parent.id || candidate.title.startsWith(legacyPrefix)),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The chip label: the first question, or a numbered fallback. */
export function companionLabel(parent: Thread, companion: Thread, index: number): string {
  let label = companion.title.slice(COMPANION_THREAD_PREFIX.length);
  if (label.startsWith(`${parent.id}:`)) label = "";
  return label.trim() || `Chat phụ ${index + 1}`;
}

export function companionTitle(question: string): string {
  const words = question.replace(/\s+/g, " ").trim();
  return `${COMPANION_THREAD_PREFIX}${words.length > 42 ? `${words.slice(0, 41)}…` : words}`;
}
