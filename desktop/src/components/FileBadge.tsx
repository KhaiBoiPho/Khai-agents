/**
 * A small rounded tile whose colour and glyph say what kind of file it is:
 * red PDF, blue DOCX, green XLSX, orange PPTX and so on.
 */

import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  type LucideIcon,
} from "lucide-react";

import { fileFamily, type FileFamily } from "../app/fileNames";
import styles from "./FileBadge.module.css";

interface FileBadgeProps {
  path: string;
  /** Tile size in pixels. */
  size?: number;
}

const GLYPHS: Record<FileFamily, LucideIcon> = {
  pdf: FileText,
  word: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  csv: FileSpreadsheet,
  image: FileImage,
  audio: FileAudio,
  video: FileVideo,
  archive: FileArchive,
  markdown: FileText,
  text: FileText,
  code: FileCode,
  data: FileJson,
  file: File,
};

export function FileBadge({ path, size = 28 }: FileBadgeProps) {
  const family = fileFamily(path);
  const Glyph = GLYPHS[family];
  return (
    <span
      className={styles.badge}
      data-family={family}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Glyph size={Math.round(size * 0.55)} strokeWidth={2} />
    </span>
  );
}
