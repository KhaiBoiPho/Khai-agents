/**
 * Explorer icons: a glyph per file family and a colour per language, the way
 * VS Code's file icon themes tell files apart at a glance.
 */

import {
  Braces,
  File,
  FileCode2,
  FileCog,
  FileImage,
  FileLock2,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType2,
  Folder,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";

import styles from "./FileIcon.module.css";

interface Kind {
  icon: LucideIcon;
  /** Key into FileIcon.module.css's [data-tone] colours. */
  tone: string;
}

const CODE = (tone: string): Kind => ({ icon: FileCode2, tone });

const BY_EXTENSION: Record<string, Kind> = {
  ts: CODE("ts"),
  tsx: CODE("ts"),
  mts: CODE("ts"),
  cts: CODE("ts"),
  js: CODE("js"),
  jsx: CODE("js"),
  mjs: CODE("js"),
  cjs: CODE("js"),
  py: CODE("py"),
  pyi: CODE("py"),
  rs: CODE("rs"),
  go: CODE("go"),
  java: CODE("java"),
  kt: CODE("java"),
  rb: CODE("rb"),
  php: CODE("php"),
  c: CODE("c"),
  h: CODE("c"),
  cpp: CODE("c"),
  hpp: CODE("c"),
  cs: CODE("cs"),
  swift: CODE("rs"),
  vue: CODE("vue"),
  svelte: CODE("rs"),
  html: CODE("html"),
  css: CODE("css"),
  scss: CODE("css"),
  sass: CODE("css"),
  less: CODE("css"),
  sql: CODE("data"),
  json: { icon: Braces, tone: "json" },
  jsonc: { icon: Braces, tone: "json" },
  yaml: { icon: FileCog, tone: "config" },
  yml: { icon: FileCog, tone: "config" },
  toml: { icon: FileCog, tone: "config" },
  ini: { icon: FileCog, tone: "config" },
  cfg: { icon: FileCog, tone: "config" },
  xml: CODE("html"),
  md: { icon: FileText, tone: "md" },
  mdx: { icon: FileText, tone: "md" },
  txt: { icon: FileText, tone: "plain" },
  rst: { icon: FileText, tone: "md" },
  sh: { icon: FileTerminal, tone: "shell" },
  bash: { icon: FileTerminal, tone: "shell" },
  zsh: { icon: FileTerminal, tone: "shell" },
  ps1: { icon: FileTerminal, tone: "shell" },
  csv: { icon: FileSpreadsheet, tone: "data" },
  tsv: { icon: FileSpreadsheet, tone: "data" },
  xlsx: { icon: FileSpreadsheet, tone: "data" },
  png: { icon: FileImage, tone: "image" },
  jpg: { icon: FileImage, tone: "image" },
  jpeg: { icon: FileImage, tone: "image" },
  gif: { icon: FileImage, tone: "image" },
  webp: { icon: FileImage, tone: "image" },
  svg: { icon: FileImage, tone: "image" },
  ico: { icon: FileImage, tone: "image" },
  ttf: { icon: FileType2, tone: "plain" },
  woff: { icon: FileType2, tone: "plain" },
  woff2: { icon: FileType2, tone: "plain" },
  lock: { icon: FileLock2, tone: "plain" },
};

const BY_NAME: Record<string, Kind> = {
  dockerfile: { icon: FileCog, tone: "docker" },
  makefile: { icon: FileTerminal, tone: "shell" },
  ".gitignore": { icon: FileCog, tone: "git" },
  ".gitattributes": { icon: FileCog, tone: "git" },
  ".env": { icon: FileLock2, tone: "config" },
  "package.json": { icon: Braces, tone: "node" },
  "package-lock.json": { icon: FileLock2, tone: "node" },
  "license": { icon: FileText, tone: "md" },
};

function fileKind(name: string): Kind {
  const lower = name.toLowerCase();
  if (BY_NAME[lower]) return BY_NAME[lower];
  if (lower.startsWith(".env")) return BY_NAME[".env"];
  const dot = lower.lastIndexOf(".");
  return (dot > 0 && BY_EXTENSION[lower.slice(dot + 1)]) || { icon: File, tone: "plain" };
}

export function FileIcon({ name, size = 15 }: { name: string; size?: number }) {
  const { icon: Icon, tone } = fileKind(name);
  return <Icon size={size} strokeWidth={1.7} className={styles.icon} data-tone={tone} aria-hidden="true" />;
}

export function FolderIcon({ open, size = 15 }: { open: boolean; size?: number }) {
  const Icon = open ? FolderOpen : Folder;
  return <Icon size={size} strokeWidth={1.7} className={styles.icon} data-tone="folder" aria-hidden="true" />;
}
