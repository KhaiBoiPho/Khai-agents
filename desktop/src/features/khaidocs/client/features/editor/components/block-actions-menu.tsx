import { useEffect, useMemo, useState } from "react";
import { Menu, ScrollArea, Text, TextInput } from "@mantine/core";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Copy,
  CopyPlus,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  CheckSquare,
  ChevronDown,
  Code2,
  Columns2,
  Columns3,
  Columns4,
  FileText,
  FolderOpen,
  Info,
  List,
  ListOrdered,
  Paintbrush,
  Pilcrow,
  Quote,
  RefreshCw,
  Search,
  Trash2,
  Type,
  FilePlus2,
  FolderInput,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Subscript,
  Superscript,
  IndentIncrease,
  IndentDecrease,
  Eraser,
  Undo2,
  Redo2,
  AtSign,
  Smile,
  ImagePlus,
  Table2,
  Video,
  Music2,
  FileType2,
  Paperclip,
  MoreHorizontal,
  Puzzle,
} from "lucide-react";
import type { Editor } from "@tiptap/react";
import type { CommandProps } from "@/features/editor/components/slash-menu/types";
import getSuggestionItems from "@/features/editor/components/slash-menu/menu-items";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { PAGE_INSERT_EVENT } from "@/features/editor/components/page-insert-dialog";
import { uploadImageAction } from "@/features/editor/components/image/upload-image-action";
import { uploadVideoAction } from "@/features/editor/components/video/upload-video-action";
import { uploadAudioAction } from "@/features/editor/components/audio/upload-audio-action";
import { uploadPdfAction } from "@/features/editor/components/pdf/upload-pdf-action";
import { uploadAttachmentAction } from "@/features/editor/components/attachment/upload-attachment-action";
import { turnBlockIntoColumns } from "./block-transform";

export const BLOCK_HANDLE_MENU_EVENT = "khaidocs:block-handle-menu";

interface BlockHandleMenuRequest extends CustomEvent<{ x: number; y: number; position?: number }> {}

function requestPageInsert(editor: Editor, mode: "child" | "in") {
  const selection = editor.state.selection;
  const range = selection instanceof NodeSelection ? { from: selection.from, to: selection.to } : undefined;
  const title = selection instanceof NodeSelection ? selection.node.textContent : "";
  window.dispatchEvent(new CustomEvent(PAGE_INSERT_EVENT, { detail: { editor, mode, range, title } }));
}

// Turn-into commands (setNode, toggle*List...) need a text cursor inside the
// block; the handle menu opens with the whole block node-selected, which
// makes them no-ops. Move the cursor into the block first.
function selectBlockNode(editor: Editor, position: number) {
  const node = editor.state.doc.nodeAt(position);
  if (!node || position < 0 || position + node.nodeSize > editor.state.doc.content.size) return null;
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position)));
  return node;
}

function selectBlockText(editor: Editor, position: number) {
  const node = selectBlockNode(editor, position);
  if (!node?.isTextblock) return;
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position + 1, position + node.nodeSize - 1));
  editor.view.dispatch(tr);
}

function selectBlockEnd(editor: Editor, position: number) {
  const node = selectBlockNode(editor, position);
  if (node?.isTextblock) {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position + node.nodeSize - 1)));
  }
}

function chooseFile(
  editor: Editor,
  blockPosition: number | null,
  accept: string,
  upload: (file: File, editor: Editor, pos: number, pageId: string, ...extra: any[]) => void,
  extra?: boolean,
) {
  const pageId = editor.storage?.pageId as string | undefined;
  if (!pageId || blockPosition === null) return;
  const node = selectBlockNode(editor, blockPosition);
  if (!node) return;
  const position = blockPosition + node.nodeSize;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.multiple = true;
  input.style.display = "none";
  document.body.appendChild(input);
  input.onchange = () => {
    if (input.files?.length) {
      for (const file of input.files) {
        if (extra !== undefined) upload(file, editor, position, pageId, extra);
        else upload(file, editor, position, pageId);
      }
    }
    input.remove();
  };
  input.click();
}

