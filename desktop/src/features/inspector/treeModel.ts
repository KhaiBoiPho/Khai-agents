/**
 * The workspace listing arrives flat (`workspace/files`, depth-first paths);
 * the Files panel shows it as a VS Code style tree.
 */

import type { FileEntry } from "../../generated/app-server";

export interface TreeNode {
  name: string;
  path: string;
  kind: FileEntry["kind"];
  children: TreeNode[];
}

const byExplorerOrder = (left: TreeNode, right: TreeNode) => {
  const leftDir = left.kind === "directory";
  if (leftDir !== (right.kind === "directory")) return leftDir ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

/** Nests the flat listing; folders first, then natural name order. */
export function buildTree(entries: readonly FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();
  const ensureDirectory = (path: string): TreeNode[] => {
    if (!path) return root;
    const existing = byPath.get(path);
    if (existing) return existing.children;
    // A listing cut off at its entry limit can name a file whose folder
    // entry never arrived; synthesise the folder rather than drop the file.
    const slash = path.lastIndexOf("/");
    const node: TreeNode = {
      name: path.slice(slash + 1),
      path,
      kind: "directory",
      children: [],
    };
    byPath.set(path, node);
    ensureDirectory(slash === -1 ? "" : path.slice(0, slash)).push(node);
    return node.children;
  };
  for (const entry of entries) {
    const slash = entry.path.lastIndexOf("/");
    const parent = slash === -1 ? "" : entry.path.slice(0, slash);
    if (entry.kind === "directory") {
      ensureDirectory(entry.path);
      continue;
    }
    ensureDirectory(parent).push({
      name: entry.name,
      path: entry.path,
      kind: entry.kind,
      children: [],
    });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort(byExplorerOrder);
    for (const node of nodes) sort(node.children);
  };
  sort(root);
  return root;
}

/** Keeps files whose path contains `query` (case-insensitive) and their folders. */
export function filterTree(nodes: readonly TreeNode[], query: string): TreeNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...nodes];
  const keep = (node: TreeNode): TreeNode | null => {
    if (node.kind !== "directory") {
      return node.path.toLowerCase().includes(needle) ? node : null;
    }
    const children = node.children.map(keep).filter((child): child is TreeNode => child !== null);
    if (children.length) return { ...node, children };
    return node.name.toLowerCase().includes(needle) ? { ...node, children: [] } : null;
  };
  return nodes.map(keep).filter((node): node is TreeNode => node !== null);
}

/** Every folder above `path`, outermost first: "a/b/c.ts" → ["a", "a/b"]. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

/** Every folder path in the tree (for expanding a filtered view). */
export function directoryPaths(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "directory" ? [node.path, ...directoryPaths(node.children)] : [],
  );
}
