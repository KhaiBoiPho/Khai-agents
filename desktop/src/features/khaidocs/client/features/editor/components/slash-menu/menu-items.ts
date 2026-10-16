import {
  IconBlockquote,
  IconCaretRightFilled,
  IconCheckbox,
  IconCode,
  IconH1,
  IconH2,
  IconH3,
  IconH4,
  IconInfoCircle,
  IconLayoutKanban,
  IconList,
  IconListNumbers,
  IconMath,
  IconMathFunction,
  IconMovie,
  IconMusic,
  IconPaperclip,
  IconFileTypePdf,
  IconPhoto,
  IconTable,
  IconTypography,
  IconMenu4,
  IconPageBreak,
  IconCalendar,
  IconClock,
  IconAppWindow,
  IconSitemap,
  IconColumns3,
  IconColumns2,
  IconTag,
  IconMoodSmile,
  IconRotate2,
  IconSuperscript,
  IconBold,
  IconItalic,
  IconUnderline,
  IconStrikethrough,
  IconAlignLeft,
  IconAlignCenter,
  IconAlignRight,
  IconAlignJustified,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconClearFormatting,
  IconIndentIncrease,
  IconIndentDecrease,
  IconPalette,
  IconCopyPlus,
  IconTrash,
  IconArrowDown,
  IconArrowUp,
  IconLink,
  IconPaint,
} from "@tabler/icons-react";
import {
  CommandProps,
  SlashMenuGroupedItemsType,
} from "@/features/editor/components/slash-menu/types";
import { uploadImageAction } from "@/features/editor/components/image/upload-image-action.tsx";
import { uploadVideoAction } from "@/features/editor/components/video/upload-video-action.tsx";
import { uploadAudioAction } from "@/features/editor/components/audio/upload-audio-action.tsx";
import { uploadAttachmentAction } from "@/features/editor/components/attachment/upload-attachment-action.tsx";
import { uploadPdfAction } from "@/features/editor/components/pdf/upload-pdf-action.tsx";
import IconExcalidraw from "@/components/icons/icon-excalidraw";
import IconMermaid from "@/components/icons/icon-mermaid";
import IconDrawio from "@/components/icons/icon-drawio";
import { IconColumns4 } from "@/components/icons/icon-columns-4";
import { IconColumns5 } from "@/components/icons/icon-columns-5";
import i18n from "@/i18n.ts";
import {
  AirtableIcon,
  FigmaIcon,
  FramerIcon,
  GoogleDriveIcon,
  GoogleSheetsIcon,
  LoomIcon,
  MiroIcon,
  TypeformIcon,
  VimeoIcon,
  YoutubeIcon,
} from "@/components/icons";
import { insertBaseEmbedBlock } from "@/features/editor/components/base-embed/insert-base-embed";
import { PAGE_INSERT_EVENT } from "@/features/editor/components/page-insert-dialog";

const textColors = [
  ["Blue", "#2563EB"], ["Green", "#008A00"], ["Purple", "#9333EA"],
  ["Red", "#E00000"], ["Yellow", "#EAB308"], ["Orange", "#FFA500"],
  ["Pink", "#BA4081"], ["Gray", "#A8A29E"], ["Brown", "#92400E"],
] as const;
const highlightColors = [
  ["Blue", "#98d8f2"], ["Green", "#7edb6c"], ["Purple", "#e0d6ed"],
  ["Red", "#ffc6c2"], ["Yellow", "#faf594"], ["Orange", "#f5c8a9"],
  ["Pink", "#f5cfe0"], ["Gray", "#dfdfd7"], ["Brown", "#d7c4b7"],
] as const;