const formatActions = [
  { label: "Bold", icon: Bold, run: (editor: Editor) => editor.chain().focus().toggleBold().run() },
  { label: "Italic", icon: Italic, run: (editor: Editor) => editor.chain().focus().toggleItalic().run() },
  { label: "Underline", icon: Underline, run: (editor: Editor) => editor.chain().focus().toggleUnderline().run() },
  { label: "Strikethrough", icon: Strikethrough, run: (editor: Editor) => editor.chain().focus().toggleStrike().run() },
  { label: "Inline code", icon: Code, run: (editor: Editor) => editor.chain().focus().toggleCode().run() },
  { label: "Subscript", icon: Subscript, run: (editor: Editor) => editor.chain().focus().toggleSubscript().run() },
  { label: "Superscript", icon: Superscript, run: (editor: Editor) => editor.chain().focus().toggleSuperscript().run() },
  { label: "Increase indent", icon: IndentIncrease, run: (editor: Editor) => editor.chain().focus().indent().run() },
  { label: "Decrease indent", icon: IndentDecrease, run: (editor: Editor) => editor.chain().focus().outdent().run() },
  { label: "Clear formatting", icon: Eraser, run: (editor: Editor) => editor.chain().focus().unsetAllMarks().clearNodes().run() },
  { label: "Undo", icon: Undo2, run: (editor: Editor) => editor.chain().focus().undo().run() },
  { label: "Redo", icon: Redo2, run: (editor: Editor) => editor.chain().focus().redo().run() },
];

const alignmentActions = [
  { label: "Align left", icon: AlignLeft, align: "left" as const },
  { label: "Align center", icon: AlignCenter, align: "center" as const },
  { label: "Align right", icon: AlignRight, align: "right" as const },
  { label: "Justify", icon: AlignJustify, align: "justify" as const },
];

const turnIntoActions = [
  { label: "Text", icon: Type, run: (editor: Editor) => editor.chain().focus().setNode("paragraph").run() },
  { label: "Heading 1", icon: Heading1, run: (editor: Editor) => editor.chain().focus().setNode("heading", { level: 1 }).run() },
  { label: "Heading 2", icon: Heading2, run: (editor: Editor) => editor.chain().focus().setNode("heading", { level: 2 }).run() },
  { label: "Heading 3", icon: Heading3, run: (editor: Editor) => editor.chain().focus().setNode("heading", { level: 3 }).run() },
  { label: "Heading 4", icon: Heading4, run: (editor: Editor) => editor.chain().focus().setNode("heading", { level: 4 }).run() },
  { label: "Page", icon: FileText, run: (editor: Editor) => requestPageInsert(editor, "child") },
  { label: "Page in", icon: FolderOpen, run: (editor: Editor) => requestPageInsert(editor, "in") },
  { label: "Bullet list", icon: List, run: (editor: Editor) => editor.chain().focus().toggleBulletList().run() },
  { label: "Numbered list", icon: ListOrdered, run: (editor: Editor) => editor.chain().focus().toggleOrderedList().run() },
  { label: "To-do list", icon: CheckSquare, run: (editor: Editor) => editor.chain().focus().toggleTaskList().run() },
  { label: "Toggle list", icon: ChevronDown, run: (editor: Editor) => editor.chain().focus().setDetails().run() },
  { label: "Code", icon: Code2, run: (editor: Editor) => editor.chain().focus().toggleCodeBlock().run() },
  { label: "Quote", icon: Quote, run: (editor: Editor) => editor.chain().focus().toggleBlockquote().run() },
  { label: "Callout", icon: Info, run: (editor: Editor) => editor.chain().focus().toggleCallout().run() },
  { label: "Block equation", icon: Type, run: (editor: Editor) => editor.chain().focus().setMathBlock({ text: editor.state.selection.content().content.textBetween(0, editor.state.selection.content().content.size) }).run() },
  { label: "Synced block", icon: RefreshCw, run: (editor: Editor) => editor.chain().focus().toggleTransclusionSource().run() },
  ...([1, 2, 3, 4] as const).map((level) => ({ label: `Toggle heading ${level}`, icon: [Heading1, Heading2, Heading3, Heading4][level - 1], run: (editor: Editor) => editor.chain().focus().setNode("heading", { level }).setDetailsHeading(level).run() })),
  ...([2, 3, 4, 5] as const).map((count) => ({ label: `${count} columns`, icon: [Columns2, Columns3, Columns4][Math.min(count - 2, 2)], run: (editor: Editor) => turnBlockIntoColumns(editor, count) })),
];

