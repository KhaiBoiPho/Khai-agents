import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";

export function turnBlockIntoColumns(editor: Editor, count: 2 | 3 | 4 | 5): boolean {
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection) || !selection.node.isBlock) return false;

  const layout = ({ 2: "two_equal", 3: "three_equal", 4: "four_equal", 5: "five_equal" } as const)[count];
  const content = Array.from({ length: count }, (_, index) => ({
    type: "column",
    content: index === 0 ? [selection.node.toJSON()] : [{ type: "paragraph" }],
  }));

  return editor.chain().focus().insertContentAt(
    { from: selection.from, to: selection.to },
    { type: "columns", attrs: { layout }, content },
  ).run();
}