const formattingItems = [
  { title: "Bold", description: "Make selected text bold.", icon: IconBold, searchTerms: ["bold", "strong"], command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).toggleBold().run() },
  { title: "Italic", description: "Italicize selected text.", icon: IconItalic, searchTerms: ["italic", "emphasis"], command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).toggleItalic().run() },
  { title: "Underline", description: "Underline selected text.", icon: IconUnderline, searchTerms: ["underline"], command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).toggleUnderline().run() },
  { title: "Strikethrough", description: "Strike through selected text.", icon: IconStrikethrough, searchTerms: ["strike", "strikethrough"], command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).toggleStrike().run() },
  { title: "Inline code", description: "Format selected text as code.", icon: IconCode, searchTerms: ["code", "inline code"], command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).toggleCode().run() },
  { title: "Clear formatting", description: "Remove formatting from selected text.", icon: IconClearFormatting, searchTerms: ["clear", "reset", "format"], command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).unsetAllMarks().clearNodes().run() },
  { title: "Increase indent", description: "Indent this paragraph.", icon: IconIndentIncrease, searchTerms: ["indent", "increase"], command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).indent().run() },
  { title: "Decrease indent", description: "Outdent this paragraph.", icon: IconIndentDecrease, searchTerms: ["outdent", "decrease", "indent"], command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).outdent().run() },
  ...([1, 2, 3, 4] as const).map((level) => ({ title: `Toggle heading ${level}`, description: `Create a collapsible heading ${level}.`, icon: [IconH1, IconH2, IconH3, IconH4][level - 1], searchTerms: ["toggle", "heading", `h${level}`], command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).setNode("heading", { level }).setDetailsHeading(level).run() })),
  { title: "Align left", description: "Align this block to the left.", icon: IconAlignLeft, searchTerms: ["align", "left"], command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).setTextAlign("left").run() },
  { title: "Align center", description: "Center this block.", icon: IconAlignCenter, searchTerms: ["align", "center"], command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).setTextAlign("center").run() },
  { title: "Align right", description: "Align this block to the right.", icon: IconAlignRight, searchTerms: ["align", "right"], command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).setTextAlign("right").run() },
  { title: "Justify", description: "Justify this block.", icon: IconAlignJustified, searchTerms: ["align", "justify"], command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).setTextAlign("justify").run() },
  { title: "Undo", description: "Undo the last change.", icon: IconArrowBackUp, searchTerms: ["undo", "back"], command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).undo().run() },
  { title: "Redo", description: "Redo the last undone change.", icon: IconArrowForwardUp, searchTerms: ["redo", "forward"], command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).redo().run() },
];

function currentBlock(editor: CommandProps["editor"], range: CommandProps["range"]) {
  if (!editor) return null;
  const $pos = editor.state.doc.resolve(Math.max(1, Math.min(range.from, editor.state.doc.content.size - 1)));
  if ($pos.depth < 1) return null;
  return { pos: $pos.before(1), node: $pos.node(1) };
}

function blockLink(editor: CommandProps["editor"], range: CommandProps["range"]) {
  if (!editor) return;
  const block = currentBlock(editor, range);
  const id = block?.node.attrs.id;
  const url = new URL(window.location.href);
  if (typeof id === "string" && id) url.hash = id;
  void navigator.clipboard?.writeText(url.toString());
}

function duplicateCurrentBlock(editor: CommandProps["editor"], range: CommandProps["range"]) {
  if (!editor) return;
  const block = currentBlock(editor, range);
  if (!block) return;
  const tr = editor.state.tr.delete(range.from, range.to);
  const position = tr.mapping.map(block.pos, -1);
  const cleanBlock = tr.doc.nodeAt(position);
  if (!cleanBlock) return;
  tr.insert(position + cleanBlock.nodeSize, cleanBlock);
  editor.view.dispatch(tr);
}

function moveCurrentBlock(editor: CommandProps["editor"], range: CommandProps["range"], direction: "up" | "down") {
  if (!editor) return;
  const block = currentBlock(editor, range);
  if (!block) return;
  const nodes: Array<{ pos: number; node: typeof block.node }> = [];
  editor.state.doc.forEach((node, pos) => nodes.push({ pos, node }));
  const index = nodes.findIndex((item) => item.pos === block.pos);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= nodes.length) {
    editor.chain().focus().deleteRange(range).run();
    return;
  }
  const tr = editor.state.tr.delete(range.from, range.to);
  const currentPos = tr.mapping.map(block.pos, -1);
  const currentNode = tr.doc.nodeAt(currentPos);
  if (!currentNode) return;
  const target = nodes[targetIndex];
  const targetPos = tr.mapping.map(target.pos, -1);
  const targetNode = tr.doc.nodeAt(targetPos);
  if (!targetNode) return;
  tr.delete(currentPos, currentPos + currentNode.nodeSize);
  const insertionPos = direction === "up" ? targetPos : targetPos + targetNode.nodeSize;
  tr.insert(insertionPos, currentNode);
  editor.view.dispatch(tr);
}

