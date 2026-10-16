import { BLOCK_HANDLE_MENU_EVENT } from "@/features/editor/components/block-actions-menu";

/**
 * Slash commands and the six-dot block menu share one palette and one command
 * handler. Removing the trigger before opening the palette also keeps the
 * slash suggestion plugin from competing for keyboard focus with the menu.
 */
const renderItems = () => ({
  onStart: (props: {
    editor: any;
    range: { from: number; to: number };
    clientRect?: (() => DOMRect | null) | null;
  }) => {
    const { editor, range } = props;
    const $from = editor.state.doc.resolve(range.from);
    const position = $from.depth > 0 ? $from.before($from.depth) : range.from;
    const rect = props.clientRect?.() ?? new DOMRect();

    editor.chain().focus().deleteRange(range).run();
    window.dispatchEvent(
      new CustomEvent(BLOCK_HANDLE_MENU_EVENT, {
        detail: { x: rect.left, y: rect.bottom, position },
      }),
    );
  },
  onUpdate: () => {},
  onKeyDown: ({ event }: { event: KeyboardEvent }) => event.key === "Escape",
  onExit: () => {},
});

export default renderItems;
