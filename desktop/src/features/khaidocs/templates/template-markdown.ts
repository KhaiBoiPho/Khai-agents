/*
 * Original KhaiDocs code, MIT.
 *
 * Pure helpers for page templates: placeholder filling, the title/body
 * split, the Markdown file sent to Docmost's import, and gallery filtering.
 */

import type { PageTemplate, TemplateCategory } from "./manifest";

/** YYYY-MM-DD in local time. */
export function formatLocalDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Replaces `{{date}}` with today's date. */
export function fillPlaceholders(markdown: string, now: Date = new Date()): string {
  return markdown.replace(/\{\{\s*date\s*\}\}/g, formatLocalDate(now));
}

/**
 * Splits a leading `# Title` line from the rest. Blank lines before the
 * heading are ignored; without one, the title is empty.
 */
export function splitTitle(markdown: string): { title: string; body: string } {
  const text = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const match = text.match(/^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\n|$)/);
  if (!match) return { title: "", body: text.trim() };
  return { title: match[1].trim(), body: text.slice(match[0].length).trim() };
}

/** A safe file name for the import; Docmost falls back to it as the title. */
export function templateFileName(title: string): string {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `${base || "Untitled"}.md`;
}

/**
 * The Markdown document a template becomes: placeholders filled, and a
 * leading `# heading` (the template's title when it has none) so the server
 * uses it as the page title.
 */
export function buildTemplateDocument(
  template: Pick<PageTemplate, "title" | "markdown">,
  now: Date = new Date(),
): { title: string; fileName: string; markdown: string } {
  const filled = fillPlaceholders(template.markdown, now);
  const split = splitTitle(filled);
  const title = split.title || template.title.trim() || "Untitled";
  const markdown = `# ${title}\n\n${split.body}\n`;
  return { title, fileName: templateFileName(title), markdown };
}

/** The Markdown stored for "Save as template": title heading plus body. */
export function pageToTemplateMarkdown(title: string, bodyMarkdown: string): string {
  const heading = title.trim() ? `# ${title.trim()}\n\n` : "";
  return `${heading}${bodyMarkdown.trim()}\n`;
}

export type CategoryFilter = TemplateCategory | "All";

/** Gallery search: category, then every query word in title/description/category. */
export function filterTemplates<T extends PageTemplate>(
  templates: readonly T[],
  query: string,
  category: CategoryFilter = "All",
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return templates.filter((template) => {
    if (category !== "All" && template.category !== category) return false;
    const haystack =
      `${template.title} ${template.description} ${template.category}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
