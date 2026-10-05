/**
 * Documents — where documents created by the agent will collect.
 *
 * TODO(backend): the list is preview data; document generation and storage
 * do not exist yet.
 */

import {
  FileSpreadsheet,
  FileText,
  FileType2,
  Plus,
  Presentation,
  Search,
} from "lucide-react";
import { useState } from "react";

import styles from "./Pages.module.css";

const DOCS = [
  { id: "1", title: "Project overview", kind: "Document", icon: FileText, source: "Created by agent", edited: "Today" },
  { id: "2", title: "Shell architecture notes", kind: "Document", icon: FileText, source: "Created by agent", edited: "Yesterday" },
  { id: "3", title: "API reference draft", kind: "Markdown", icon: FileType2, source: "Created by agent", edited: "Oct 3" },
  { id: "4", title: "Sprint plan", kind: "Spreadsheet", icon: FileSpreadsheet, source: "Uploaded", edited: "Oct 2" },
  { id: "5", title: "Demo day deck", kind: "Slides", icon: Presentation, source: "Created by agent", edited: "Sep 28" },
  { id: "6", title: "Meeting notes 09/25", kind: "Document", icon: FileText, source: "Uploaded", edited: "Sep 25" },
];

const TABS = ["All", "Created by agent", "Uploaded"] as const;

export function DocumentsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  const [query, setQuery] = useState("");
  const docs = DOCS.filter(
    (doc) =>
      (tab === "All" || doc.source === tab) &&
      doc.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Documents</h1>
        <div className={styles.tabs} role="tablist">
          {TABS.map((name) => (
            <button
              type="button"
              role="tab"
              key={name}
              aria-selected={name === tab}
              onClick={() => setTab(name)}
            >
              {name}
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
          <button type="button" className={styles.primary} title="Coming soon">
            <Plus size={15} /> New document
          </button>
        </div>
      </header>

      <div className={styles.banner}>
        <strong>Documents the agent writes land here</strong>
        <p>
          Ask for a report, a spec or a slide deck in any chat and it will be
          saved as a document you can open, edit and export. Preview — coming soon.
        </p>
      </div>

      <div className={styles.docGrid}>
        {docs.map((doc) => {
          const Icon = doc.icon;
          return (
            <article className={styles.docCard} key={doc.id}>
              <div className={styles.docThumb}>
                <Icon size={30} strokeWidth={1.3} />
              </div>
              <strong>{doc.title}</strong>
              <small>
                {doc.kind} · {doc.source} · {doc.edited}
              </small>
            </article>
          );
        })}
        {docs.length === 0 ? <p className={styles.empty}>No documents match.</p> : null}
      </div>
    </div>
  );
}
