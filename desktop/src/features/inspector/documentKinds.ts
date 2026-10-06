/** Binary documents the Files panel previews instead of opening as text. */
export type DocumentKind =
  | "pdf"
  | "docx"
  | "xlsx"
  | "csv"
  | "pptx"
  | "image"
  | "video"
  | "audio";

const BY_EXTENSION: Record<string, DocumentKind> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  xlsm: "xlsx",
  csv: "csv",
  tsv: "csv",
  pptx: "pptx",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  ico: "image",
  bmp: "image",
  avif: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  m4a: "audio",
};

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
};

/** Media type for previewing a file through a blob URL. */
export function mediaType(path: string): string {
  const dot = path.lastIndexOf(".");
  return (dot < 0 ? undefined : MIME[path.slice(dot + 1).toLowerCase()]) ?? "application/octet-stream";
}

export function documentKind(path: string): DocumentKind | null {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? null : BY_EXTENSION[path.slice(dot + 1).toLowerCase()] ?? null;
}
