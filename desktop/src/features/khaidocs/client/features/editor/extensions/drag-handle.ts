import { Extension } from "@tiptap/core";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from "@tiptap/pm/state";
import { Fragment, Slice, Node } from "@tiptap/pm/model";
import { EditorView } from "@tiptap/pm/view";
import { BLOCK_HANDLE_MENU_EVENT } from "../components/block-actions-menu";

export interface GlobalDragHandleOptions {
  /**
   * The width of the drag handle
   */
  dragHandleWidth: number;

  /**
   * The treshold for scrolling
   */
  scrollThreshold: number;

  /*
   * The css selector to query for the drag handle. (eg: '.custom-handle').
   * If handle element is found, that element will be used as drag handle. If not, a default handle will be created
   */
  dragHandleSelector?: string;

  /**
   * Tags to be excluded for drag handle
   */
  excludedTags: string[];

  /**
   * Custom nodes to be included for drag handle
   */
  customNodes: string[];

  atomNodes: string[];
}
function absoluteRect(node: Element) {
  const data = node.getBoundingClientRect();
  // KhaiDocs applies `contain: layout paint` to its root, which makes that
  // root the containing block for this fixed-position handle. Convert the
  // viewport coordinates into the root's local coordinates before assigning
  // `left`/`top`, otherwise the app/sidebar offset is added a second time.
  const appRoot = node.closest<HTMLElement>(".khaidocs-root");
  if (appRoot) {
    const rootRect = appRoot.getBoundingClientRect();
    return {
      top: data.top - rootRect.top,
      left: data.left - rootRect.left,
      width: data.width,
    };
  }

  const modal = node.closest('[role="dialog"]');

  if (modal && window.getComputedStyle(modal).transform !== "none") {
    const modalRect = modal.getBoundingClientRect();

    return {
      top: data.top - modalRect.top,
      left: data.left - modalRect.left,
      width: data.width,
    };
  }
  return {
    top: data.top,
    left: data.left,
    width: data.width,
  };
}

function nodeDOMAtCoords(
  coords: { x: number; y: number },
  options: GlobalDragHandleOptions,
  view: EditorView,
) {
  // Custom nodes (transclusion, …) render via tiptap's React node-view
  // renderer, which emits `class="react-renderer node-${name}"` on the
  // live wrapper — the `data-type` attribute is for static HTML
  // serialization only. Match both so we cover live and parsed DOM.
  // Inside a custom node, also match plain `p` so the first paragraph
  // (which doesn't match `:not(:first-child)`) still gets its own
  // handle; only hovers on the custom node's padding/border fall
  // through to the wrapper.
  const customSelectors = options.customNodes.flatMap((node) => [
    `[data-type=${node}]`,
    `.node-${node}`,
  ]);
  const customParagraphSelectors = options.customNodes.flatMap((node) => [
    `[data-type=${node}] p`,
    `.node-${node} p`,
  ]);
  const atomSelectors = options.atomNodes.flatMap((node) => [
    `[data-type=${node}]`,
    `.node-${node}`,
  ]);

  const selectors = [
    "li",
    "p:not(:first-child)",
    "pre",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    // Tables nested in another block (toggle, transclusion, …) have a
    // wrapper that isn't a direct child of .ProseMirror, so the
    // parent-check below skips it. Match the wrapper explicitly so the
    // handle shows up even with empty cells.
    ".tableWrapper",
    ...customParagraphSelectors,
    ...customSelectors,
    ...atomSelectors,
  ].join(", ");
  const found = document
    .elementsFromPoint(coords.x, coords.y)
    .find((elem: Element) => {
      // Skip elements that belong to a nested editor (e.g. transclusion
      // references render their own ProseMirror instance). Only consider
      // elements whose closest editor is this host view.
      if (elem.closest(".ProseMirror") !== view.dom) return false;
      return (
        elem.parentElement?.matches?.(".ProseMirror") ||
        elem.matches(selectors)
      );
    });
  if (found && atomSelectors.length > 0) {
    const atomWrapper = found.closest(atomSelectors.join(", "));
    if (atomWrapper) return atomWrapper;
  }
  return found;
}
function nodePosAtDOM(
  node: Element,
  view: EditorView,
  options: GlobalDragHandleOptions,
) {
  const boundingRect = node.getBoundingClientRect();

  return view.posAtCoords({
    left: boundingRect.left + 50 + options.dragHandleWidth,
    top: boundingRect.top + 1,
  })?.inside;
}