function moveCurrentBlockToEdge(editor: CommandProps["editor"], range: CommandProps["range"], edge: "beginning" | "end") {
  if (!editor) return;
  const block = currentBlock(editor, range);
  if (!block) return;
  const tr = editor.state.tr.delete(range.from, range.to);
  const position = tr.mapping.map(block.pos, -1);
  const node = tr.doc.nodeAt(position);
  if (!node) return;
  tr.delete(position, position + node.nodeSize);
  tr.insert(edge === "beginning" ? 0 : tr.doc.content.size, node);
  editor.view.dispatch(tr);
}

const slashBlockActions = [
  { title: "Copy link to block", description: "Copy a link to this block.", searchTerms: ["copy", "link", "block"], icon: IconLink, command: ({ editor, range }: CommandProps) => { blockLink(editor, range); editor?.chain().focus().deleteRange(range).run(); } },
  { title: "Duplicate block", description: "Make a copy of this block.", searchTerms: ["duplicate", "copy", "block"], icon: IconCopyPlus, command: ({ editor, range }: CommandProps) => duplicateCurrentBlock(editor, range) },
  { title: "Move block up", description: "Move this block before the previous block.", searchTerms: ["move", "up", "block"], icon: IconArrowUp, command: ({ editor, range }: CommandProps) => moveCurrentBlock(editor, range, "up") },
  { title: "Move block down", description: "Move this block after the next block.", searchTerms: ["move", "down", "block"], icon: IconArrowDown, command: ({ editor, range }: CommandProps) => moveCurrentBlock(editor, range, "down") },
  { title: "Move block to beginning", description: "Move this block to the start of the page.", searchTerms: ["move", "beginning", "start", "page"], icon: IconArrowUp, command: ({ editor, range }: CommandProps) => moveCurrentBlockToEdge(editor, range, "beginning") },
  { title: "Move block to end", description: "Move this block to the end of the page.", searchTerms: ["move", "end", "page"], icon: IconArrowDown, command: ({ editor, range }: CommandProps) => moveCurrentBlockToEdge(editor, range, "end") },
  { title: "Delete block", description: "Remove this block.", searchTerms: ["delete", "remove", "block"], icon: IconTrash, command: ({ editor, range }: CommandProps) => {
    if (!editor) return;
    const block = currentBlock(editor, range);
    if (!block) return;
    editor.view.dispatch(editor.state.tr.delete(block.pos, block.pos + block.node.nodeSize));
  } },
];

