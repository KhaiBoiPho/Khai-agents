/**
 * How file names read in the interface. Uploads are stored as
 * `deepcode-upload-<random>-<name>` so they never collide; people should
 * only ever see `<name>`.
 */

const UPLOAD_PREFIX = /^deepcode-upload-[0-9a-f]{24}-/;

/** The last path segment, with the upload prefix removed. */
export function displayFileName(path: string): string {
  const base = path.replace(/\\/g, "/").split("/").at(-1) || path;
  return base.replace(UPLOAD_PREFIX, "") || base;
}

export function fileExtension(path: string): string {
  const name = displayFileName(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

export type FileFamily =
  | "pdf"
  | "word"
  | "sheet"
  | "slides"
  | "csv"
  | "image"
  | "audio"
  | "video"
  | "archive"
  | "markdown"
  | "text"
  | "code"
  | "data"
  | "file";

const FAMILIES: Record<string, FileFamily> = {
  pdf: "pdf",
  doc: "word",
  docx: "word",
  odt: "word",
  rtf: "word",
  pages: "word",
  xls: "sheet",
  xlsx: "sheet",
  xlsm: "sheet",
  ods: "sheet",
  numbers: "sheet",
  ppt: "slides",
  pptx: "slides",
  odp: "slides",
  key: "slides",
  csv: "csv",
  tsv: "csv",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  heic: "image",
  bmp: "image",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  ogg: "audio",
  flac: "audio",
  mp4: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  md: "markdown",
  mdx: "markdown",
  txt: "text",
  log: "text",
  json: "data",
  yaml: "data",
  yml: "data",
  xml: "data",
  toml: "data",
  sql: "data",
};

const CODE = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java", "kt",
  "rb", "php", "c", "h", "cpp", "hpp", "cs", "swift", "vue", "svelte", "html",
  "css", "scss", "sh", "bash", "zsh", "ps1", "lua", "dart", "r", "ipynb",
]);

export function fileFamily(path: string): FileFamily {
  const extension = fileExtension(path);
  if (FAMILIES[extension]) return FAMILIES[extension];
  if (CODE.has(extension)) return "code";
  return "file";
}

const FAMILY_LABELS: Record<FileFamily, string> = {
  pdf: "PDF document",
  word: "Word document",
  sheet: "Spreadsheet",
  slides: "Presentation",
  csv: "CSV table",
  image: "Image",
  audio: "Audio",
  video: "Video",
  archive: "Archive",
  markdown: "Markdown",
  text: "Text",
  code: "Code",
  data: "Data",
  file: "File",
};

/** "Spreadsheet · XLSX" — what the file is, for a caption under its name. */
export function fileTypeLabel(path: string): string {
  const extension = fileExtension(path);
  const label = FAMILY_LABELS[fileFamily(path)];
  return extension ? `${label} · ${extension.toUpperCase()}` : label;
}
