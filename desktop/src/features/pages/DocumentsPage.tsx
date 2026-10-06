/**
 * Documents — every file uploaded into a chat and every document the agent
 * wrote, across all chats and projects (``documents/list``). Opening one
 * jumps to its chat and shows the file in the Files viewer.
 */

import { Download, MessageSquare, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { DocumentEntry } from "../../generated/app-server";
import type { ClientRuntime } from "../../rpc/contracts";
import { FileBadge } from "../../components/FileBadge";
import styles from "./Pages.module.css";

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
    <div className={styles.page}>
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

      <div className={styles.docGrid}>
        {visible.map((doc) => (
          <article className={styles.docCard} key={doc.id}>
            <button
              type="button"
              className={styles.docOpen}
              onClick={() => onOpen(doc)}
              title={`Open ${doc.name}`}
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
    </div>
  );
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
