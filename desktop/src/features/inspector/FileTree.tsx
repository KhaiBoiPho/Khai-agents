import { ChevronRight } from "lucide-react";
import { useMemo, useRef, type KeyboardEvent } from "react";

import { FileIcon, FolderIcon } from "./FileIcon";
import type { TreeNode } from "./treeModel";
import type { DocumentIndexState } from "./useDocumentIndex";
import { displayFileName } from "../../app/fileNames";
import styles from "./FilesPanel.module.css";

interface Row {
  node: TreeNode;
  depth: number;
  parent: string | null;
}

/** The rows a reader can see: children of collapsed folders are left out. */
function visibleRows(
  nodes: readonly TreeNode[],
  expanded: ReadonlySet<string>,
  depth = 0,
  parent: string | null = null,
): Row[] {
  return nodes.flatMap((node) => [
    { node, depth, parent },
    ...(node.kind === "directory" && expanded.has(node.path)
      ? visibleRows(node.children, expanded, depth + 1, node.path)
      : []),
  ]);
}

interface FileTreeProps {
  nodes: readonly TreeNode[];
  expanded: ReadonlySet<string>;
  selectedPath: string | null;
  onToggle(path: string, open?: boolean): void;
  onOpen(path: string): void;
  /** Document-search index state of document files, shown as a badge. */
  indexStates?: ReadonlyMap<string, DocumentIndexState>;
}

const INDEX_LABELS: Record<DocumentIndexState, string> = {
  indexed: "Indexed for document search",
  pending: "Waiting to be indexed for document search",
  failed: "Could not be indexed for document search",
};

/**
 * A VS Code style explorer: chevrons, folder and language icons, indent
 * guides, and arrow-key navigation (↑↓ move, → open/enter, ← close/up).
 */
export function FileTree({
  nodes,
  expanded,
  selectedPath,
  onToggle,
  onOpen,
  indexStates,
}: FileTreeProps) {
  const rows = useMemo(() => visibleRows(nodes, expanded), [nodes, expanded]);
  const listRef = useRef<HTMLDivElement | null>(null);

  const focusRow = (index: number) => {
    const target = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-row]")[index];
    target?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const { node, parent } = rows[index];
    const isFolder = node.kind === "directory";
    switch (event.key) {
      case "ArrowDown":
        focusRow(Math.min(index + 1, rows.length - 1));
        break;
      case "ArrowUp":
        focusRow(Math.max(index - 1, 0));
        break;
      case "ArrowRight":
        if (isFolder && !expanded.has(node.path)) onToggle(node.path, true);
        else if (isFolder) focusRow(index + 1);
        break;
      case "ArrowLeft":
        if (isFolder && expanded.has(node.path)) onToggle(node.path, false);
        else if (parent) focusRow(rows.findIndex((row) => row.node.path === parent));
        break;
      case "Home":
        focusRow(0);
        break;
      case "End":
        focusRow(rows.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className={styles.tree} ref={listRef} role="tree" aria-label="Workspace files">
      {rows.map(({ node, depth }, index) => {
        const isFolder = node.kind === "directory";
        const open = isFolder && expanded.has(node.path);
        const indexState = isFolder ? undefined : indexStates?.get(node.path);
        return (
          <button
            key={node.path}
            type="button"
            role="treeitem"
            data-row
            aria-level={depth + 1}
            aria-expanded={isFolder ? open : undefined}
            aria-selected={node.path === selectedPath}
            className={styles.row}
            title={node.path}
            onClick={() => (isFolder ? onToggle(node.path) : onOpen(node.path))}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {Array.from({ length: depth }, (_, level) => (
              <span key={level} className={styles.guide} aria-hidden="true" />
            ))}
            <span className={styles.twisty} aria-hidden="true">
              {isFolder ? (
                <ChevronRight size={14} className={styles.chevron} data-open={open} />
              ) : null}
            </span>
            {isFolder ? <FolderIcon open={open} /> : <FileIcon name={node.name} />}
            <span className={styles.name} data-symlink={node.kind === "symlink" || undefined}>
              {displayFileName(node.name)}
            </span>
            {indexState ? (
              <span
                className={styles.indexBadge}
                data-state={indexState}
                title={INDEX_LABELS[indexState]}
                aria-label={INDEX_LABELS[indexState]}
                role="img"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