const slashColorActions = [
  ...textColors.map(([name, color]) => ({ title: `Text color: ${name}`, description: `Apply ${name.toLowerCase()} text color.`, searchTerms: ["color", "text", name.toLowerCase()], icon: IconPalette, command: ({ editor, range }: CommandProps) => editor?.chain().focus().deleteRange(range).setColor(color).run() })),
  { title: "Default text color", description: "Remove text color.", searchTerms: ["color", "default", "reset"], icon: IconPalette, command: ({ editor, range }: CommandProps) => editor?.chain().focus().deleteRange(range).unsetColor().run() },
  ...highlightColors.map(([name, color]) => ({ title: `Highlight: ${name}`, description: `Highlight text in ${name.toLowerCase()}.`, searchTerms: ["highlight", "background", name.toLowerCase()], icon: IconPalette, command: ({ editor, range }: CommandProps) => editor?.chain().focus().deleteRange(range).setHighlight({ color }).run() })),
  { title: "Remove highlight", description: "Remove text highlight.", searchTerms: ["highlight", "remove", "reset"], icon: IconPalette, command: ({ editor, range }: CommandProps) => editor?.chain().focus().deleteRange(range).unsetHighlight().run() },
  ...[
    ["Gray", "#9b9b9b"], ["Brown", "#ba856f"], ["Orange", "#c77d48"], ["Green", "#529e72"],
    ["Blue", "#379ad3"], ["Purple", "#9d68d3"], ["Red", "#df5452"],
  ].map(([name, color]) => ({ title: `Block color: ${name}`, description: `Set this block to ${name.toLowerCase()}.`, searchTerms: ["block", "color", name.toLowerCase()], icon: IconPaint, command: ({ editor, range }: CommandProps) => {
    if (!editor) return;
    const block = currentBlock(editor, range);
    editor.chain().focus().deleteRange(range).setColor(color).run();
    if (block) editor.chain().focus().setNodeSelection(block.pos).updateAttributes(block.node.type.name, { backgroundColor: color }).run();
  } })),
  { title: "Default block color", description: "Reset this block color.", searchTerms: ["block", "color", "default", "reset"], icon: IconPaint, command: ({ editor, range }: CommandProps) => {
    if (!editor) return;
    const block = currentBlock(editor, range);
    editor.chain().focus().deleteRange(range).unsetColor().run();
    if (block) editor.chain().focus().setNodeSelection(block.pos).updateAttributes(block.node.type.name, { backgroundColor: null }).run();
  } },
  ...[
    ["Gray", "#f1f1ef"], ["Brown", "#f4eeee"], ["Orange", "#fbecdd"], ["Yellow", "#fbf3db"],
    ["Green", "#edf3ec"], ["Blue", "#e7f3f8"], ["Purple", "#f4f0f7"], ["Pink", "#f9eef3"], ["Red", "#fbe4e4"],
  ].map(([name, color]) => ({ title: `Block background: ${name}`, description: `Set this block background to ${name.toLowerCase()}.`, searchTerms: ["block", "background", name.toLowerCase()], icon: IconPaint, command: ({ editor, range }: CommandProps) => {
    if (!editor) return;
    const block = currentBlock(editor, range);
    if (!block) return;
    editor.chain().focus().deleteRange(range).setNodeSelection(block.pos).updateAttributes(block.node.type.name, { backgroundColor: color }).run();
  } })),
  { title: "Default block background", description: "Remove this block background.", searchTerms: ["block", "background", "default", "reset"], icon: IconPaint, command: ({ editor, range }: CommandProps) => {
    if (!editor) return;
    const block = currentBlock(editor, range);
    if (!block) return;
    editor.chain().focus().deleteRange(range).setNodeSelection(block.pos).updateAttributes(block.node.type.name, { backgroundColor: null }).run();
  } },
];

