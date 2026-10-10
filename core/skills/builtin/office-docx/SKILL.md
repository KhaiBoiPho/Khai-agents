---
name: office-docx
description: Task workflow for Word documents (.docx) — create reports, memos, letters, proposals and forms; read or extract text and tables; edit an existing file directly (rewrite text, insert sections, tables, images, headers/footers, page setup) without tracked changes; fill {{placeholder}} templates; convert to or from md, html and pdf. Use whenever the user wants a Word/.docx file made, read or changed. Builds with GenOffice tools when present, Python otherwise; looks via document-design.
license: Original Khai-Agents content (see repository license)
---

# Word documents (.docx)

## 0. Choose the engine and the look

- `mcp__genoffice__*` tools listed → **GenOffice path** (load the `genoffice`
  skill for tool arguments, errors and `guide docs` op lookup).
- No GenOffice tools → **Python path**: `references/python-fallback.md`.
  Probe once: `python -c "import docx"`. If python-docx is missing, read with
  the stdlib extractor there; for creation tell the user and offer Markdown
  or a PDF built with reportlab (see `office-pdf`). Install packages only when
  the user agrees and the network allows it.
- Pick a `document-design` style before writing; apply it everywhere.
- Paths: workspace-relative (`reports/q3-review.docx`). Never overwrite the
  user's original unless asked — write `<name>-edited.docx`.

## 1. Create

1. Plan: audience, purpose, section list, real sources for every figure.
2. Write the body as Markdown: one `#` title, `##` sections, `###` at most,
   GFM tables, lists, short paragraphs.
3. GenOffice: `create_docx {markdown, out}`. Then one `docs_apply` batch for
   styling (`define_style` Heading 1–3 + Normal, `set_page_setup`,
   `set_header_footer`) using document-design values.
   Python: build with python-docx per the fallback reference.
4. Long reports: executive summary first; a table of contents when there are
   more than ~6 sections (use a TOC op if `guide docs` lists one; otherwise a
   manual contents list).

## 2. Read / extract

- Whole text: `convert {file, to: "md"}` (drops images, `detail.skipped`).
- Every block with its index, incl. tables: `docs_read {file, full: true}`.
- Python: paragraphs + tables in body order (fallback reference §Read).
- Quote figures exactly; say which section they came from.

## 3. Edit an existing document

1. `docs_read` the target region; note 0-based block indexes.
2. Look up each op with `guide docs <op>` (never guess field names).
3. One `docs_apply {file, ops, out?}` batch. Indexes are live inside the
   batch: after inserting two blocks, later indexes shift by two.
4. `docs_check`, then re-read the changed region to confirm.

Rules:
- Edits are written directly (no revision marks). If the user wants visible
  tracked changes or a redline and `guide docs` offers no revision op, deliver
  the clean edited copy plus a short change list, and say so.
- `findReplace` does not reach table cells — rewrite the table block.
- Keep the document's existing styles; change formatting only where asked.
- Python path: edit run text in place so formatting survives (fallback
  reference §Edit); never rebuild the file from extracted text.

## 4. Common elements

| Element | GenOffice (check `guide docs`) | Python |
| --- | --- | --- |
| Table | GFM table in Markdown, then `setTableStyle` / `setTableCellFormat` | `add_table` + header shading |
| Image | image op from `guide docs` with a workspace path | `add_picture(path, width=Cm(15))` |
| Header / footer, page numbers | `set_header_footer` with `Page {PAGE} of {NUMPAGES}` | section header/footer + PAGE field |
| Page size, margins, orientation | `set_page_setup` | `section.page_width`, margins, `orientation` |
| Page break | page-break op / `<p>` per guide | `add_page_break()` |
| Template fill | `merge {file, data, out, strict: true}` | replace `{{key}}` in runs |

Table rules (document-design): header row in primary fill with white bold
text, numbers right-aligned, units in the header, source line under the table.

## 5. Convert

- md/html → docx: `create_docx` (Markdown preferred) or `convert`.
- docx → md/html: `convert`.
- docx → pdf: use the internal converter when available (`create_pdf` /
  `convert` to pdf); if it is missing or returns `app_unavailable`, skip the
  PDF and tell the user the docx is ready but the PDF could not be made here.

## 6. Final check

- `docs_check` → fix `broken_ref`, `placeholder_left` (two rounds max).
- If render is available, `render` page 1 and the last page and look; on
  `app_unavailable` skip and say the visual check was skipped.
- Python path: re-open the saved file and extract text to confirm it parses
  and contains every section.
- Present the workspace path with a one-line summary (pages/sections, what is
  illustrative). Do not paste the document back.
