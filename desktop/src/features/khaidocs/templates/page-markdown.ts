/*
 * Original KhaiDocs code, MIT.
 *
 * A page's Markdown for "Save as template": from the open editor when it is
 * live (the same conversion as "Copy as Markdown"), otherwise from Docmost's
 * core export (POST /api/pages/export, format "markdown"), which returns the
 * saved page as a single .md file with its title heading.
 */

import type { Editor } from "@tiptap/core";
import { htmlToMarkdown } from "@docmost/editor-ext";
import api from "@/lib/api-client.ts";
import { pageToTemplateMarkdown } from "./template-markdown";

export async function readPageMarkdown(opts: {
  pageId: string;
  title: string;
  editor?: Editor | null;
}): Promise<string> {
  const { editor } = opts;
  const editorPageId = (editor?.storage as { pageId?: string } | undefined)?.pageId;
  if (editor && !editor.isDestroyed && (!editorPageId || editorPageId === opts.pageId)) {
    try {
      return pageToTemplateMarkdown(opts.title, htmlToMarkdown(editor.getHTML()));
    } catch {
      // fall through to the server's export
    }
  }
  // The api client hands export responses back whole (for their headers).
  const response: { data: unknown } = await api.post(
    "/pages/export",
    { pageId: opts.pageId, format: "markdown" },
    { responseType: "text" },
  );
  if (typeof response?.data !== "string") {
    throw new Error("Unexpected export response");
  }
  return response.data.replace(/\r\n?/g, "\n").trim() + "\n";
}
