import { describe, expect, it } from "vitest";

import type { Item, Thread, Turn } from "../../generated/app-server";
import { COMPANION_THREAD_PREFIX } from "../../app/chats";
import { companionLabel, companionsOf, lastCursor, mainChatBlock, visibleQuestion } from "./companionContext";

const parent = { id: "t-main", title: "Kinh tế", workspacePath: "/w/chats", projectId: "p1" } as Thread;
const turns = [{ id: "u1", ordinal: 1 }, { id: "u2", ordinal: 2 }] as Turn[];

function item(id: string, turnId: string, ordinal: number, kind: Item["kind"], text: string, status: Item["status"] = "completed"): Item {
  return { id, turnId, ordinal, kind, status, summary: text, payload: { text } } as unknown as Item;
}

const items = [
  item("a", "u1", 1, "user_message", "Vẽ sơ đồ kinh tế"),
  item("b", "u1", 2, "file_change", "Edit report.html"),
  item("c", "u1", 3, "assistant_message", "Đã tạo report.html"),
  item("d", "u2", 1, "user_message", "Dạng md"),
  item("e", "u2", 2, "assistant_message", "Đã tạo report.md"),
];

describe("mainChatBlock", () => {
  it("sends a snapshot with tool lines on the first question", () => {
    const block = mainChatBlock(parent, turns, items, null);
    expect(block).toContain('<main_chat_context through="e">');
    expect(block).toContain("• Edit report.html");
    expect(block).toContain("Thư mục làm việc: /w/chats");
  });

  it("sends only what is new after the cursor", () => {
    const block = mainChatBlock(parent, turns, items, "c");
    expect(block).toContain('<main_chat_update through="e">');
    expect(block).toContain("Dạng md");
    expect(block).not.toContain("Vẽ sơ đồ");
  });

  it("sends a one-line note when nothing changed", () => {
    expect(mainChatBlock(parent, turns, items, "e")).toBe(
      '<main_chat_update through="e">(Chat chính không có gì mới.)</main_chat_update>',
    );
  });

  it("does not move the cursor past an item still streaming", () => {
    const streaming = [...items.slice(0, 4), item("e", "u2", 2, "assistant_message", "Đang", "in_progress")];
    expect(mainChatBlock(parent, turns, streaming, "c")).toContain('through="d"');
  });

  it("falls back to a snapshot when the cursor item is gone", () => {
    expect(mainChatBlock(parent, turns, items, "deleted")).toContain("<main_chat_context");
  });
});

describe("companion history", () => {
  it("reads the last cursor and hides the context from the visible question", () => {
    const prompt = `<main_chat_update through="c">x</main_chat_update>\n\n<question>\nHỏi gì?\n</question>`;
    const history = [item("q1", "x", 1, "user_message", '<main_chat_context through="a">…'), item("q2", "x", 2, "user_message", prompt)];
    expect(lastCursor(history)).toBe("c");
    expect(visibleQuestion(prompt)).toBe("Hỏi gì?");
  });

  it("finds this chat's companions, including legacy ones, newest first", () => {
    const threads = [
      { id: "1", title: `${COMPANION_THREAD_PREFIX}Câu một`, parentThreadId: "t-main", archivedAt: null, updatedAt: "2026-10-01" },
      { id: "2", title: `${COMPANION_THREAD_PREFIX}t-main:Kinh tế`, parentThreadId: null, archivedAt: null, updatedAt: "2026-10-02" },
      { id: "3", title: `${COMPANION_THREAD_PREFIX}Khác`, parentThreadId: "t-other", archivedAt: null, updatedAt: "2026-10-03" },
      { id: "4", title: "Chat thường", parentThreadId: "t-main", archivedAt: null, updatedAt: "2026-10-04" },
    ] as Thread[];
    const found = companionsOf(parent, threads);
    expect(found.map((entry) => entry.id)).toEqual(["2", "1"]);
    expect(companionLabel(parent, found[0], 0)).toBe("Chat phụ 1");
    expect(companionLabel(parent, found[1], 1)).toBe("Câu một");
  });
});
