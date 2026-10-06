import {
  ExternalLink,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Presentation,
  type LucideIcon,
} from "lucide-react";

import type { DesktopInspectorTab } from "../../app/useDesktopUi";
import { requestFilePreview } from "../inspector/filePreviewRequests";
import {
  documentTypeLabel,
  formatFileSize,
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

/** Files a turn produced, as cards that open in the review panel's Files tab. */
export function DocumentCards({
  documents,
  onOpenInspector,
}: {
  documents: readonly DocumentFileView[];
  onOpenInspector(tab?: DesktopInspectorTab): void;
}) {
  if (!documents.length) return null;
  return (
    <ul className={styles.cards} aria-label="Documents from this turn">
      {documents.map((document) => {
        const { icon: Icon, tone } = ICONS[document.extension.toLowerCase()] ?? {
          icon: FileText,
          tone: "plain",
        };
        const size = formatFileSize(document.sizeBytes);
        const open = () => {
          requestFilePreview(document.path);
          onOpenInspector("files");
        };
        return (
          <li key={document.path}>
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
                  {[documentTypeLabel(document.extension), size].filter(Boolean).join(" · ")}
                </small>
              </span>
              <span className={styles.open}>
                Open
                <ExternalLink size={12} aria-hidden="true" />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
