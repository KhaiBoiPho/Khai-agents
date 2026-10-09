import { FileCode2 } from "lucide-react";
import type { ReactNode } from "react";

import type { LineRange } from "../inspector/filePreviewRequests";
import styles from "./MarkdownContent.module.css";

/** A citation in a reply: opens the cited file at those lines. */
export function CitationLink({
  path,
  lines,
  onOpen,
  children,
}: {
  path: string;
  lines: LineRange;
  onOpen(path: string, lines: LineRange): void;
  children: ReactNode;
}) {
  const where =
    lines.end !== lines.start ? `lines ${lines.start}–${lines.end}` : `line ${lines.start}`;
  return (
    <button
      type="button"
      className={styles.citation}
      onClick={() => onOpen(path, lines)}
      title={`Open ${path} at ${where}`}
    >
      <FileCode2 size={12} aria-hidden="true" />
      {children}
    </button>
  );
}
