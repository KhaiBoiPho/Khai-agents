/**
 * The insertion rules behind the Markdown toolbar, as a pure function over
 * (text, selection) so they can be tested without a textarea.
 *
 * Ported from Yuvomi's utils/markdown-toolbar.js (MIT, © 2026 ulsklyc).
 */

export type MarkdownFormat =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "heading"
  | "list"
  | "ordered-list"
  | "checklist"
  | "link"
  | "code"
  | "quote"
  | "divider";

export interface FormatResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const PLACEHOLDER = {
  text: "Text",
  code: "Code",
  linkText: "Link text",
  url: "url",
};

function replace(text: string, start: number, end: number, insert: string) {
  return text.slice(0, start) + insert + text.slice(end);
}

export function applyFormat(
  text: string,
  start: number,
  end: number,
  format: MarkdownFormat,
): FormatResult {
  const selection = text.slice(start, end);
  const lineHead = text.lastIndexOf("\n", start - 1) + 1;

  const collapsed = (value: string, cursor: number): FormatResult => ({
    value,
    selectionStart: cursor,
    selectionEnd: cursor,
  });

  // A line marker on a line that already has text starts a new line;
  // otherwise it would glue onto the words before it.
  const prefixLine = (marker: string) => {
    const onEmptyLine = text.slice(lineHead, start).trim() === "";
    const insert = onEmptyLine ? marker : `\n${marker}`;
    return collapsed(
      replace(text, start, start, insert),
      start + insert.length,
    );
  };

  // Prefix every selected line, without doubling a marker already there.
  const prefixSelection = (marker: string) => {
    const lines = selection
      .split("\n")
      .map((line) => (line.startsWith(marker) ? line : `${marker}${line}`))
      .join("\n");
    return collapsed(replace(text, start, end, lines), start + lines.length);
  };

  const wrap = (
    before: string,
    after: string,
    placeholder: string,
  ): FormatResult => {
    const inner = selection || placeholder;
    return {
      value: replace(text, start, end, `${before}${inner}${after}`),
      // Select the wrapped text, not the markers, so typing replaces it.
      selectionStart: start + before.length,
      selectionEnd: start + before.length + inner.length,
    };
  };

  switch (format) {
    case "bold":
      return wrap("**", "**", PLACEHOLDER.text);
    case "italic":
      return wrap("*", "*", PLACEHOLDER.text);
    case "underline":
      return wrap("<u>", "</u>", PLACEHOLDER.text);
    case "strikethrough":
      return wrap("~~", "~~", PLACEHOLDER.text);
    case "code":
      return wrap("`", "`", PLACEHOLDER.code);
    case "link": {
      const label = selection || PLACEHOLDER.linkText;
      const value = replace(text, start, end, `[${label}](${PLACEHOLDER.url})`);
      // With a selection the URL is what still needs filling; without one,
      // the label is.
      if (selection) {
        const urlStart = start + label.length + 3;
        return {
          value,
          selectionStart: urlStart,
          selectionEnd: urlStart + PLACEHOLDER.url.length,
        };
      }
      return {
        value,
        selectionStart: start + 1,
        selectionEnd: start + 1 + label.length,
      };
    }
    case "heading": {
      // One level deeper per click; after ### it cycles back to none.
      const lineEnd = text.indexOf("\n", start);
      const stop = lineEnd === -1 ? text.length : lineEnd;
      const line = text.slice(lineHead, stop);
      const match = line.match(/^(#{1,3})\s/);
      const next =
        match && match[1]!.length < 3
          ? `#${line}`
          : match
            ? line.replace(/^#{1,3}\s/, "")
            : `## ${line}`;
      return collapsed(
        replace(text, lineHead, stop, next),
        lineHead + next.length,
      );
    }
    case "list":
      return selection ? prefixSelection("- ") : prefixLine("- ");
    case "checklist":
      return selection ? prefixSelection("- [ ] ") : prefixLine("- [ ] ");
    case "quote":
      return selection ? prefixSelection("> ") : prefixLine("> ");
    case "ordered-list": {
      if (!selection) return prefixLine("1. ");
      // Renumber rather than prefix, or "3. Text" would become "1. 3. Text".
      const lines = selection
        .split("\n")
        .map((line, index) => `${index + 1}. ${line.replace(/^\d+\.\s/, "")}`)
        .join("\n");
      return collapsed(replace(text, start, end, lines), start + lines.length);
    }
    case "divider": {
      const insert = "\n\n---\n\n";
      return collapsed(
        replace(text, start, end, insert),
        start + insert.length,
      );
    }
  }
}
