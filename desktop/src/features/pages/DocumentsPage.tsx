/**
 * Documents — every file uploaded into a chat and every document the agent
 * wrote, across all chats and projects (``documents/list``). Selecting one
 * opens an in-place preview; its source chat is a separate action.
 */

import { ArrowUpRight, Download, MessageSquare, RefreshCw, Search, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import type { DocumentEntry } from "../../generated/app-server";
import type { ClientRuntime } from "../../rpc/contracts";
import { FileBadge } from "../../components/FileBadge";
import { LoadingDots } from "../../components/Motion";
import { MarkdownContent } from "../thread/MarkdownContent";
import { documentKind } from "../inspector/documentKinds";
import styles from "./Pages.module.css";

const DocumentViewer = lazy(() => import("../inspector/DocumentViewer"));

const TABS = [
  { id: "all", label: "All" },
  { id: "uploaded", label: "Uploaded" },
  { id: "agent", label: "Created by agent" },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface DocumentsPageProps {
  runtime: ClientRuntime;
  onOpen(document: DocumentEntry): void;
}

export function DocumentsPage({ runtime, onOpen }: DocumentsPageProps) {
  const [documents, setDocuments] = useState<DocumentEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshes, setRefreshes] = useState(0);
  const [loadedAt, setLoadedAt] = useState(-1);
  const loading = loadedAt !== refreshes;
  const [tab, setTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DocumentEntry | null>(null);
  const loadSelected = useCallback(() => {
    if (!selected || !runtime.readFileBytes) {
      return Promise.reject(new Error("Document preview is unavailable."));
    }
    return runtime.readFileBytes(selected.threadId, selected.path);
  }, [runtime, selected]);

  useEffect(() => {
    let cancelled = false;
    runtime
      .request("documents/list", {})
      .then((result) => {
        if (cancelled) return;
        setDocuments(result.documents);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoadedAt(refreshes);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, refreshes]);
  const load = () => setRefreshes((count) => count + 1);

  const counts = useMemo(() => {
    const all = documents ?? [];
    return {
      all: all.length,
      uploaded: all.filter((doc) => doc.source === "uploaded").length,
      agent: all.filter((doc) => doc.source === "agent").length,
    };
  }, [documents]);

  const visible = (documents ?? []).filter(
    (doc) =>
      (tab === "all" || doc.source === tab) &&
      `${doc.name} ${doc.threadTitle} ${doc.projectName}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );

  return (
    <div className={styles.page} data-preview={Boolean(selected) || undefined}>
      <header className={styles.header}>
        <h1>Documents</h1>
        <div className={styles.tabs} role="tablist">
          {TABS.map(({ id, label }) => (
            <button
              type="button"
              role="tab"
              key={id}
              aria-selected={id === tab}
              onClick={() => setTab(id)}
            >
              {label}
              {documents ? <span className={styles.tabCount}>{counts[id]}</span> : null}
            </button>
          ))}
        </div>
        <div className={styles.headerActions}>
          <label className={styles.search}>
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documents"
              aria-label="Search documents"
            />
          </label>
          <button
            type="button"
            className={styles.ghost}
            onClick={load}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw size={15} className={loading ? styles.spinning : undefined} />
          </button>
        </div>
      </header>

      {error ? <p className={styles.errorText}>{error}</p> : null}

      {documents && documents.length === 0 ? (
        <div className={styles.banner}>
          <strong>No documents yet</strong>
          <p>
            Files you attach in a chat (the + button) and documents the agent
            writes — reports, PDFs, spreadsheets, slides — show up here.
          </p>
        </div>
      ) : null}

      <div className={selected ? styles.documentsWithPreview : undefined}>
        <div className={styles.docGrid}>
          {visible.map((doc) => (
            <article className={styles.docCard} key={doc.id}>
              <button
                type="button"
                className={styles.docOpen}
                onClick={() => setSelected(doc)}
                aria-pressed={selected?.id === doc.id}
                title={`Preview ${doc.name}`}
              >
                <div className={styles.docThumb}>
                  <FileBadge path={doc.name} size={44} />
                  <span className={styles.docExt}>{doc.extension.toUpperCase()}</span>
                </div>
                <strong>{doc.name}</strong>
                <small>
                  {doc.source === "uploaded" ? "Uploaded" : "Created by agent"} ·{" "}
                  {formatSize(doc.size)} · {formatWhen(doc.modifiedAt)}
                </small>
                <small className={styles.docChat}>
                  <MessageSquare size={11} />
                  {doc.linked ? doc.threadTitle : "Chat deleted"}
                </small>
              </button>
              {runtime.downloadFile ? (
                <button
                  type="button"
                  className={styles.docDownload}
                  onClick={() => void runtime.downloadFile?.(doc.threadId, doc.path)}
                  title="Download"
                  aria-label={`Download ${doc.name}`}
                >
                  <Download size={14} />
                </button>
              ) : null}
            </article>
          ))}
          {documents && documents.length > 0 && visible.length === 0 ? (
            <p className={styles.empty}>No documents match.</p>
          ) : null}
        </div>
        {selected ? (
          <aside className={styles.documentPreview} aria-label={`Preview ${selected.name}`}>
            <header className={styles.previewHeader}>
              <div>
                <strong title={selected.name}>{selected.name}</strong>
                <small>{selected.threadTitle || "Document preview"}</small>
              </div>
              <button type="button" className={styles.ghost} onClick={() => setSelected(null)} aria-label="Close preview">
                <X size={16} />
              </button>
            </header>
            <div className={styles.previewBody}>
              {runtime.readFileBytes ? (
                <Suspense fallback={<div className={styles.previewLoading}><LoadingDots /> Opening document</div>}>
                  <DocumentPreview
                    document={selected}
                    load={loadSelected}
                  />
                </Suspense>
              ) : (
                <p className={styles.previewMessage}>Preview is unavailable in this runtime. Download the file to view it.</p>
              )}
            </div>
            <footer className={styles.previewFooter}>
              {runtime.downloadFile ? (
                <button type="button" className={styles.ghost} onClick={() => void runtime.downloadFile?.(selected.threadId, selected.path)}>
                  <Download size={14} /> Download
                </button>
              ) : null}
              <button
                type="button"
                className={styles.openChat}
                disabled={!selected.linked}
                onClick={() => onOpen(selected)}
                title={selected.linked ? "Open the chat that created this document" : "The source chat was deleted"}
              >
                <MessageSquare size={14} /> Open source chat <ArrowUpRight size={14} />
              </button>
            </footer>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function DocumentPreview({
  document,
  load,
}: {
  document: DocumentEntry;
  load(): Promise<ArrayBuffer>;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = documentKind(document.path);
  useEffect(() => {
    if (kind) return;
    let live = true;
    load()
      .then((bytes) => live && setText(new TextDecoder().decode(bytes)))
      .catch((cause: unknown) => live && setError(cause instanceof Error ? cause.message : String(cause)));
    return () => { live = false; };
  }, [document.id, kind, load]);

  if (kind) return <DocumentViewer key={document.id} path={document.path} load={load} />;
  if (error) return <p className={styles.previewMessage}>Could not load this file: {error}</p>;
  if (text === null) return <div className={styles.previewLoading}><LoadingDots /> Opening document</div>;
  if (/\.(md|mdx|markdown)$/i.test(document.path)) return <MarkdownContent>{text}</MarkdownContent>;
  return <pre className={styles.plainPreview}>{text}</pre>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
