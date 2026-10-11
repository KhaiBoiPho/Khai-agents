import { createContext, useContext } from "react";

import type { LineRange } from "../inspector/filePreviewRequests";

/**
 * Source citations in assistant replies, e.g. 【README.md:196-L201】, turned
 * into links that open the file at those lines.
 *
 * Only conversations provide a handler; other Markdown (notes, skills,
 * file previews) leaves the text as written.
 */
export const CitationContext = createContext<
  ((path: string, lines?: LineRange) => void) | null
>(null);

export function useCitationHandler() {
  return useContext(CitationContext);
}

const HREF_PREFIX = "#khai-cite:";

// 【path:12】, 【path:12-30】, 【path:12-L30】, 【path:L12-L30】
const CITATION = /【([^【】\n:]+?):L?(\d+)(?:\s*[-–]\s*L?(\d+))?】/g;

/** Rewrite citations as Markdown links the renderer turns into buttons. */
export function linkCitations(markdown: string): string {
  return markdown.replace(CITATION, (match, rawPath: string, first: string, last?: string) => {
    const path = rawPath.trim().replace(/^\.\//, "");
    const start = Number(first);
    const end = last ? Number(last) : start;
    if (!path || start < 1 || end < start) return match;
    const label = `${path}:${start}${end !== start ? `-${end}` : ""}`.replace(/[[\]]/g, "\\$&");
    return `[${label}](${HREF_PREFIX}${encodeURIComponent(path)}:${start}:${end})`;
  });
}

// A scheme ("https:", "mailto:"), a protocol-relative or rooted URL, or an
// in-page anchor: anything else in a reply's link is a workspace file.
const NOT_A_FILE = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i;

/**
 * A workspace file an ordinary Markdown link points at — the agent writes
 * `[PDF](reports/x.pdf)` — or null. `#L12` / `#L12-L30` pick lines.
 */
export function parseFileHref(
  href: string | undefined,
): { path: string; lines?: LineRange } | null {
  if (!href || NOT_A_FILE.test(href.trim())) return null;
  const [rawPath, hash = ""] = href.trim().split("#", 2);
  let path: string;
  try {
    path = decodeURIComponent(rawPath.split("?", 1)[0]);
  } catch {
    return null;
  }
  path = path.replace(/^(?:\.\/)+/, "");
  if (!path || path.startsWith("../")) return null;
  const range = /^L(\d+)(?:-L?(\d+))?$/.exec(hash);
  if (!range) return { path };
  const start = Number(range[1]);
  const end = range[2] ? Number(range[2]) : start;
  return start >= 1 && end >= start ? { path, lines: { start, end } } : { path };
}

/** The citation a link points at, or null for an ordinary link. */
export function parseCitationHref(
  href: string | undefined,
): { path: string; lines: LineRange } | null {
  if (!href?.startsWith(HREF_PREFIX)) return null;
  const match = /^(.*):(\d+):(\d+)$/.exec(href.slice(HREF_PREFIX.length));
  if (!match) return null;
  try {
    return {
      path: decodeURIComponent(match[1]),
      lines: { start: Number(match[2]), end: Number(match[3]) },
    };
  } catch {
    return null;
  }
}