function isCustomNodeDOM(
  elem: Element | null | undefined,
  options: GlobalDragHandleOptions,
): boolean {
  if (!elem) return false;
  for (const name of [...options.customNodes, ...options.atomNodes]) {
    if (
      elem.getAttribute("data-type") === name ||
      elem.classList.contains(`node-${name}`)
    ) {
      return true;
    }
  }
  return false;
}

function calcNodePos(pos: number, view: EditorView) {
  const $pos = view.state.doc.resolve(pos);
  if ($pos.depth > 1) return $pos.before($pos.depth);
  return pos;
}

export function DragHandlePlugin(
  options: GlobalDragHandleOptions & { pluginKey: string },
) {
  let listType = "";
  function handleDragStart(event: DragEvent, view: EditorView) {
    view.focus();

    if (!event.dataTransfer) return;

    const node = nodeDOMAtCoords(
      {
        x: event.clientX + 50 + options.dragHandleWidth,
        y: event.clientY,
      },
      options,
      view,
    );

    if (!(node instanceof Element)) return;

    let draggedNodePos = nodePosAtDOM(node, view, options);
    if (draggedNodePos == null || draggedNodePos < 0) return;
    draggedNodePos = calcNodePos(draggedNodePos, view);

    const { from, to } = view.state.selection;
    const diff = from - to;

    const fromSelectionPos = calcNodePos(from, view);
    let differentNodeSelected = false;

    const nodePos = view.state.doc.resolve(fromSelectionPos);

    if (nodePos.node().type.name === "doc") differentNodeSelected = true;
    else {
      const nodeSelection = NodeSelection.create(
        view.state.doc,
        nodePos.before(),
      );

      // Check if the node where the drag event started is part of the current selection
      differentNodeSelected = !(
        draggedNodePos + 1 >= nodeSelection.$from.pos &&
        draggedNodePos <= nodeSelection.$to.pos
      );
    }
    let selection = view.state.selection;
    if (
      !differentNodeSelected &&
      diff !== 0 &&
      !(view.state.selection instanceof NodeSelection)
    ) {
      const endSelection = NodeSelection.create(view.state.doc, to - 1);
      selection = TextSelection.create(
        view.state.doc,
        draggedNodePos,
        endSelection.$to.pos,
      );
    } else {
      selection = NodeSelection.create(view.state.doc, draggedNodePos);

      const $sel = view.state.doc.resolve(selection.from);

      if (isCustomNodeDOM(node, options)) {
        // The drag landed on a custom-node container (transclusion etc.).
        // Walk up to the matching node so the drag moves the whole
        // container, not whatever inner element the click landed on.
        const customTypes = new Set([
          ...options.customNodes,
          ...options.atomNodes,
        ]);
        for (let d = $sel.depth; d > 0; d--) {
          if (customTypes.has($sel.node(d).type.name)) {
            selection = NodeSelection.create(
              view.state.doc,
              $sel.before(d),
            );
            break;
          }
        }
      } else {
        // If the selected node lives inside a table (at any nesting
        // depth), promote to the whole table — the global drag handle is
        // meant to move the table as a single block, not a row/cell. The
        // earlier tableRow-only check only worked when the table sat at
        // the doc root; once wrapped in another node (toggle, layout,
        // etc.) the selection lands on a cell/paragraph and that check
        // never fired.
        let tableDepth = -1;
        for (let d = $sel.depth; d > 0; d--) {
          if ($sel.node(d).type.name === "table") {
            tableDepth = d;
            break;
          }
        }
        if (tableDepth > 0) {
          selection = NodeSelection.create(
            view.state.doc,
            $sel.before(tableDepth),
          );
        } else if ((selection as NodeSelection).node.type.isInline) {
          // Inline node (e.g. mention): walk up to the parent block.
          selection = NodeSelection.create(view.state.doc, $sel.before());
        }
      }
    }
    view.dispatch(view.state.tr.setSelection(selection));

    // If the selected node is a list item, we need to save the type of the wrapping list e.g. OL or UL
    if (
      view.state.selection instanceof NodeSelection &&
      view.state.selection.node.type.name === "listItem"
    ) {
      listType = node.parentElement!.tagName;
    }

    const slice = view.state.selection.content();
    const { dom, text } = view.serializeForClipboard(slice);

    event.dataTransfer.clearData();
    event.dataTransfer.setData("text/html", dom.innerHTML);
    event.dataTransfer.setData("text/plain", text);
    event.dataTransfer.effectAllowed = "move";

    const previewTemplate =
      node.querySelector<HTMLElement>("[data-drag-preview]");
    if (previewTemplate) {
      const preview = previewTemplate.cloneNode(true) as HTMLElement;
      preview.removeAttribute("hidden");
      preview.style.position = "fixed";
      preview.style.top = "0";
      preview.style.left = "-10000px";
      preview.style.pointerEvents = "none";
      document.body.appendChild(preview);
      event.dataTransfer.setDragImage(preview, 0, 0);
      document.addEventListener("dragend", () => preview.remove(), {
        once: true,
      });
    } else {
      event.dataTransfer.setDragImage(node, 0, 0);
    }

    view.dragging = { slice, move: event.ctrlKey };
  }

  let dragHandleElement: HTMLElement | null = null;
  let insertBlockButton: HTMLButtonElement | null = null;
  let hoveredNodePosition: number | null = null;

  function positionInsertButton(left: number, top: number) {
    if (!insertBlockButton) return;
    // Keep the add control close to the drag/menu handle, with a small
    // six-pixel gap between their hit areas.
    insertBlockButton.style.left = `${left - 40}px`;
    insertBlockButton.style.top = `${top}px`;
  }

  function hideDragHandle() {
    if (dragHandleElement) {
      dragHandleElement.classList.add("hide");
    }
    insertBlockButton?.classList.add("hide");
    hoveredNodePosition = null;
  }

  function showDragHandle() {
    if (dragHandleElement) {
      dragHandleElement.classList.remove("hide");
    }
    insertBlockButton?.classList.remove("hide");
  }

  function hideHandleOnEditorOut(event: MouseEvent) {
    if (event.target instanceof Element) {
      // Check if the relatedTarget class is still inside the editor
      const relatedTarget = event.relatedTarget as HTMLElement;
      const isInsideEditor =
        relatedTarget?.classList.contains("tiptap") ||
        Boolean(relatedTarget?.closest(".drag-handle, .drag-handle-add"));

      if (isInsideEditor) return;
    }
    hideDragHandle();
  }

  return new Plugin({
    key: new PluginKey(options.pluginKey),
    view: (view) => {
      const handleBySelector = options.dragHandleSelector
        ? document.querySelector<HTMLElement>(options.dragHandleSelector)
        : null;
      dragHandleElement = handleBySelector ?? document.createElement("div");
      dragHandleElement.draggable = true;
      dragHandleElement.dataset.dragHandle = "";
      dragHandleElement.classList.add("drag-handle");

      insertBlockButton = document.createElement("button");
      insertBlockButton.type = "button";
      insertBlockButton.className = "drag-handle-add";
      insertBlockButton.setAttribute("aria-label", "Insert block below");
      insertBlockButton.title = "Insert block below";
      const plusIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      plusIcon.setAttribute("viewBox", "0 0 20 20");
      plusIcon.setAttribute("width", "16");
      plusIcon.setAttribute("height", "16");
      plusIcon.setAttribute("aria-hidden", "true");
      plusIcon.innerHTML = '<path d="M10 3.5v13M3.5 10h13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />';
      insertBlockButton.appendChild(plusIcon);
      insertBlockButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const position = hoveredNodePosition;
        if (position === null) return;
        const node = view.state.doc.nodeAt(position);
        const paragraph = view.state.schema.nodes.paragraph?.createAndFill();
        if (!node || !paragraph) return;
        const insertAt = position + node.nodeSize;
        const tr = view.state.tr.insert(insertAt, paragraph);
        tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
        view.dispatch(tr.scrollIntoView());
        view.focus();
      });

      function onDragHandleDragStart(e: DragEvent) {
        handleDragStart(e, view);
      }

      dragHandleElement.addEventListener("dragstart", onDragHandleDragStart);

      function onDragHandleDrag(e: DragEvent) {
        hideDragHandle();
        let scrollY = window.scrollY;
        if (e.clientY < options.scrollThreshold) {
          window.scrollTo({ top: scrollY - 30, behavior: "smooth" });
        } else if (window.innerHeight - e.clientY < options.scrollThreshold) {
          window.scrollTo({ top: scrollY + 30, behavior: "smooth" });
        }
      }

      function onDragHandleClick(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        let position = hoveredNodePosition;
        if (position === null) {
          const node = nodeDOMAtCoords(
            { x: event.clientX + 50 + options.dragHandleWidth, y: event.clientY },
            options,
            view,
          );
          if (!(node instanceof Element)) return;
          const rawPosition = nodePosAtDOM(node, view, options);
          if (rawPosition == null || rawPosition < 0) return;
          position = calcNodePos(rawPosition, view);
        }
        const selectedNode = view.state.doc.nodeAt(position);
        if (!selectedNode || !NodeSelection.isSelectable(selectedNode)) return;
        view.dispatch(
          view.state.tr
            .setSelection(NodeSelection.create(view.state.doc, position))
            .scrollIntoView(),
        );
        view.focus();
        window.dispatchEvent(
          new CustomEvent(BLOCK_HANDLE_MENU_EVENT, {
            detail: { x: event.clientX, y: event.clientY },
          }),
        );
      }

      dragHandleElement.addEventListener("drag", onDragHandleDrag);
      dragHandleElement.addEventListener("click", onDragHandleClick);

      hideDragHandle();

      if (!handleBySelector) {
        const handleRoot = view.dom.closest(".khaidocs-root") ?? view.dom.parentElement;
        handleRoot?.appendChild(insertBlockButton);
        handleRoot?.appendChild(dragHandleElement);
      }
      view?.dom?.parentElement?.addEventListener(
        "mouseout",
        hideHandleOnEditorOut,
      );

      return {
        destroy: () => {
          if (!handleBySelector) {
            dragHandleElement?.remove?.();
            insertBlockButton?.remove();
          }
          dragHandleElement?.removeEventListener("drag", onDragHandleDrag);
          dragHandleElement?.removeEventListener("click", onDragHandleClick);
          dragHandleElement?.removeEventListener(
            "dragstart",
            onDragHandleDragStart,
          );
          dragHandleElement = null;
          insertBlockButton = null;
          view?.dom?.parentElement?.removeEventListener(
            "mouseout",
            hideHandleOnEditorOut,
          );
        },
      };
    },
    props: {
      handleDOMEvents: {
        mousemove: (view, event) => {
          if (!view.editable) {
            return;
          }

          const node = nodeDOMAtCoords(
            {
              x: event.clientX + 50 + options.dragHandleWidth,
              y: event.clientY,
            },
            options,
            view,
          );

          const notDragging = node?.closest(".not-draggable");
          const excludedTagList = options.excludedTags
            .concat(["ol", "ul"])
            .join(", ");

          if (
            !(node instanceof Element) ||
            node.matches(excludedTagList) ||
            notDragging
          ) {
            hideDragHandle();
            return;
          }

          const rawPosition = nodePosAtDOM(node, view, options);
          hoveredNodePosition = rawPosition == null || rawPosition < 0
            ? null
            : calcNodePos(rawPosition, view);

          const isCustomNode = isCustomNodeDOM(node, options);

          // Custom nodes pin the handle to the inner NodeViewWrapper's top-left:
          // the natural anchor sits in transient/empty space outside the visible block.
          if (isCustomNode) {
            // tiptap React node-views emit an outer `.react-renderer` whose first
            // child is the visible NodeViewWrapper; walk to that outer first since
            // `node` may be either the outer or an inner element with data-type.
            const rendererOuter =
              (node.closest(".react-renderer") as HTMLElement | null) ?? node;
            const inner =
              (rendererOuter.firstElementChild as HTMLElement | null) ??
              rendererOuter;
            const innerRect = absoluteRect(inner);
            if (!dragHandleElement) return;
            dragHandleElement.style.left = `${innerRect.left - 8}px`;
            dragHandleElement.style.top = `${innerRect.top + 4}px`;
            positionInsertButton(innerRect.left + 4, innerRect.top + 4);
            showDragHandle();
            return;
          }

          const compStyle = window.getComputedStyle(node);
          const parsedLineHeight = parseInt(compStyle.lineHeight, 10);
          const lineHeight = isNaN(parsedLineHeight)
            ? parseInt(compStyle.fontSize) * 1.2
            : parsedLineHeight;
          const paddingTop = parseInt(compStyle.paddingTop, 10);

          const rect = absoluteRect(node);

          rect.top += (lineHeight - 24) / 2;
          rect.top += paddingTop;
          // Li markers
          if (node.matches("ul:not([data-type=taskList]) li, ol li")) {
            rect.left -= options.dragHandleWidth;
          }
          // Tables: clear the table's own row-drag handle so the two
          // grips don't stack on each other. `nodeDOMAtCoords` returns
          // the wrapper for top-level hovers (wrapper is direct child of
          // .ProseMirror) and a descendant for deeper hovers — cover both.
          if (node.closest(".tableWrapper")) {
            rect.left -= options.dragHandleWidth;
          }
          rect.width = options.dragHandleWidth;

          if (!dragHandleElement) return;

          dragHandleElement.style.left = `${rect.left - rect.width - 12}px`;
          dragHandleElement.style.top = `${rect.top}px`;
          positionInsertButton(rect.left - rect.width, rect.top);
          showDragHandle();
        },
        keydown: () => {
          hideDragHandle();
        },
        mousewheel: () => {
          hideDragHandle();
        },
        // dragging class is used for CSS
        dragstart: (view) => {
          view.dom.classList.add("dragging");
        },
        drop: (view, event) => {
          view.dom.classList.remove("dragging");
          hideDragHandle();
          let droppedNode: Node | null = null;
          const dropPos = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });

          if (!dropPos) return;

          if (view.state.selection instanceof NodeSelection) {
            droppedNode = view.state.selection.node;
          }
          if (!droppedNode) return;

          const resolvedPos = view.state.doc.resolve(dropPos.pos);

          const isDroppedInsideList =
            resolvedPos.parent.type.name === "listItem";

          // If the selected node is a list item and is not dropped inside a list, we need to wrap it inside <ol> tag otherwise ol list items will be transformed into ul list item when dropped
          if (
            view.state.selection instanceof NodeSelection &&
            view.state.selection.node.type.name === "listItem" &&
            !isDroppedInsideList &&
            listType == "OL"
          ) {
            const newList = view.state.schema.nodes.orderedList?.createAndFill(
              null,
              droppedNode,
            );
            const slice = new Slice(Fragment.from(newList), 0, 0);
            view.dragging = { slice, move: event.ctrlKey };
          }
        },
        dragend: (view) => {
          view.dom.classList.remove("dragging");
        },
      },
    },
  });
}

const GlobalDragHandle = Extension.create({
  name: "globalDragHandle",

  addOptions() {
    return {
      dragHandleWidth: 20,
      scrollThreshold: 100,
      excludedTags: [],
      customNodes: [],
      atomNodes: [],
    };
  },

  addProseMirrorPlugins() {
    return [
      DragHandlePlugin({
        pluginKey: "globalDragHandle",
        dragHandleWidth: this.options.dragHandleWidth,
        scrollThreshold: this.options.scrollThreshold,
        dragHandleSelector: this.options.dragHandleSelector,
        excludedTags: this.options.excludedTags,
        customNodes: this.options.customNodes,
        atomNodes: this.options.atomNodes,
      }),
    ];
  },
});

export default GlobalDragHandle;
