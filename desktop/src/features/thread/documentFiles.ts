import { createContext, useContext } from "react";

import type { Item } from "../../generated/app-server";

/** Downloads a workspace file of the open thread; null where unsupported. */
export const DocumentDownloadContext = createContext<((path: string) => void) | null>(null);

export function useDocumentDownload() {
  return useContext(DocumentDownloadContext);
}

/** A document a tool call wrote, as the backend projection reports it. */
export interface DocumentFileView {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number | null;
  /** The same deliverable in other formats (a deck's PPTX and HTML source). */
  alternates: DocumentFileView[];
}

const TYPE_LABELS: Record<string, string> = {
  docx: "Word document",
  xlsx: "Excel workbook",
  xlsm: "Excel workbook",
  pptx: "PowerPoint deck",
  pdf: "PDF",
  md: "Markdown",
  markdown: "Markdown",
  html: "HTML page",
  htm: "HTML page",
  csv: "CSV table",
  tsv: "TSV table",
};

export function documentTypeLabel(extension: string): string {
  return TYPE_LABELS[extension.toLowerCase()] ?? extension.toUpperCase();
}

export function formatFileSize(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function parseDocuments(value: unknown, nested = false): DocumentFileView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): DocumentFileView[] => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return [];
    }
    const { path, name, extension, sizeBytes, alternates } = candidate as Record<string, unknown>;
    if (typeof path !== "string" || !path) return [];
    return [
      {
        path,
        name: typeof name === "string" && name ? name : path.split("/").pop() ?? path,
        extension:
          typeof extension === "string" ? extension : path.split(".").pop() ?? "",
        sizeBytes: typeof sizeBytes === "number" ? sizeBytes : null,
        alternates: nested ? [] : parseDocuments(alternates, true),
      },
    ];
  });
}

function itemDocuments(item: Item): DocumentFileView[] {
  if (item.status !== "completed") return [];
  return parseDocuments(item.payload.documents);
}

/**
 * Every document the turn's tool calls wrote, once per path (latest wins), in
 * first-seen order. A file that is another card's alternate format (a deck's
 * HTML source, written before the build) folds into that card.
 */
export function turnDocuments(items: readonly Item[]): DocumentFileView[] {
  const byPath = new Map<string, DocumentFileView>();
  for (const item of items) {
    for (const document of itemDocuments(item)) byPath.set(document.path, document);
  }
  const folded = new Set(
    [...byPath.values()].flatMap((document) => document.alternates.map((alt) => alt.path)),
  );
  return [...byPath.values()].filter((document) => !folded.has(document.path));
}
