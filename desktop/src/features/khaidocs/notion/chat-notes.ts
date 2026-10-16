import { generateJitteredKeyBetween } from "fractional-indexing-jittered";

export interface ChatNotesFolder {
  id: string;
  slugId: string;
  title: string;
  spaceId: string;
}

interface SidebarPage extends ChatNotesFolder {
  icon?: string | null;
  parentPageId?: string | null;
  position?: string;
}

interface SidebarPageList {
  items?: SidebarPage[];
  meta?: { nextCursor?: string | null };
}

export const CHAT_NOTES_INDEX_PREFIX = "deepcode.desktop.chat-khaidocs.v1.";
const FOLDER_KEY_PREFIX = "deepcode.desktop.khaidocs-chat-notes-folder.v1.";
const FOLDER_TITLE = "Ghi chú chat";

export function getChatNotesFolderId(spaceId: string): string | null {
  try { return localStorage.getItem(`${FOLDER_KEY_PREFIX}${spaceId}`); } catch { return null; }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) throw new Error(`KhaiDocs không thể tải dữ liệu (${response.status}).`);
  const json = await response.json();
  return json?.data ?? json;
}

async function listSidebarPages(spaceId: string, pageId?: string): Promise<SidebarPage[]> {
  const pages: SidebarPage[] = [];
  let cursor: string | null = null;
  do {
    const result: SidebarPageList = await api<SidebarPageList>("/pages/sidebar-pages", {
      spaceId,
      ...(pageId ? { pageId } : {}),
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    pages.push(...(result.items ?? []));
    cursor = result.meta?.nextCursor ?? null;
  } while (cursor);
  return pages;
}

function folderIcon(color = "gray") {
  return `ti:folder:${color}`;
}

function isFolder(icon?: string | null) {
  return typeof icon === "string" && /^ti:folder(?::|$)/.test(icon);
}

export async function ensureChatNotesFolder(spaceId: string): Promise<ChatNotesFolder> {
  const key = `${FOLDER_KEY_PREFIX}${spaceId}`;
  let savedId = "";
  try { savedId = localStorage.getItem(key) ?? ""; } catch { /* storage may be unavailable */ }

  if (savedId) {
    try {
      const saved = await api<SidebarPage>("/pages/info", { pageId: savedId });
      if (saved?.spaceId === spaceId && isFolder(saved.icon)) return saved;
    } catch { /* recreate or discover the archive folder below */ }
  }

  const roots = await listSidebarPages(spaceId);
  const existing = roots.find((page) =>
    page.spaceId === spaceId && page.title === FOLDER_TITLE && isFolder(page.icon) && !page.parentPageId,
  );
  if (existing) {
    try { localStorage.setItem(key, existing.id); } catch { /* KhaiDocs still holds the folder */ }
    return existing;
  }

  const created = await api<SidebarPage>("/pages/create", {
    spaceId,
    title: FOLDER_TITLE,
    icon: folderIcon(),
  });
  try { localStorage.setItem(key, created.id); } catch { /* KhaiDocs still holds the folder */ }
  return created;
}

/** Moves previously created chat-note pages under the shared KhaiDocs folder. */
export async function organizeIndexedChatNotes(spaceId: string, folderId: string): Promise<string[]> {
  const ids = new Set<string>();
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(CHAT_NOTES_INDEX_PREFIX)) continue;
      const value = JSON.parse(localStorage.getItem(key) ?? "null");
      if (value?.version !== 1 || !value.pages || typeof value.pages !== "object") continue;
      Object.keys(value.pages).forEach((id) => ids.add(id));
    }
  } catch { /* already-created pages remain available in KhaiDocs */ }

  // Older chat notes may predate the companion's localStorage index. Find
  // those note pages in the KhaiDocs root as well, so they are not left beside
  // the archive folder in the Private tree.
  const rootPages = await listSidebarPages(spaceId);
  rootPages
    .filter((page) => !page.parentPageId && /^Ghi chú\s*[·•]/i.test(page.title?.trim() ?? ""))
    .forEach((page) => ids.add(page.id));

  const loaded = await Promise.all([...ids].map(async (pageId) => {
    try { return await api<SidebarPage>("/pages/info", { pageId }); } catch { return null; }
  }));
  const pages = loaded.filter((page): page is SidebarPage => Boolean(
    page && page.spaceId === spaceId && page.id !== folderId && page.parentPageId !== folderId,
  ));
  if (!pages.length) return [];

  const children = await listSidebarPages(spaceId, folderId);
  let position = children.at(-1)?.position ?? null;
  for (const page of pages) {
    const nextPosition = generateJitteredKeyBetween(position, null);
    await api("/pages/move", { pageId: page.id, parentPageId: folderId, position: nextPosition });
    position = nextPosition;
  }
  return pages.map((page) => page.id);
}
