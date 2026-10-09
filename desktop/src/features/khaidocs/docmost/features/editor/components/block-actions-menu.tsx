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
  List,
  ListOrdered,
  Paintbrush,
  Pilcrow,
  Quote,
  Search,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { useSetAtom } from "jotai";
import { showAiMenuAtom } from "@/features/editor/atoms/editor-atoms";
import { showCommentPopupAtom } from "@/features/comment/atoms/comment-atom";

export const BLOCK_HANDLE_MENU_EVENT = "khaidocs:block-handle-menu";

interface BlockHandleMenuRequest extends CustomEvent<{ x: number; y: number }> {}

const turnIntoActions = [
  { label: "Text", icon: Type, run: (editor: Editor) => editor.chain().focus().setNode("paragraph").run() },
  { label: "Heading 1", icon: Heading1, run: (editor: Editor) => editor.chain().focus().setNode("heading", { level: 1 }).run() },
  { label: "Heading 2", icon: Heading2, run: (editor: Editor) => editor.chain().focus().setNode("heading", { level: 2 }).run() },
  { label: "Heading 3", icon: Heading3, run: (editor: Editor) => editor.chain().focus().setNode("heading", { level: 3 }).run() },
  { label: "Bullet list", icon: List, run: (editor: Editor) => editor.chain().focus().toggleBulletList().run() },
  { label: "Numbered list", icon: ListOrdered, run: (editor: Editor) => editor.chain().focus().toggleOrderedList().run() },
  { label: "Quote", icon: Quote, run: (editor: Editor) => editor.chain().focus().toggleBlockquote().run() },
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
];

