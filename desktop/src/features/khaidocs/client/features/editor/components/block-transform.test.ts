import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { NodeSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { Columns, Column, Details, DetailsContent, DetailsSummary, Callout, MathBlock, TransclusionSource } from "@khaidocs/editor-ext";
import { turnBlockIntoColumns } from "./block-transform";
import { BlockBackground } from "../extensions/block-background";

describe("turnBlockIntoColumns", () => {
  for (const count of [2, 3, 4, 5] as const) {
    it(`keeps the selected block when converting to ${count} columns`, () => {
      const editor = new Editor({
        extensions: [StarterKit, Columns, Column],
        content: "<p>Nội dung cần giữ</p>",
      });
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));

      expect(turnBlockIntoColumns(editor, count)).toBe(true);
      const columns = editor.state.doc.firstChild!;
      expect(columns.type.name).toBe("columns");
      expect(columns.childCount).toBe(count);
      expect(columns.firstChild?.textContent).toBe("Nội dung cần giữ");
      expect(columns.lastChild?.type.name).toBe("column");
      editor.destroy();
    });
  }
});

describe("toggle heading conversion", () => {
  for (const level of [1, 2, 3, 4] as const) it(`wraps a selected paragraph as toggle heading ${level}`, () => {
    const editor = new Editor({
      extensions: [StarterKit, Details, DetailsContent, DetailsSummary],
      content: "<p>Section</p><p>Body text</p><h2>Next section</h2>",
    });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));

    expect(editor.chain().focus().setNode("heading", { level }).setDetailsHeading(level).run()).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("details");
    expect(editor.state.doc.firstChild?.firstChild?.textContent).toBe("Section");
    expect(editor.state.doc.firstChild?.firstChild?.attrs.level).toBe(level);
    expect(editor.state.doc.textContent).toContain("Body text");
    expect(editor.state.doc.textContent).toContain("Next section");
    editor.destroy();
  });
});

describe("basic Turn into commands", () => {
  const cases = [
    { label: "Heading 1", run: (editor: Editor) => editor.chain().focus().setNode("heading", { level: 1 }).run(), type: "heading" },
    { label: "Heading 4", run: (editor: Editor) => editor.chain().focus().setNode("heading", { level: 4 }).run(), type: "heading" },
    { label: "Bullet list", run: (editor: Editor) => editor.chain().focus().toggleBulletList().run(), type: "bulletList" },
    { label: "Numbered list", run: (editor: Editor) => editor.chain().focus().toggleOrderedList().run(), type: "orderedList" },
    { label: "Code", run: (editor: Editor) => editor.chain().focus().toggleCodeBlock().run(), type: "codeBlock" },
    { label: "Quote", run: (editor: Editor) => editor.chain().focus().toggleBlockquote().run(), type: "blockquote" },
    { label: "Toggle list", run: (editor: Editor) => editor.chain().focus().setDetails().run(), type: "details" },
  ];

  for (const { label, run, type } of cases) {
    it(`${label} keeps the selected text`, () => {
      const editor = new Editor({
        extensions: [StarterKit, Details, DetailsContent, DetailsSummary],
        content: "<p>Nội dung cần giữ</p>",
      });
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));

      expect(run(editor)).toBe(true);
      expect(editor.state.doc.firstChild?.type.name).toBe(type);
      expect(editor.state.doc.firstChild?.textContent).toBe("Nội dung cần giữ");
      editor.destroy();
    });
  }

  it("To-do list keeps the selected text", () => {
    const editor = new Editor({ extensions: [StarterKit, TaskList, TaskItem], content: "<p>Nội dung cần giữ</p>" });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    expect(editor.chain().focus().toggleTaskList().run()).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("taskList");
    expect(editor.state.doc.firstChild?.textContent).toBe("Nội dung cần giữ");
    editor.destroy();
  });
});

const WrapperView = () => createElement(NodeViewWrapper, null, createElement(NodeViewContent));
const AtomView = () => createElement(NodeViewWrapper);

describe("advanced Turn into commands", () => {
  it("Callout keeps the selected text", () => {
    const editor = new Editor({ extensions: [StarterKit, Callout.configure({ view: WrapperView })], content: "<p>Nội dung cần giữ</p>" });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    expect(editor.chain().focus().toggleCallout().run()).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("callout");
    expect(editor.state.doc.firstChild?.textContent).toBe("Nội dung cần giữ");
    editor.destroy();
  });

  it("Synced block keeps the selected text", () => {
    const editor = new Editor({ extensions: [StarterKit, TransclusionSource.extend({ content: "paragraph+" }).configure({ view: WrapperView })], content: "<p>Nội dung cần giữ</p>" });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    expect(editor.chain().focus().toggleTransclusionSource().run()).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("transclusionSource");
    expect(editor.state.doc.firstChild?.textContent).toBe("Nội dung cần giữ");
    editor.destroy();
  });

  it("Block equation keeps the selected expression", () => {
    const editor = new Editor({ extensions: [StarterKit, MathBlock.configure({ view: AtomView })], content: "<p>x^2+y^2</p>" });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    const selected = editor.state.selection.content().content;
    expect(editor.chain().focus().setMathBlock({ text: selected.textBetween(0, selected.size) }).run()).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("mathBlock");
    expect(editor.state.doc.firstChild?.attrs.text).toBe("x^2+y^2");
    editor.destroy();
  });
});

describe("block colors", () => {
  it("applies text and background colors to the selected block", () => {
    const editor = new Editor({
      extensions: [StarterKit, TextStyle, Color, BlockBackground],
      content: "<p>Nội dung cần giữ</p>",
    });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    expect(editor.chain().focus().setColor("#379ad3").run()).toBe(true);
    expect(editor.state.doc.firstChild?.firstChild?.marks.some((mark) => mark.attrs.color === "#379ad3")).toBe(true);
    expect(editor.chain().focus().setNodeSelection(0).updateAttributes("paragraph", { backgroundColor: "#e7f3f8" }).run()).toBe(true);
    expect(editor.state.doc.firstChild?.attrs.backgroundColor).toBe("#e7f3f8");
    editor.destroy();
  });
});
