/**
 * The one rule for what a checklist line is, and how to flip exactly one of
 * them without touching the rest of the note.
 *
 * Ported from Yuvomi's utils/markdown-checklist.js (MIT, © 2026 ulsklyc). The
 * renderer and the writer share this file so a line can never be drawn as a
 * box that the toggle then refuses to write (or the reverse).
 */

/**
 * Indent, a list marker, the box, then the text. Yuvomi allows only bullet
 * markers with up to three spaces; this also accepts nested and numbered
 * items, because GFM draws boxes for those too and a box that does nothing
 * when tapped reads as broken.
 */
const CHECKLIST_RE = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\]\s+.*)$/;

export interface ChecklistLine {
  checked: boolean;
  prefix: string;
  suffix: string;
  text: string;
}

export function matchChecklistLine(
  line: string | null | undefined,
): ChecklistLine | null {
  const match = String(line ?? "").match(CHECKLIST_RE);
  if (!match) return null;
  return {
    checked: match[2]!.toLowerCase() === "x",
    prefix: match[1]!,
    suffix: match[3]!,
    text: match[3]!.replace(/^\]\s+/, ""),
  };
}

/**
 * Lines AND their separators, alternating. `join("")` gives back the exact
 * input, so a toggle never rewrites the line endings of untouched lines.
 * Line i sits at `parts[i * 2]`.
 */
export function splitKeepingLineEndings(
  content: string | null | undefined,
): string[] {
  return String(content ?? "").split(/(\r\n|\n|\r)/);
}

/** The raw text of zero-based line `index`, or undefined past the end. */
export function lineAt(content: string, index: number): string | undefined {
  return splitKeepingLineEndings(content)[index * 2];
}

export type ToggleResult =
  | { ok: true; content: string; changed: boolean }
  | { ok: false; reason: "out_of_range" | "not_a_checklist_line" | "stale" };

/**
 * Set the box on one line.
 *
 * Written by index rather than by searching the text: two "Milk" items are
 * otherwise indistinguishable. `expect` is the line the user saw; if the note
 * changed underneath, the index may now point elsewhere, and a conflict is
 * better than ticking the wrong line.
 */
export function toggleChecklistLine(
  content: string,
  line: number,
  checked: boolean,
  expect?: string | null,
): ToggleResult {
  if (!Number.isInteger(line) || line < 0)
    return { ok: false, reason: "out_of_range" };

  const parts = splitKeepingLineEndings(content);
  const at = line * 2;
  if (at >= parts.length) return { ok: false, reason: "out_of_range" };

  const current = parts[at]!;
  if (expect !== undefined && expect !== null && current !== expect) {
    return { ok: false, reason: "stale" };
  }

  const item = matchChecklistLine(current);
  if (!item) return { ok: false, reason: "not_a_checklist_line" };

  // Already in the target state: no write, and no error either.
  if (item.checked === checked)
    return { ok: true, content: String(content ?? ""), changed: false };

  parts[at] = `${item.prefix}${checked ? "x" : " "}${item.suffix}`;
  return { ok: true, content: parts.join(""), changed: true };
}