const blockColors = [
  { label: "Default", color: "#d4d4d4" },
  { label: "Gray", color: "#9b9b9b" },
  { label: "Brown", color: "#ba856f" },
  { label: "Orange", color: "#c77d48" },
  { label: "Green", color: "#529e72" },
  { label: "Blue", color: "#379ad3" },
  { label: "Purple", color: "#9d68d3" },
  { label: "Red", color: "#df5452" },
  { label: "Yellow", color: "#eab308" },
  { label: "Pink", color: "#ba4081" },
];

const backgroundColors = [
  { label: "Default background", color: "#ffffff" },
  { label: "Gray background", color: "#f1f1ef" },
  { label: "Brown background", color: "#f4eeee" },
  { label: "Orange background", color: "#fbecdd" },
  { label: "Yellow background", color: "#fbf3db" },
  { label: "Green background", color: "#edf3ec" },
  { label: "Blue background", color: "#e7f3f8" },
  { label: "Purple background", color: "#f4f0f7" },
  { label: "Pink background", color: "#f9eef3" },
  { label: "Red background", color: "#fbe4e4" },
];

const highlightColors = [
  { label: "Blue highlight", color: "#98d8f2" },
  { label: "Green highlight", color: "#7edb6c" },
  { label: "Purple highlight", color: "#e0d6ed" },
  { label: "Red highlight", color: "#ffc6c2" },
  { label: "Yellow highlight", color: "#faf594" },
  { label: "Orange highlight", color: "#f5c8a9" },
  { label: "Pink highlight", color: "#f5cfe0" },
  { label: "Gray highlight", color: "#dfdfd7" },
  { label: "Brown highlight", color: "#d7c4b7" },
];

const sideSubmenuProps = {
  position: "right-start" as const,
  width: "min(300px, calc(100vw - 24px))",
  withinPortal: true,
  floatingStrategy: "fixed" as const,
  offset: 4,
  openDelay: 80,
  closeDelay: 140,
  safeAreaPolygon: true,
  // Keep the submenu within the viewport. On narrow screens it may open on
  // the opposite side of the parent instead of being clipped off-screen.
  // In the narrow chat notes panel (or when the browser is zoomed) neither
  // side may fit: shift along the horizontal axis too, so the submenu slides
  // inside the panel (over the parent menu) instead of being clipped.
  middlewares: {
    flip: { fallbackPlacements: ["left-start"], padding: 8 },
    shift: { mainAxis: true, crossAxis: true, padding: 8 },
  },
};

const fullWidthSubmenuTarget = { width: "100%", display: "flex" as const };
const submenuScrollProps = {
  mah: "min(460px, calc(100dvh - 48px))",
  type: "always" as const,
  scrollbarSize: 8,
  overscrollBehavior: "contain" as const,
};

// These slash commands already have equivalents in the six-dot menu above.
// Keep the remaining legacy commands available under More tools and Apps.
const sixDotCoveredCommands = new Set([
  "Page", "Page in", "Text", "To-do list", "Heading 1", "Heading 2", "Heading 3", "Heading 4",
  "Bullet list", "Numbered list", "Quote", "Code", "Callout", "Table", "Image", "Video", "Audio",
  "Embed PDF", "File attachment", "Emoji", "Toggle block", "Math block", "Synced block",
  "2 Columns", "3 Columns", "4 Columns", "5 Columns",
  "Bold", "Italic", "Underline", "Strikethrough", "Inline code", "Clear formatting",
  "Increase indent", "Decrease indent", "Toggle heading 1", "Toggle heading 2", "Toggle heading 3", "Toggle heading 4",
  "Align left", "Align center", "Align right", "Justify", "Undo", "Redo",
  "Copy link to block", "Duplicate block", "Move block up", "Move block down", "Move block to beginning", "Move block to end", "Delete block",
  "Default text color", "Default block color", "Default block background", "Remove highlight",
  "Text color: Blue", "Text color: Green", "Text color: Purple", "Text color: Red", "Text color: Yellow",
  "Text color: Orange", "Text color: Pink", "Text color: Gray", "Text color: Brown",
  "Highlight: Blue", "Highlight: Green", "Highlight: Purple", "Highlight: Red", "Highlight: Yellow",
  "Highlight: Orange", "Highlight: Pink", "Highlight: Gray", "Highlight: Brown",
  "Block color: Gray", "Block color: Brown", "Block color: Orange", "Block color: Green", "Block color: Blue",
  "Block color: Purple", "Block color: Red", "Block color: Yellow", "Block color: Pink",
  "Block background: Gray", "Block background: Brown", "Block background: Orange", "Block background: Yellow",
  "Block background: Green", "Block background: Blue", "Block background: Purple", "Block background: Pink", "Block background: Red",
]);