const CommandGroups: SlashMenuGroupedItemsType = {
  text: formattingItems,
  color: slashColorActions,
  block: slashBlockActions,
  basic: [
    {
      title: "Page",
      description: "Create a child page and link it here.",
      searchTerms: ["child page", "new page"],
      icon: IconAppWindow,
      command: ({ editor, range }: CommandProps) => window.dispatchEvent(new CustomEvent(PAGE_INSERT_EVENT, { detail: { editor, range, mode: "child" } })),
    },
    {
      title: "Page in",
      description: "Create a page inside a page you choose.",
      searchTerms: ["page in", "nested page"],
      icon: IconSitemap,
      command: ({ editor, range }: CommandProps) => window.dispatchEvent(new CustomEvent(PAGE_INSERT_EVENT, { detail: { editor, range, mode: "in" } })),
    },
    {
      title: "Text",
      description: "Just start typing with plain text.",
      searchTerms: ["p", "paragraph"],
      icon: IconTypography,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .toggleNode("paragraph", "paragraph")
          .run();
      },
    },
    {
      title: "To-do list",
      description: "Track tasks with a to-do list.",
      searchTerms: ["todo", "task", "list", "check", "checkbox"],
      icon: IconCheckbox,
      command: ({ editor, range }: CommandProps) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run();
      },
    },
    {
      title: "Heading 1",
      description: "Big section heading.",
      searchTerms: ["title", "big", "large"],
      icon: IconH1,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: 1 })
          .run();
      },
    },
    {
      title: "Heading 2",
      description: "Medium section heading.",
      searchTerms: ["subtitle", "medium"],
      icon: IconH2,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: 2 })
          .run();
      },
    },
    {
      title: "Heading 3",
      description: "Small section heading.",
      searchTerms: ["subtitle", "small"],
      icon: IconH3,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: 3 })
          .run();
      },
    },
    {
      title: "Heading 4",
      description: "Small section heading.",
      searchTerms: ["h4", "heading"],
      icon: IconH4,
      command: ({ editor, range }: CommandProps) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 4 }).run(),
    },
    {
      title: "Bullet list",
      description: "Create a simple bullet list.",
      searchTerms: ["unordered", "point", "list"],
      icon: IconList,
      command: ({ editor, range }: CommandProps) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run();
      },
    },
    {
      title: "Numbered list",
      description: "Create a list with numbering.",
      searchTerms: ["numbered", "ordered", "list", "ol"],
      icon: IconListNumbers,
      command: ({ editor, range }: CommandProps) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run();
      },
    },
    {
      title: "Quote",
      description: "Create block quote.",
      searchTerms: ["blockquote", "quotes"],
      icon: IconBlockquote,
      command: ({ editor, range }: CommandProps) =>
        editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      title: "Code",
      description: "Insert code snippet.",
      searchTerms: ["codeblock"],
      icon: IconCode,
      command: ({ editor, range }: CommandProps) =>
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    },
    {
      title: "Divider",
      description: "Insert horizontal rule divider",
      searchTerms: ["horizontal rule", "hr"],
      icon: IconMenu4,
      command: ({ editor, range }: CommandProps) =>
        editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
    {
      title: "Page break",
      description: "Insert a page break for printing.",
      searchTerms: ["page", "break", "pagebreak", "print"],
      icon: IconPageBreak,
      command: ({ editor, range }: CommandProps) =>
        editor.chain().focus().deleteRange(range).setPageBreak().run(),
    },
    {
      title: "Footnote",
      description: "Insert a footnote reference.",
      searchTerms: ["footnote", "reference", "citation", "note"],
      icon: IconSuperscript,
      command: ({ editor, range }: CommandProps) => {
        editor.chain().focus().deleteRange(range).run();
        editor.commands.addFootnote();
      },
    },
    {
      title: "Image",
      description: "Upload any image from your device.",
      searchTerms: ["photo", "picture", "media", "file", "attachment"],
      icon: IconPhoto,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();

        // @ts-ignore
        const pageId = editor.storage?.pageId;
        if (!pageId) return;

        // upload image
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.multiple = true;
        input.style.display = "none";
        document.body.appendChild(input);
        input.onchange = async () => {
          if (input.files?.length) {
            for (const file of input.files) {
              const pos = editor.view.state.selection.from;

              uploadImageAction(file, editor, pos, pageId);
            }
          }

          input.remove();
        };
        input.click();
      },
    },
    {
      title: "Video",
      description: "Upload any video from your device.",
      searchTerms: ["video", "mp4", "media", "file", "attachment"],
      icon: IconMovie,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();

        // @ts-ignore
        const pageId = editor.storage?.pageId;
        if (!pageId) return;

        // upload video
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "video/*";
        input.multiple = true;
        input.style.display = "none";
        document.body.appendChild(input);
        input.onchange = async () => {
          if (input.files?.length) {
            for (const file of input.files) {
              const pos = editor.view.state.selection.from;

              uploadVideoAction(file, editor, pos, pageId);
            }
          }

          input.remove();
        };
        input.click();
      },
    },
    {
      title: "Audio",
      description: "Upload any audio from your device.",
      searchTerms: [
        "audio",
        "music",
        "sound",
        "mp3",
        "media",
        "file",
        "attachment",
      ],
      icon: IconMusic,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();

        // @ts-ignore
        const pageId = editor.storage?.pageId;
        if (!pageId) return;

        // upload audio
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "audio/*";
        input.multiple = true;
        input.style.display = "none";
        document.body.appendChild(input);
        input.onchange = async () => {
          if (input.files?.length) {
            for (const file of input.files) {
              const pos = editor.view.state.selection.from;

              uploadAudioAction(file, editor, pos, pageId);
            }
          }

          input.remove();
        };
        input.click();
      },
    },
    {
      title: "Embed PDF",
      description: "Upload and embed a PDF file.",
      searchTerms: ["pdf", "document", "embed"],
      icon: IconFileTypePdf,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();

        // @ts-ignore
        const pageId = editor.storage?.pageId;
        if (!pageId) return;

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/pdf";
        input.style.display = "none";
        document.body.appendChild(input);
        input.onchange = async () => {
          if (input.files?.length) {
            for (const file of input.files) {
              const pos = editor.view.state.selection.from;

              uploadPdfAction(file, editor, pos, pageId);
            }
          }

          input.remove();
        };
        input.click();
      },
    },
    {
      title: "File attachment",
      description: "Upload any file from your device.",
      searchTerms: ["file", "attachment", "upload", "csv", "zip"],
      icon: IconPaperclip,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();

        // @ts-ignore
        const pageId = editor.storage?.pageId;
        if (!pageId) return;

        // upload file
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "";
        input.multiple = true;
        input.style.display = "none";
        document.body.appendChild(input);
        input.onchange = async () => {
          if (input.files?.length) {
            for (const file of input.files) {
              const pos = editor.view.state.selection.from;

              uploadAttachmentAction(file, editor, pos, pageId, true);
            }
          }

          input.remove();
        };
        input.click();
      },
    },
    {
      title: "Table",
      description: "Insert a table.",
      searchTerms: ["table", "rows", "columns"],
      icon: IconTable,
      command: ({ editor, range }: CommandProps) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      title: "Base (Inline)",
      description: "Insert an inline base on this page",
      searchTerms: ["base", "database", "table", "grid", "spreadsheet"],
      icon: IconTable,
      requiresBases: true,
      command: ({ editor, range }: CommandProps) => {
        insertBaseEmbedBlock(editor, { range });
      },
    },
    {
      title: "Kanban",
      description: "Insert a kanban board on this page",
      searchTerms: ["kanban", "board", "cards", "status", "task", "database"],
      icon: IconLayoutKanban,
      requiresBases: true,
      command: ({ editor, range }: CommandProps) => {
        insertBaseEmbedBlock(editor, { range, template: "kanban" });
      },
    },
    {
      title: "Toggle block",
      description: "Insert collapsible block.",
      searchTerms: ["collapsible", "block", "toggle", "details", "expand"],
      icon: IconCaretRightFilled,
      command: ({ editor, range }: CommandProps) =>
        editor.chain().focus().deleteRange(range).setDetails().run(),
    },
    {
      title: "Callout",
      description: "Insert callout notice.",
      searchTerms: [
        "callout",
        "notice",
        "panel",
        "info",
        "warning",
        "success",
        "error",
        "danger",
      ],
      icon: IconInfoCircle,
      command: ({ editor, range }: CommandProps) =>
        editor.chain().focus().deleteRange(range).toggleCallout().run(),
    },
    {
      title: "Math inline",
      description: "Insert inline math equation.",
      searchTerms: [
        "math",
        "inline",
        "mathinline",
        "inlinemath",
        "inline math",
        "equation",
        "katex",
        "latex",
        "tex",
      ],
      icon: IconMathFunction,
      command: ({ editor, range }: CommandProps) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setMathInline()
          .setNodeSelection(range.from)
          .run(),
    },
    {
      title: "Math block",
      description: "Insert math equation",
      searchTerms: [
        "math",
        "block",
        "mathblock",
        "block math",
        "equation",
        "katex",
        "latex",
        "tex",
      ],
      icon: IconMath,
      command: ({ editor, range }: CommandProps) =>
        editor.chain().focus().deleteRange(range).setMathBlock().run(),
    },
    {
      title: "Mermaid diagram",
      description: "Insert mermaid diagram",
      searchTerms: ["mermaid", "diagrams", "chart", "uml"],
      icon: IconMermaid,
      command: ({ editor, range }: CommandProps) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setCodeBlock({ language: "mermaid" })
          .insertContent("flowchart LR\n" + "    A --> B")
          .run(),
    },
    {
      title: "Draw.io (diagrams.net)",
      description: "Insert and design Drawio diagrams",
      searchTerms: ["drawio", "diagrams", "charts", "uml", "whiteboard"],
      icon: IconDrawio,
      command: ({ editor, range }: CommandProps) =>
        editor.chain().focus().deleteRange(range).setDrawio().run(),
    },
    {
      title: "Excalidraw (Whiteboard)",
      description: "Draw and sketch excalidraw diagrams",
      searchTerms: ["diagrams", "draw", "sketch", "whiteboard"],
      icon: IconExcalidraw,
      command: ({ editor, range }: CommandProps) =>
        editor.chain().focus().deleteRange(range).setExcalidraw().run(),
    },
    {
      title: "Date",
      description: "Insert current date",
      searchTerms: ["date", "today"],
      icon: IconCalendar,
      command: ({ editor, range }: CommandProps) => {
        const currentDate = new Date().toLocaleDateString(i18n.language, {
          year: "numeric",
          month: "long",
          day: "numeric",
        });

        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent(currentDate)
          .run();
      },
    },
    {
      title: "Time",
      description: "Insert current time",
      searchTerms: ["time", "now", "clock"],
      icon: IconClock,
      command: ({ editor, range }: CommandProps) => {
        const currentTime = new Date().toLocaleTimeString(i18n.language, {
          hour: "numeric",
          minute: "numeric",
        });

        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent(currentTime)
          .run();
      },
    },
    {
      title: "Status",
      description: "Insert inline status badge.",
      searchTerms: ["status", "badge", "label", "lozenge"],
      icon: IconTag,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setStatus({ text: "", color: "gray" })
          .run();
      },
    },
    {
      title: "Emoji",
      description: "Insert emoji.",
      searchTerms: ["emoji", "icon", "smiley", "emoticon", "symbol", "reaction"],
      icon: IconMoodSmile,
      command: ({ editor, range }: CommandProps) => {
        editor.chain().focus().deleteRange(range).insertContent(":").run();
      },
    },
    {
      title: "Subpages (Child pages)",
      description: "List all subpages of the current page",
      searchTerms: [
        "subpages",
        "child",
        "children",
        "nested",
        "hierarchy",
        "toc",
      ],
      icon: IconSitemap,
      command: ({ editor, range }: CommandProps) => {
        editor.chain().focus().deleteRange(range).insertSubpages().run();
      },
    },
    {
      title: "Synced block",
      description: "Create a block that stays in sync across pages.",
      searchTerms: [
        "sync",
        "synced",
        "synced block",
        "excerpt",
        "transclusion",
        "reusable",
        "snippet",
      ],
      icon: IconRotate2,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTransclusionSource()
          .run();
      },
    },
    {
      title: "2 Columns",
      description: "Split content into two columns.",
      searchTerms: ["columns", "layout", "split", "side"],
      icon: IconColumns2,
      command: ({ editor, range }: CommandProps) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertColumns({ layout: "two_equal" })
          .run(),
    },
    {
      title: "3 Columns",
      description: "Split content into three columns.",
      searchTerms: ["columns", "layout", "split", "triple"],
      icon: IconColumns3,
      command: ({ editor, range }: CommandProps) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertColumns({ layout: "three_equal" })
          .run(),
    },
    {
      title: "4 Columns",
      description: "Split content into four columns.",
      searchTerms: ["columns", "layout", "split"],
      icon: IconColumns4,
      command: ({ editor, range }: CommandProps) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertColumns({ layout: "four_equal" })
          .run(),
    },
    {
      title: "5 Columns",
      description: "Split content into five columns.",
      searchTerms: ["columns", "layout", "split"],
      icon: IconColumns5,
      command: ({ editor, range }: CommandProps) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertColumns({ layout: "five_equal" })
          .run(),
    },
    {
      title: "Iframe embed",
      description: "Embed any Iframe",
      searchTerms: ["iframe"],
      icon: IconAppWindow,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setEmbed({ provider: "iframe" })
          .run();
      },
    },
    {
      title: "Airtable",
      description: "Embed Airtable",
      searchTerms: ["airtable"],
      icon: AirtableIcon,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setEmbed({ provider: "airtable" })
          .run();
      },
    },
    {
      title: "Loom",
      description: "Embed Loom video",
      searchTerms: ["loom"],
      icon: LoomIcon,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setEmbed({ provider: "loom" })
          .run();
      },
    },
    {
      title: "Figma",
      description: "Embed Figma files",
      searchTerms: ["figma"],
      icon: FigmaIcon,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setEmbed({ provider: "figma" })
          .run();
      },
    },
    {
      title: "Typeform",
      description: "Embed Typeform",
      searchTerms: ["typeform"],
      icon: TypeformIcon,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setEmbed({ provider: "typeform" })
          .run();
      },
    },
    {
      title: "Miro",
      description: "Embed Miro board",
      searchTerms: ["miro"],
      icon: MiroIcon,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setEmbed({ provider: "miro" })
          .run();
      },
    },
    {
      title: "YouTube",
      description: "Embed YouTube video",
      searchTerms: ["youtube", "yt", "media", "video"],
      icon: YoutubeIcon,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setEmbed({ provider: "youtube" })
          .run();
      },
    },
    {
      title: "Vimeo",
      description: "Embed Vimeo video",
      searchTerms: ["vimeo"],
      icon: VimeoIcon,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setEmbed({ provider: "vimeo" })
          .run();
      },
    },
    {
      title: "Framer",
      description: "Embed Framer prototype",
      searchTerms: ["framer"],
      icon: FramerIcon,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setEmbed({ provider: "framer" })
          .run();
      },
    },
    {
      title: "Google Drive",
      description: "Embed Google Drive content",
      searchTerms: ["google drive", "gdrive"],
      icon: GoogleDriveIcon,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setEmbed({ provider: "gdrive" })
          .run();
      },
    },
    {
      title: "Google Sheets",
      description: "Embed Google Sheets content",
      searchTerms: ["google sheets", "gsheets"],
      icon: GoogleSheetsIcon,
      command: ({ editor, range }: CommandProps) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setEmbed({ provider: "gsheets" })
          .run();
      },
    },
  ],
};

