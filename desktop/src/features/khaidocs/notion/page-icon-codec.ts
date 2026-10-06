/*
 * Original KhaiDocs code, MIT.
 *
 * How a page icon is stored. Docmost keeps a page's icon as a free string in
 * `pages.icon` (an emoji). KhaiDocs also stores line icons from its curated
 * Tabler set there, as `ti:<name>:<colour>` (e.g. `ti:notebook:blue`); the
 * server keeps any string, so emoji icons keep working untouched.
 *
 * A "folder" is an ordinary page whose icon is `ti:folder:<colour>`: it nests
 * pages through Docmost's own parent/child pages, so nothing new is needed on
 * the server.
 */

export const ICON_COLORS = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;

export type IconColor = (typeof ICON_COLORS)[number];

export const TABLER_PREFIX = "ti:";
export const FOLDER_ICON_NAME = "folder";

export type ParsedPageIcon =
  | { kind: "emoji"; value: string }
  | { kind: "tabler"; name: string; color: IconColor };

const TABLER_RE = /^ti:([a-z0-9]+(?:-[a-z0-9]+)*)(?::([a-z]+))?$/;

export function isIconColor(value: unknown): value is IconColor {
  return typeof value === "string" && (ICON_COLORS as readonly string[]).includes(value);
}

/** Parses a stored icon; null for no icon. Unknown colours fall back to "default". */
export function parsePageIcon(icon: string | null | undefined): ParsedPageIcon | null {
  if (typeof icon !== "string") return null;
  const value = icon.trim();
  if (!value) return null;
  if (value.startsWith(TABLER_PREFIX)) {
    const match = TABLER_RE.exec(value);
    if (!match) return null;
    return {
      kind: "tabler",
      name: match[1],
      color: isIconColor(match[2]) ? match[2] : "default",
    };
  }
  return { kind: "emoji", value };
}

/** `ti:<name>:<colour>`; the colour is omitted for "default". */
export function encodeTablerIcon(name: string, color: IconColor = "default"): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`Invalid icon name: ${name}`);
  }
  return color === "default" ? `${TABLER_PREFIX}${name}` : `${TABLER_PREFIX}${name}:${color}`;
}

export function folderIcon(color: IconColor = "gray"): string {
  return encodeTablerIcon(FOLDER_ICON_NAME, color);
}

export function isFolderIcon(icon: string | null | undefined): boolean {
  const parsed = parsePageIcon(icon);
  return parsed?.kind === "tabler" && parsed.name === FOLDER_ICON_NAME;
}

/** Plain text for places that can only show a string (window title). */
export function iconAsText(icon: string | null | undefined): string {
  const parsed = parsePageIcon(icon);
  return parsed?.kind === "emoji" ? parsed.value : "";
}

type SortableNode = { icon?: string | null; children?: SortableNode[] };

/**
 * Folders first, then pages, within every level; otherwise keeps the
 * existing (position) order. Arrays and nodes are only copied where
 * something actually moved, so memoised rows keep their identity.
 */
export function sortFoldersFirst<T extends SortableNode>(nodes: T[]): T[] {
  if (!Array.isArray(nodes)) return nodes;
  let changed = false;
  const withSortedChildren = nodes.map((node) => {
    if (!node?.children?.length) return node;
    const children = sortFoldersFirst(node.children as T[]);
    if (children === node.children) return node;
    changed = true;
    return { ...node, children };
  });
  const folders = withSortedChildren.filter((n) => isFolderIcon(n?.icon));
  const pages = withSortedChildren.filter((n) => !isFolderIcon(n?.icon));
  const ordered = [...folders, ...pages];
  if (!changed && ordered.every((n, i) => n === nodes[i])) return nodes;
  return ordered;
}
