import { ChevronLeft, ChevronRight, FileText, LoaderCircle, NotebookPen, Plus } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import styles from "./ConversationCompanion.module.css";
import { ensureChatNotesFolder, organizeIndexedChatNotes } from "../khaidocs/notion/chat-notes";

interface Props {
  threadId: string;
  threadTitle: string;
}

interface Space { id: string; slug: string; createdAt: string | Date; }
interface Page { id: string; slugId: string; title: string; content?: string; spaceId: string; updatedAt?: string | Date; }
interface PageIndex { version: 1; pages: Record<string, string>; }

const KhaiDocsApp = lazy(() => import("khaidocs-app"));

const INDEX_PREFIX = "deepcode.desktop.chat-khaidocs.v1.";

function readIndex(threadId: string): PageIndex {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${INDEX_PREFIX}${threadId}`) || "null");
    if (parsed?.version === 1 && parsed.pages && typeof parsed.pages === "object") return parsed;
  } catch { /* recover with an empty index */ }
  return { version: 1, pages: {} };
}

function writeIndex(threadId: string, index: PageIndex) {
  try { localStorage.setItem(`${INDEX_PREFIX}${threadId}`, JSON.stringify(index)); } catch { /* KhaiDocs still holds the page */ }
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

function pagePath(spaceSlug: string, page: Page): string {
  return `/s/${encodeURIComponent(spaceSlug)}/p/${encodeURIComponent(page.slugId)}`;
}

/** "Vừa xong", "12 phút trước", "Hôm nay 14:32", "16 thg 10". */
function readableDate(value?: string | Date): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "Vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return `Hôm nay ${time}`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function ThreadNotesPanel({ threadId, threadTitle }: Props) {
  const [pages, setPages] = useState<Page[]>([]);
  const [space, setSpace] = useState<Space | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ path: string; title: string } | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const spacesResult = await api<{ items: Space[] }>("/spaces", { limit: 100 });
      const activeSpace = [...(spacesResult.items ?? [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
      if (!activeSpace) throw new Error("Chưa có không gian KhaiDocs. Hãy mở KhaiDocs để khởi tạo không gian trước.");
      setSpace(activeSpace);
      const archive = await ensureChatNotesFolder(activeSpace.id);
      await organizeIndexedChatNotes(activeSpace.id, archive.id);
      const index = readIndex(threadId);
      const ids = Object.keys(index.pages);
      const loaded = await Promise.all(ids.map(async (id) => {
        try { return await api<Page>("/pages/info", { pageId: id }); } catch { return null; }
      }));
      const owned = loaded.filter((page): page is Page => Boolean(page && page.spaceId === activeSpace.id));
      const nextIndex = { version: 1 as const, pages: Object.fromEntries(owned.map((page) => [page.id, index.pages[page.id] ?? ""])) };
      if (Object.keys(nextIndex.pages).length !== ids.length) writeIndex(threadId, nextIndex);
      setPages(owned.sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể tải ghi chú KhaiDocs.");
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const targetSpace = space ?? (await api<{ items: Space[] }>("/spaces", { limit: 100 })).items?.[0];
      if (!targetSpace) throw new Error("Chưa có không gian KhaiDocs. Hãy mở KhaiDocs để khởi tạo không gian trước.");
      const archive = await ensureChatNotesFolder(targetSpace.id);
      const title = `Ghi chú · ${threadTitle?.trim() || "Cuộc trò chuyện"}`.slice(0, 120);
      const page = await api<Page>("/pages/create", { spaceId: targetSpace.id, parentPageId: archive.id, title });
      const current = readIndex(threadId);
      writeIndex(threadId, { version: 1, pages: { ...current.pages, [page.id]: targetSpace.slug } });
      setEditing({ path: pagePath(targetSpace.slug, page), title: page.title || title });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể tạo trang KhaiDocs.");
    } finally {
      setCreating(false);
    }
  };

  const open = async (page: Page) => {
    try {
      const slug = readIndex(threadId).pages[page.id] || space?.slug;
      if (!slug) throw new Error("Không tìm thấy không gian của trang này.");
      setEditing({ path: pagePath(slug, page), title: page.title || "Trang KhaiDocs" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể mở trang.");
    }
  };

  if (editing) return <section className={`${styles.notes} ${styles.noteEditorView}`} aria-label="Trình soạn thảo ghi chú KhaiDocs">
    <div className={styles.noteEditorHeader}>
      <button type="button" className={styles.noteBack} onClick={() => { setEditing(null); void refresh(); }} aria-label="Quay lại danh sách ghi chú"><ChevronLeft size={15} /><span>Ghi chú</span></button>
      <span title={editing.title}>{editing.title}</span>
    </div>
    <div className={styles.embeddedKhaiDocs}>
      <Suspense fallback={<div className={styles.docsNoteState}><LoaderCircle size={17} className={styles.spin} /> Đang mở editor KhaiDocs…</div>}>
        <KhaiDocsApp view="page-panel" initialPath={editing.path} />
      </Suspense>
    </div>
  </section>;

  return <section className={styles.notes} aria-label="Ghi chú KhaiDocs của cuộc trò chuyện">
    <div className={styles.docsNoteBar}>
      <span>{loading ? "Ghi chú" : pages.length ? `${pages.length} ghi chú` : "Ghi chú"}<small> · lưu trong KhaiDocs</small></span>
      <button type="button" className={styles.docsNoteCreate} onClick={() => void create()} disabled={creating || loading}>
        {creating ? <LoaderCircle size={14} className={styles.spin} /> : <Plus size={14} />}
        Mới
      </button>
    </div>
    {error ? <p className={styles.docsNoteError} role="alert">{error}</p> : null}
    {loading ? <div className={styles.docsNoteState}><LoaderCircle size={17} className={styles.spin} /> Đang tải ghi chú…</div> : pages.length ? <div className={styles.docsNoteList}>
      {pages.map((page) => <button type="button" key={page.id} className={styles.docsNoteRow} onClick={() => void open(page)}>
        <span className={styles.docsNoteIcon}><FileText size={16} /></span>
        <span className={styles.docsNoteMeta}>
          <strong>{page.title?.trim() || "Trang chưa có tiêu đề"}</strong>
          <small>{readableDate(page.updatedAt) || "Đã lưu trong KhaiDocs"}</small>
        </span>
        <ChevronRight size={15} className={styles.docsNoteEdit} />
      </button>)}
    </div> : <div className={styles.noteEmpty}>
      <span className={styles.noteEmptyIcon}><NotebookPen size={20} /></span>
      <strong>Chưa có ghi chú</strong>
      <p>Ghi lại ý chính, việc cần làm hay kết luận của cuộc trò chuyện này. Ghi chú được lưu trong KhaiDocs.</p>
      <button type="button" onClick={() => void create()} disabled={creating}>
        {creating ? <LoaderCircle size={14} className={styles.spin} /> : <Plus size={14} />} Tạo ghi chú
      </button>
    </div>}
  </section>;
}