export function BlockActionsMenu({ editor }: { editor: Editor }) {
  const setShowAiMenu = useSetAtom(showAiMenuAtom);
  const setShowCommentPopup = useSetAtom(showCommentPopupAtom);
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState<number | null>(null);

  useEffect(() => {
    const onRequest = (event: Event) => {
      const request = event as BlockHandleMenuRequest;
      const { x, y } = request.detail;
      const selection = editor.state.selection;
      if (!(selection instanceof NodeSelection)) return;
      setPosition(selection.from);
      const appRoot = editor.view.dom.closest(".khaidocs-root");
      const rootRect = appRoot?.getBoundingClientRect();
      setAnchor({
        x: x - (rootRect?.left ?? 0),
        y: y - (rootRect?.top ?? 0),
      });
      setQuery("");
      setOpened(true);
    };
    window.addEventListener(BLOCK_HANDLE_MENU_EVENT, onRequest);
    return () => window.removeEventListener(BLOCK_HANDLE_MENU_EVENT, onRequest);
  }, [editor]);

  const matches = (label: string) =>
    label.toLowerCase().includes(query.trim().toLowerCase());
  const selectedNode = position === null ? null : editor.state.doc.nodeAt(position);
  const selectedText = selectedNode?.textContent ?? "";
  const wordCount = selectedText.trim() ? selectedText.trim().split(/\s+/).length : 0;

  const move = (direction: -1 | 1) => {
    const selection = editor.state.selection;
    if (!(selection instanceof NodeSelection) || position === null) return;
    let index = -1;
    editor.state.doc.forEach((_node, offset, childIndex) => {
      if (offset === position) index = childIndex;
    });
    if (index < 0 || index + direction < 0 || index + direction >= editor.state.doc.childCount) return;
    const sibling = editor.state.doc.child(index + direction);
    if (!sibling) return;
    const tr = editor.state.tr.delete(selection.from, selection.to);
    const insertAt = direction < 0
      ? selection.from - sibling.nodeSize
      : selection.from + sibling.nodeSize;
    editor.view.dispatch(tr.insert(insertAt, selection.node));
    editor.commands.focus();
  };

  const duplicate = () => {
    const selection = editor.state.selection;
    if (!(selection instanceof NodeSelection)) return;
    editor.chain().focus().insertContentAt(selection.to, selection.node.toJSON()).run();
  };

  const copyLink = async () => {
    const node = position === null ? null : editor.state.doc.nodeAt(position);
    const id = node?.attrs.id;
    const url = new URL(window.location.href);
    if (typeof id === "string" && id) url.hash = id;
    await navigator.clipboard?.writeText(url.toString());
  };

  const filteredTurnInto = useMemo(
    () => turnIntoActions.filter((action) => matches(action.label)),
    // matches is intentionally tied to the query string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query],
  );
  const filteredColors = blockColors.filter((color) => matches(color.label));

  return (
    <Menu
      opened={opened}
      onChange={setOpened}
      position="right-start"
      offset={8}
      shadow="md"
      width={270}
      withinPortal
      closeOnItemClick
      closeOnEscape
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
            width: 1,
            height: 1,
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
        <ScrollArea.Autosize mah={390} type="scroll">
          {filteredTurnInto.length > 0 ? (
            <>
              <Text size="xs" c="dimmed" px={8} py={4}>Text</Text>
              <Menu.Sub position="right-start">
                <Menu.Sub.Target>
                  <Menu.Sub.Item leftSection={<Pilcrow size={15} />} rightSection={<ChevronRight size={14} />}>
                    Turn into
                  </Menu.Sub.Item>
                </Menu.Sub.Target>
                <Menu.Sub.Dropdown>
                  {filteredTurnInto.map(({ label, icon: Icon, run }) => (
                    <Menu.Item key={label} leftSection={<Icon size={15} />} onClick={() => run(editor)}>
                      {label}
                    </Menu.Item>
                  ))}
                </Menu.Sub.Dropdown>
              </Menu.Sub>
            </>
          ) : null}
          {filteredColors.length > 0 ? (
            <Menu.Sub position="right-start">
              <Menu.Sub.Target>
                <Menu.Sub.Item leftSection={<Paintbrush size={15} />} rightSection={<ChevronRight size={14} />}>
                  Color
                </Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                {filteredColors.map(({ label, color }) => (
                  <Menu.Item
                    key={label}
                    leftSection={<span style={{ width: 12, height: 12, borderRadius: 3, background: color }} />}
                    onClick={() => {
                      if (label === "Default") editor.chain().focus().unsetColor().run();
                      else editor.chain().focus().setColor(color).run();
                    }}
                  >
                    {label}
                  </Menu.Item>
                ))}
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          ) : null}
          {matches("Copy link to block") ? (
            <Menu.Item leftSection={<Copy size={15} />} onClick={() => void copyLink()}>
              Copy link to block
            </Menu.Item>
          ) : null}
          {matches("Duplicate") ? (
            <Menu.Item leftSection={<CopyPlus size={15} />} onClick={duplicate}>Duplicate</Menu.Item>
          ) : null}
          {matches("Move to") || matches("Move up") || matches("Move down") ? (
            <Menu.Sub position="right-start">
              <Menu.Sub.Target>
                <Menu.Sub.Item leftSection={<ArrowDown size={15} />} rightSection={<ChevronRight size={14} />}>
                  Move to
                </Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                <Menu.Item leftSection={<ArrowUp size={15} />} onClick={() => move(-1)}>Move up</Menu.Item>
                <Menu.Item leftSection={<ArrowDown size={15} />} onClick={() => move(1)}>Move down</Menu.Item>
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          ) : null}
          {matches("Delete") ? (
            <>
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<Trash2 size={15} />} onClick={() => editor.chain().focus().deleteSelection().run()}>
                Delete
              </Menu.Item>
            </>
          ) : null}
          {matches("Ask AI") ? (
            <Menu.Item
              leftSection={<Sparkles size={15} />}
              onClick={() => {
                editor.commands.focus();
                setShowAiMenu(true);
              }}
            >
              Ask AI
            </Menu.Item>
          ) : null}
          {matches("Suggest edits") ? (
            <Menu.Item
              leftSection={<Pilcrow size={15} />}
              onClick={() => {
                editor.commands.focus();
                setShowCommentPopup(true);
              }}
            >
              Suggest edits
            </Menu.Item>
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