const appCommandTitles = new Set([
  "Iframe embed", "Airtable", "Loom", "Figma", "Typeform", "Miro", "YouTube", "Vimeo", "Framer",
  "Google Drive", "Google Sheets",
]);

export function BlockActionsMenu({ editor }: { editor: Editor }) {
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState<number | null>(null);

  useEffect(() => {
    const onRequest = (event: Event) => {
      const request = event as BlockHandleMenuRequest;
      const { x, y } = request.detail;
      const selection = editor.state.selection;
      const blockPosition = request.detail.position ?? (selection instanceof NodeSelection ? selection.from : null);
      if (blockPosition === null || !editor.state.doc.nodeAt(blockPosition)) return;
      setPosition(blockPosition);
      // The compact chat editor keeps Mantine portals inside its contained
      // KhaiDocs root. Convert the pointer to that root's local coordinates;
      // viewport coordinates would put the hidden target outside the panel and
      // make the six-dot menu seem not to open.
      const root = editor.view.dom.closest<HTMLElement>(".khaidocs-root");
      if (root?.dataset.view === "page-panel") {
        const rect = root.getBoundingClientRect();
        setAnchor({ x: x - rect.left, y: y - rect.top });
      } else {
        setAnchor({ x, y });
      }
      setQuery("");
      setOpened(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpened(false);
    };
    window.addEventListener(BLOCK_HANDLE_MENU_EVENT, onRequest);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(BLOCK_HANDLE_MENU_EVENT, onRequest);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editor]);

  // Mantine closes a Menu on mousedown outside its own dropdown, and portaled
  // submenus count as "outside". A real click (press held ~100ms) then lost
  // the menu before mouseup, so the item's onClick never fired. Handle
  // outside presses here and treat every menu dropdown as inside.
  useEffect(() => {
    if (!opened) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.("[data-menu-dropdown], .mantine-Menu-dropdown")) return;
      setOpened(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [opened]);

  const matches = (label: string) =>
    label.toLowerCase().includes(query.trim().toLowerCase());
  const selectedNode = position === null ? null : editor.state.doc.nodeAt(position);
  const selectedText = selectedNode?.textContent ?? "";
  const wordCount = selectedText.trim() ? selectedText.trim().split(/\s+/).length : 0;

  const moveToIndex = (targetIndex: number) => {
    if (position === null) return;
    const node = editor.state.doc.nodeAt(position);
    if (!node) return;
    let index = -1;
    editor.state.doc.forEach((_node, offset, childIndex) => { if (offset === position) index = childIndex; });
    if (index < 0 || targetIndex === index) return;
    const tr = editor.state.tr.delete(position, position + node.nodeSize);
    const destination = Math.max(0, Math.min(targetIndex > index ? targetIndex - 1 : targetIndex, tr.doc.childCount));
    let offset = 0;
    for (let i = 0; i < destination; i++) offset += tr.doc.child(i).nodeSize;
    editor.view.dispatch(tr.insert(offset, node));
    editor.commands.focus();
  };

  const duplicate = () => {
    if (position === null) return;
    const node = editor.state.doc.nodeAt(position);
    if (!node) return;
    editor.chain().focus().insertContentAt(position + node.nodeSize, node.toJSON()).run();
    setOpened(false);
  };

  const copyLink = async () => {
    const node = position === null ? null : editor.state.doc.nodeAt(position);
    const id = node?.attrs.id;
    const url = new URL(window.location.href);
    if (typeof id === "string" && id) url.hash = id;
    await navigator.clipboard?.writeText(url.toString());
  };

  const openPageDialog = (mode: "child" | "in") => {
    if (position !== null) selectBlockNode(editor, position);
    requestPageInsert(editor, mode);
    setOpened(false);
  };

  const filteredTurnInto = useMemo(
    () => turnIntoActions.filter((action) => matches(action.label)),
    // matches is intentionally tied to the query string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query],
  );
  const filteredFormat = formatActions.filter((action) => matches(action.label));
  const filteredAlignment = alignmentActions.filter((action) => matches(action.label));
  const filteredColors = blockColors.filter((color) => matches(color.label));
  const filteredBackgrounds = backgroundColors.filter((color) => matches(color.label));
  const filteredHighlights = highlightColors.filter((color) => matches(color.label));
  const legacyCommands = Object.values(getSuggestionItems({ query }))
    .flat()
    .filter((item) => !sixDotCoveredCommands.has(item.title) && !item.disable?.(editor));
  const extraTools = legacyCommands.filter((item) => !appCommandTitles.has(item.title));
  const appCommands = legacyCommands.filter((item) => appCommandTitles.has(item.title));

  const runLegacyCommand = (item: (typeof legacyCommands)[number]) => {
    if (position === null) return;
    const node = editor.state.doc.nodeAt(position);
    if (!node) return;

    // Slash commands operate on a caret range. Recreate that range at the end
    // of the selected text block; for media/atomic blocks, preserve the old
    // slash behavior by giving the command the selected block range.
    let from = position;
    let to = position + node.nodeSize;
    if (node.isTextblock) {
      selectBlockEnd(editor, position);
      from = editor.state.selection.from;
      to = from;
    } else {
      selectBlockNode(editor, position);
    }

    item.command({ editor, range: { from, to } } as CommandProps);
    setOpened(false);
  };

  return (
    <Menu
      opened={opened}
      onChange={setOpened}
      position="right-start"
      offset={8}
      shadow="md"
      width={270}
      withinPortal
      floatingStrategy="fixed"
      transitionProps={{ duration: 90, exitDuration: 60, timingFunction: "ease-out" }}
      closeOnItemClick
      closeOnEscape
      closeOnClickOutside={false}
    >
      <Menu.Target>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          style={{
            position: "fixed",
            left: anchor.x,
            top: anchor.y,
            width: 4,
            height: 4,
            padding: 0,
            border: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
      </Menu.Target>
      <Menu.Dropdown onKeyDown={(event) => event.stopPropagation()}>
        <TextInput
          size="xs"
          leftSection={<Search size={14} />}
          placeholder="Search actions..."
          aria-label="Search block actions"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          mb={8}
          autoFocus
        />
        <ScrollArea.Autosize mah={390} type="always" scrollbarSize={8} overscrollBehavior="contain">
          {filteredTurnInto.length > 0 ? (
            <>
              <Text size="xs" c="dimmed" px={8} py={4}>Text</Text>
              <Menu.Sub {...sideSubmenuProps}>
                <Menu.Sub.Target>
                  <Menu.Sub.Item style={fullWidthSubmenuTarget} leftSection={<Pilcrow size={15} />} rightSection={<ChevronRight size={14} />}>
                    Turn into
                  </Menu.Sub.Item>
                </Menu.Sub.Target>
                <Menu.Sub.Dropdown>
                  <ScrollArea.Autosize {...submenuScrollProps}>
                    {filteredTurnInto.map(({ label, icon: Icon, run }) => (
                      <Menu.Item key={label} leftSection={<Icon size={15} />} onClick={() => {
                        if (position !== null) {
                          if (label.endsWith("columns") || label === "Page" || label === "Page in") selectBlockNode(editor, position);
                          else selectBlockText(editor, position);
                        }
                        run(editor);
                        setOpened(false);
                      }}>
                        {label}
                      </Menu.Item>
                    ))}
                  </ScrollArea.Autosize>
                </Menu.Sub.Dropdown>
              </Menu.Sub>
            </>
          ) : null}
          {filteredFormat.length > 0 ? (
            <Menu.Sub {...sideSubmenuProps}>
              <Menu.Sub.Target>
                <Menu.Sub.Item style={fullWidthSubmenuTarget} leftSection={<Bold size={15} />} rightSection={<ChevronRight size={14} />}>
                  Formatting
                </Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                <ScrollArea.Autosize {...submenuScrollProps}>
                  {filteredFormat.map(({ label, icon: Icon, run }) => (
                    <Menu.Item key={label} leftSection={<Icon size={15} />} onClick={() => {
                      if (label !== "Undo" && label !== "Redo" && position !== null) selectBlockText(editor, position);
                      run(editor);
                      setOpened(false);
                    }}>{label}</Menu.Item>
                  ))}
                </ScrollArea.Autosize>
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          ) : null}
          {filteredAlignment.length > 0 ? (
            <Menu.Sub {...sideSubmenuProps}>
              <Menu.Sub.Target>
                <Menu.Sub.Item style={fullWidthSubmenuTarget} leftSection={<AlignLeft size={15} />} rightSection={<ChevronRight size={14} />}>
                  Alignment
                </Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                {filteredAlignment.map(({ label, icon: Icon, align }) => (
                  <Menu.Item key={label} leftSection={<Icon size={15} />} onClick={() => {
                    if (position !== null) selectBlockText(editor, position);
                    editor.chain().focus().setTextAlign(align).run();
                    setOpened(false);
                  }}>{label}</Menu.Item>
                ))}
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          ) : null}
          {filteredColors.length > 0 || filteredBackgrounds.length > 0 || filteredHighlights.length > 0 || matches("Remove highlight") ? (
            <Menu.Sub {...sideSubmenuProps}>
              <Menu.Sub.Target>
                <Menu.Sub.Item style={fullWidthSubmenuTarget} leftSection={<Paintbrush size={15} />} rightSection={<ChevronRight size={14} />}>
                  Color
                </Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                <ScrollArea.Autosize {...submenuScrollProps} overscrollBehavior="contain">
                  <Text size="xs" c="dimmed" px={8} py={4}>Text color</Text>
                  {filteredColors.map(({ label, color }) => (
                    <Menu.Item
                      key={label}
                      leftSection={<span style={{ width: 12, height: 12, borderRadius: 3, background: color }} />}
                      onClick={() => {
                        if (label === "Default") {
                          if (position !== null) selectBlockText(editor, position);
                          editor.chain().focus().unsetColor().run();
                          const node = position === null ? null : editor.state.doc.nodeAt(position);
                          if (node) editor.chain().focus().setNodeSelection(position!).updateAttributes(node.type.name, { backgroundColor: null }).run();
                        } else if (position !== null) {
                          selectBlockText(editor, position);
                          editor.chain().focus().setColor(color).run();
                        }
                        setOpened(false);
                      }}
                    >
                      {label}
                    </Menu.Item>
                  ))}
                  {filteredBackgrounds.length ? <Menu.Divider /> : null}
                  {filteredBackgrounds.length ? <Text size="xs" c="dimmed" px={8} py={4}>Background color</Text> : null}
                  {filteredBackgrounds.map(({ label, color }) => (
                    <Menu.Item key={label} leftSection={<span style={{ width: 12, height: 12, border: "1px solid #999", borderRadius: 3, background: color }} />} onClick={() => {
                      const node = position === null ? null : editor.state.doc.nodeAt(position);
                      if (!node || position === null) return;
                      editor.chain().focus().setNodeSelection(position).updateAttributes(node.type.name, { backgroundColor: label === "Default background" ? null : color }).run();
                      setOpened(false);
                    }}>{label}</Menu.Item>
                  ))}
                  {filteredHighlights.length ? <Menu.Divider /> : null}
                  {filteredHighlights.length ? <Text size="xs" c="dimmed" px={8} py={4}>Text highlight</Text> : null}
                  {filteredHighlights.map(({ label, color }) => (
                    <Menu.Item key={label} leftSection={<span style={{ width: 12, height: 12, border: "1px solid #999", borderRadius: 3, background: color }} />} onClick={() => {
                      if (position !== null) selectBlockText(editor, position);
                      editor.chain().focus().setHighlight({ color }).run();
                      setOpened(false);
                    }}>{label.replace(" highlight", "")}</Menu.Item>
                  ))}
                  {matches("Remove highlight") ? <Menu.Item leftSection={<Eraser size={15} />} onClick={() => {
                    if (position !== null) selectBlockText(editor, position);
                    editor.chain().focus().unsetHighlight().run();
                    setOpened(false);
                  }}>Remove highlight</Menu.Item> : null}
                </ScrollArea.Autosize>
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          ) : null}
          {matches("Image") || matches("Video") || matches("Audio") || matches("PDF") || matches("File attachment") || matches("Table") || matches("Mention") || matches("Emoji") ? (
            <Menu.Sub {...sideSubmenuProps}>
              <Menu.Sub.Target>
                <Menu.Sub.Item style={fullWidthSubmenuTarget} leftSection={<ImagePlus size={15} />} rightSection={<ChevronRight size={14} />}>
                  Insert
                </Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                <ScrollArea.Autosize {...submenuScrollProps}>
                {matches("Image") ? <Menu.Item leftSection={<ImagePlus size={15} />} onClick={() => { chooseFile(editor, position, "image/*", uploadImageAction); setOpened(false); }}>Image</Menu.Item> : null}
                {matches("Video") ? <Menu.Item leftSection={<Video size={15} />} onClick={() => { chooseFile(editor, position, "video/*", uploadVideoAction); setOpened(false); }}>Video</Menu.Item> : null}
                {matches("Audio") ? <Menu.Item leftSection={<Music2 size={15} />} onClick={() => { chooseFile(editor, position, "audio/*", uploadAudioAction); setOpened(false); }}>Audio</Menu.Item> : null}
                {matches("PDF") ? <Menu.Item leftSection={<FileType2 size={15} />} onClick={() => { chooseFile(editor, position, "application/pdf", uploadPdfAction); setOpened(false); }}>PDF</Menu.Item> : null}
                {matches("File attachment") ? <Menu.Item leftSection={<Paperclip size={15} />} onClick={() => { chooseFile(editor, position, "", uploadAttachmentAction, true); setOpened(false); }}>File attachment</Menu.Item> : null}
                {matches("Table") ? <Menu.Item leftSection={<Table2 size={15} />} onClick={() => {
                  const node = position === null ? null : editor.state.doc.nodeAt(position);
                  const at = node && position !== null ? position + node.nodeSize : undefined;
                  if (at !== undefined) {
                    const cell = (type: "tableHeader" | "tableCell") => ({ type, content: [{ type: "paragraph" }] });
                    const table = { type: "table", content: Array.from({ length: 3 }, (_, row) => ({
                      type: "tableRow",
                      content: Array.from({ length: 3 }, () => cell(row === 0 ? "tableHeader" : "tableCell")),
                    })) };
                    editor.chain().focus().insertContentAt(at, table).run();
                  }
                  setOpened(false);
                }}>Table</Menu.Item> : null}
                {matches("Mention") ? <Menu.Item leftSection={<AtSign size={15} />} onClick={() => { if (position !== null) selectBlockEnd(editor, position); editor.chain().focus().insertContent("@").run(); setOpened(false); }}>Mention</Menu.Item> : null}
                {matches("Emoji") ? <Menu.Item leftSection={<Smile size={15} />} onClick={() => { if (position !== null) selectBlockEnd(editor, position); editor.chain().focus().insertContent(":").run(); setOpened(false); }}>Emoji</Menu.Item> : null}
                </ScrollArea.Autosize>
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          ) : null}
          {extraTools.length > 0 ? (
            <Menu.Sub {...sideSubmenuProps}>
              <Menu.Sub.Target>
                <Menu.Sub.Item style={fullWidthSubmenuTarget} leftSection={<MoreHorizontal size={15} />} rightSection={<ChevronRight size={14} />}>
                  More tools
                </Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                <ScrollArea.Autosize {...submenuScrollProps}>
                  <Text size="xs" c="dimmed" px={8} py={4}>Additional blocks and tools</Text>
                  {extraTools.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Menu.Item key={item.title} leftSection={<Icon size={15} />} onClick={() => runLegacyCommand(item)}>
                        {item.title}
                      </Menu.Item>
                    );
                  })}
                </ScrollArea.Autosize>
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          ) : null}
          {appCommands.length > 0 ? (
            <Menu.Sub {...sideSubmenuProps}>
              <Menu.Sub.Target>
                <Menu.Sub.Item style={fullWidthSubmenuTarget} leftSection={<Puzzle size={15} />} rightSection={<ChevronRight size={14} />}>
                  Apps & embeds
                </Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                <ScrollArea.Autosize {...submenuScrollProps}>
                  <Text size="xs" c="dimmed" px={8} py={4}>Apps and embeds</Text>
                  {appCommands.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Menu.Item key={item.title} leftSection={<Icon size={15} />} onClick={() => runLegacyCommand(item)}>
                        {item.title}
                      </Menu.Item>
                    );
                  })}
                </ScrollArea.Autosize>
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          ) : null}
          {matches("Copy link to block") ? (
            <Menu.Item leftSection={<Copy size={15} />} onClick={() => { void copyLink(); setOpened(false); }}>
              Copy link to block
            </Menu.Item>
          ) : null}
          {matches("Page") || matches("Page in") ? (
            <Menu.Sub {...sideSubmenuProps}>
              <Menu.Sub.Target>
                <Menu.Sub.Item style={fullWidthSubmenuTarget} leftSection={<FilePlus2 size={15} />} rightSection={<ChevronRight size={14} />}>Page</Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                <ScrollArea.Autosize {...submenuScrollProps}>
                {matches("Page") ? <Menu.Item leftSection={<FilePlus2 size={15} />} onClick={() => openPageDialog("child")}>Create child page</Menu.Item> : null}
                {matches("Page in") ? <Menu.Item leftSection={<FolderInput size={15} />} onClick={() => openPageDialog("in")}>Page in…</Menu.Item> : null}
                </ScrollArea.Autosize>
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          ) : null}
          {matches("Duplicate") ? (
            <Menu.Item leftSection={<CopyPlus size={15} />} onClick={duplicate}>Duplicate</Menu.Item>
          ) : null}
          {matches("Move to") || matches("Move up") || matches("Move down") ? (
            <Menu.Sub {...sideSubmenuProps}>
              <Menu.Sub.Target>
                <Menu.Sub.Item style={fullWidthSubmenuTarget} leftSection={<ArrowDown size={15} />} rightSection={<ChevronRight size={14} />}>
                  Move to
                </Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                <ScrollArea.Autosize {...submenuScrollProps}>
                {position !== null ? (() => {
                  let selectedIndex = -1;
                  editor.state.doc.forEach((_node, offset, index) => { if (offset === position) selectedIndex = index; });
                  return Array.from({ length: editor.state.doc.childCount + 1 }, (_, target) => {
                    const label = target === 0 ? "Beginning of page" : target === editor.state.doc.childCount ? "End of page" : `Before ${editor.state.doc.child(target).textContent.slice(0, 28) || editor.state.doc.child(target).type.name}`;
                    return <Menu.Item key={target} disabled={target === selectedIndex || target === selectedIndex + 1} onClick={() => moveToIndex(target)}>{label}</Menu.Item>;
                  });
                })() : null}
                </ScrollArea.Autosize>
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          ) : null}
          {matches("Delete") ? (
            <>
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<Trash2 size={15} />} onClick={() => {
                if (position !== null) {
                  const node = editor.state.doc.nodeAt(position);
                  if (node) editor.view.dispatch(editor.state.tr.delete(position, position + node.nodeSize));
                }
                setOpened(false);
              }}>
                Delete
              </Menu.Item>
            </>
          ) : null}
          <Menu.Divider />
          <Text size="xs" c="dimmed" px={8} py={4}>
            {wordCount} words · {selectedText.length} characters
          </Text>
        </ScrollArea.Autosize>
      </Menu.Dropdown>
    </Menu>
  );
}