export const getSuggestionItems = ({
  query,
  excludeItems,
}: {
  query: string;
  excludeItems?: Set<string>;
}): SlashMenuGroupedItemsType => {
  const search = query.toLowerCase();
  const filteredGroups: SlashMenuGroupedItemsType = {};

  const fuzzyMatch = (query: string, target: string) => {
    let queryIndex = 0;
    target = target.toLowerCase();
    for (const char of target) {
      if (query[queryIndex] === char) queryIndex++;
      if (queryIndex === query.length) return true;
    }
    return false;
  };

  for (const [group, items] of Object.entries(CommandGroups)) {
    const filteredItems = items.filter((item) => {
      if (excludeItems?.has(item.title)) return false;
      const translatedTitle = i18n.t(item.title);
      const translatedDescription = i18n.t(item.description);
      return (
        fuzzyMatch(search, item.title) ||
        fuzzyMatch(search, translatedTitle) ||
        item.description.toLowerCase().includes(search) ||
        translatedDescription.toLowerCase().includes(search) ||
        (item.searchTerms &&
          item.searchTerms.some(
            (term: string) =>
              term.includes(search) ||
              i18n.t(term).toLowerCase().includes(search),
          ))
      );
    });

    if (filteredItems.length) {
      filteredGroups[group] = filteredItems.sort((a, b) => {
        const aTitle =
          a.title.toLowerCase().includes(search) ||
          i18n.t(a.title).toLowerCase().includes(search)
            ? 0
            : 1;
        const bTitle =
          b.title.toLowerCase().includes(search) ||
          i18n.t(b.title).toLowerCase().includes(search)
            ? 0
            : 1;
        return aTitle - bTitle;
      });
    }
  }

  return filteredGroups;
};

export default getSuggestionItems;
