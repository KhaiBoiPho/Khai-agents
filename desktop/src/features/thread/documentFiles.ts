import type { Item } from "../../generated/app-server";

/** A document a tool call wrote, as the backend projection reports it. */
export interface DocumentFileView {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number | null;
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

function itemDocuments(item: Item): DocumentFileView[] {
  if (item.status !== "completed") return [];
  const value = item.payload.documents;
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): DocumentFileView[] => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return [];
    }
    const { path, name, extension, sizeBytes } = candidate as Record<string, unknown>;
    if (typeof path !== "string" || !path) return [];
    return [
      {
        path,
        name: typeof name === "string" && name ? name : path.split("/").pop() ?? path,
        extension:
          typeof extension === "string" ? extension : path.split(".").pop() ?? "",
        sizeBytes: typeof sizeBytes === "number" ? sizeBytes : null,
      },
    ];
  });
}

/** Every document the turn's tool calls wrote, once per path (latest wins), in first-seen order. */
export function turnDocuments(items: readonly Item[]): DocumentFileView[] {
  const byPath = new Map<string, DocumentFileView>();
  for (const item of items) {
    for (const document of itemDocuments(item)) byPath.set(document.path, document);
  }
  return [...byPath.values()];
}
