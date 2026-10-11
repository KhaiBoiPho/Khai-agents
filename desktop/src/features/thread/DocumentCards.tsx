import {
  ChevronDown,
  Download,
  ExternalLink,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { DesktopInspectorTab } from "../../app/useDesktopUi";
import { requestFilePreview } from "../inspector/filePreviewRequests";
import {
  documentTypeLabel,
  formatFileSize,
  useDocumentDownload,
  type DocumentFileView,
} from "./documentFiles";
import styles from "./DocumentCards.module.css";

const ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  docx: { icon: FileText, tone: "word" },
  pdf: { icon: FileText, tone: "pdf" },
  pptx: { icon: Presentation, tone: "slides" },
  xlsx: { icon: FileSpreadsheet, tone: "sheet" },
  xlsm: { icon: FileSpreadsheet, tone: "sheet" },
  csv: { icon: FileSpreadsheet, tone: "sheet" },
  tsv: { icon: FileSpreadsheet, tone: "sheet" },
  html: { icon: FileCode2, tone: "web" },
  htm: { icon: FileCode2, tone: "web" },
};

function iconFor(extension: string) {
  return ICONS[extension.toLowerCase()] ?? { icon: FileText, tone: "plain" };
}

/** Download this file, or pick one of its formats when it has several. */
function DownloadMenu({
  document,
  download,
}: {
  document: DocumentFileView;
  download(path: string): void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const formats = [document, ...document.alternates];

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (formats.length === 1) {
    return (
      <button
        type="button"
        className={styles.download}
        onClick={() => download(document.path)}
        aria-label={`Download ${document.name}`}
        title="Download"
      >
        <Download size={14} aria-hidden="true" />
      </button>
    );
  }
  return (
    <div className={styles.downloadMenu} ref={rootRef}>
      <button
        type="button"
        className={styles.download}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Download ${document.name} as…`}
        title="Download as…"
        onClick={() => setOpen((value) => !value)}
      >
        <Download size={14} aria-hidden="true" />
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open ? (
        <ul className={styles.menu} role="menu" aria-label="Download as">
          {formats.map((format) => {
            const { icon: Icon, tone } = iconFor(format.extension);
            const size = formatFileSize(format.sizeBytes);
            return (
              <li key={format.path} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    download(format.path);
                  }}
                >
                  <span className={styles.menuIcon} data-tone={tone} aria-hidden="true">
                    <Icon size={14} strokeWidth={1.8} />
                  </span>
                  <span className={styles.menuLabel}>{documentTypeLabel(format.extension)}</span>
                  {size ? <small>{size}</small> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** Files a turn produced, as cards that open in the review panel's Files tab. */
export function DocumentCards({
  documents,
  onOpenInspector,
}: {
  documents: readonly DocumentFileView[];
  onOpenInspector(tab?: DesktopInspectorTab): void;
}) {
  const download = useDocumentDownload();
  if (!documents.length) return null;
  return (
    <ul className={styles.cards} aria-label="Documents from this turn">
      {documents.map((document) => {
        const { icon: Icon, tone } = iconFor(document.extension);
        const size = formatFileSize(document.sizeBytes);
        const others = document.alternates.map((alt) => alt.extension.toUpperCase()).join(", ");
        const open = () => {
          requestFilePreview(document.path);
          onOpenInspector("files");
        };
        return (
          <li key={document.path} className={styles.item}>
            <button
              type="button"
              className={styles.card}
              onClick={open}
              title={`Open ${document.path}`}
            >
              <span className={styles.icon} data-tone={tone} aria-hidden="true">
                <Icon size={18} strokeWidth={1.7} />
              </span>
              <span className={styles.copy}>
                <strong className={styles.name}>{document.name}</strong>
                <small className={styles.meta}>
                  {[documentTypeLabel(document.extension), size, others && `also ${others}`]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
              <span className={styles.open}>
                Open
                <ExternalLink size={12} aria-hidden="true" />
              </span>
            </button>
            {download ? <DownloadMenu document={document} download={download} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
