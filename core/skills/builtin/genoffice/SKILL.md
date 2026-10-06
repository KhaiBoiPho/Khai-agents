---
name: genoffice
description: Create, convert, read, edit and render real Office documents with the built-in GenOffice MCP tools (mcp__genoffice__*). Use whenever the user asks for a slide deck or presentation (pptx), a spreadsheet or workbook (xlsx), a report, memo, letter or Word document (docx), a PDF, a Markdown or HTML document built from a template, a format conversion between pdf, docx, xlsx, pptx, md, html and csv, filling {{placeholders}} in a template, or a change to an existing Office file. Plans the document, builds it with the genoffice tools inside the session workspace, renders and checks the pages, then presents the file.
license: Apache-2.0 (adapted from GenOffice skills/genoffice; see LICENSE.txt and NOTICE)
metadata:
  upstream: https://github.com/genspark-ai/genoffice/tree/db347087628281d49e53d009183d2fb506c3a444/skills/genoffice
  upstream-version: 2.67.1
---

# GenOffice documents in Khai

Khai runs GenOffice's document engine as the built-in MCP server `genoffice`.
Every GenOffice command is a tool named `mcp__genoffice__<tool>`; you never need
a shell or the GenOffice app window. If no `mcp__genoffice__*` tool is
available, tell the user the GenOffice engine is not installed (the operator
runs `scripts/setup-genoffice.sh`) instead of hand-writing Office XML.

## Ground rules

- **Write inside the session workspace.** The server runs with the workspace as
  its working directory and `GENOFFICE_ALLOWED_ROOTS` set to it: use paths
  relative to the workspace (e.g. `reports/q3-report.docx`, `decks/launch/`).
  An `outside_allowed_roots` error means the path left the workspace; pick a
  workspace path, never another location.
- Results are the `--json` envelope: `{status: ok|partial, summary,
  output_path, warnings, detail}` or `{status: error, error, message,
  suggestion, detail}`. Branch on `error`, follow `suggestion`, resend the
  whole batch (atomic `apply` wrote nothing). Never parse `message`.
- `create_*` and `convert` refuse to overwrite (`output_exists`): choose a new
  name, or `force: true` only when the user asked to replace the file.
- Look up op fields with `guide` (`guide {domain: "docs"|"sheets"|"slides",
  topic?}`) before writing ops; the schemas advertised for `ops`, `cells` and
  `data` are intentionally untyped to save context, the guide is the
  authoritative, validator-generated reference.
- Detailed engine behaviour, pitfalls and the full error table:
  `references/cli-reference.md` (CLI wording; each command is the tool of the
  same name).

## Tools

| Need | Tool |
| --- | --- |
| Structure summary of any file | `info` |
| Change format (pdf↔docx/pptx/xlsx, csv→xlsx, md→docx/html/pdf, docx→md/html/pdf, html→docx/pdf, xlsx→csv/pdf, pptx→pdf) | `convert` |
| New Word document from Markdown or restricted HTML | `create_docx` |
| New workbook from rows / `{sheets:[{name,rows}]}` / csv (`"=..."` = formula) | `create_xlsx` |
| New deck in one call from ops or a deck spec (≤ ~5 slides) | `create_pptx` (`render: true`, `audit: true`) |
| Longer or design-sensitive deck | `deck_start` → `deck_page` (one per page, in order) → `deck_build` → `deck_replace` to fix a page |
| PDF printed from md/html/docx/xlsx/pptx | `create_pdf` |
| Read / edit / check Word | `docs_read` / `docs_apply` / `docs_check` |
| Read / edit / check Excel | `sheet_read` / `sheet_apply` / `sheet_check` |
| Read / edit / audit / render PowerPoint | `slides_read` / `slides_apply` / `slides_audit` / `slides_render`, `slides_check`, `slides_replace` |
| Fill `{{key}}` placeholders in a docx/pptx/xlsx template | `merge` (`strict: true` to fail on leftovers) |
| Text layer of a PDF | `pdf_read` |
| PNG of each page to look at (docx, xlsx, pptx, pdf, md, html) | `render` (`grid: true` for a contact sheet) |
| Op reference | `guide` |

`render`, `slides_render`, `create_pdf` and conversions to PDF or HTML start a
hidden GenOffice renderer for a few seconds; they need the GenOffice app on
this machine. If they fail with `app_unavailable`, deliver the file anyway and
say the visual check was skipped.

## Workflow for "make me a report / deck / sheet"

1. **Plan** (briefly, in your reply or a todo list): audience, the sections /
   slides / sheets, the real figures and where they come from, the output
   path inside the workspace. Read the user's source files first (see below).
2. **Build** with the matching tool:
   - Report or memo → write Markdown (headings, tables, lists) and call
     `create_docx {markdown, out: "reports/<name>.docx"}`; later edits through
     `docs_read` → `docs_apply`.
   - Spreadsheet → `create_xlsx {data, header: true, out}` with formulas as
     `"=SUM(B2:B9)"`, then `sheet_apply` ops for number formats, column widths,
     charts (`guide sheets` lists them).
   - Short deck (≤ ~5 slides, concrete content) → `guide slides spec` once,
     then one `create_pptx {spec: {pages: [...]}, out, render: true, audit:
     true}` on the 1280×720 px canvas. Longer or presented decks → the staged
     flow: `deck_start {dir, style, outline}` (fix every outline error), one
     `deck_page` per page until its audit, outline and off-palette findings
     are empty, then `deck_build`.
   - PDF → build the docx/pptx/md first, then `create_pdf` or `convert`.
3. **Check, then look** — before saying "done", for every file:

   | Artifact | Check | Look |
   | --- | --- | --- |
   | Deck | `slides_audit` → `detail.issues` empty (apply its `suggest` ops via `slides_apply`) | `slides_render` or `render {grid: true}` |
   | Workbook | `sheet_check` → no `formula_error`, `missing_sheet_ref`, `number_overflow` | `render` the sheet |
   | Document | `docs_check` → no `broken_ref`, `placeholder_left` you can fix | `render` page 1 and the last page |

   `check`/`audit` succeed whether or not they found problems: read
   `detail.issues`. At most two fix rounds.
4. **Present**: name each file by its workspace-relative path with a one-line
   summary (pages/slides/sheets) and anything left as is (illustrative numbers,
   uncached formulas, skipped render). Khai shows created files as cards the
   user can open in the review panel, so do not paste the document text back.

## Reading the user's files

Source material in md, txt, csv or images you read directly. Office files go
through the tools, never `unzip`/`cat`:

- docx: `convert {file, to: "md"}` for the whole text, or `docs_read {file, full: true}` for blocks with indexes.
- xlsx: `sheet_read {file, range: "A1:H200"}` (`stats: true` first to size a big workbook) or `convert {to: "csv", sheet}`.
- pptx: `slides_read {file, full: true}` for every slide's text, tables and notes.
- pdf: `pdf_read {file, range: "1-20"}`.

Take figures and wording from that material; say so when a number is
illustrative.

## Editing an existing file

- Word: `docs_read` → `guide docs <op>` → `docs_apply {file, ops}` → `docs_check`. Block indexes are 0-based and live inside one batch; `findReplace` does not reach table cells.
- Excel: `sheet_read` → `sheet_apply {file, ops}` (or `cells` for plain cell writes) → `sheet_check`. Sheets are addressed by their current tab name; row/column inserts shift later ops in the same batch.
- PowerPoint: `slides_read {slide: n, full: true}` → `slides_apply` (`setText` keeps the element's style) → `slides_audit` → `slides_render {slide: n}`. Slides are 0-based in ops, `render.page` is 1-based; element ids change after structural edits, so read again before a second batch.
- Write to a new `out` path when the user wants the original kept.

## Examples

Workbook with a total row and a bold header:

```json
{"tool": "create_xlsx", "arguments": {"out": "data/sales.xlsx", "header": true,
  "data": [["Item", "Qty", "Price"], ["Apple", 2, 1.5], ["Total", "=SUM(B2:B2)", ""]]}}
{"tool": "sheet_apply", "arguments": {"file": "data/sales.xlsx",
  "ops": [{"op": "format_range", "range": "A1:C1", "format": {"bold": true, "fillColor": "#FFF2CC"}}]}}
```

Word report, then one paragraph inserted after block 0:

```json
{"tool": "create_docx", "arguments": {"out": "reports/q3.docx",
  "markdown": "# Q3 Review\n\n## Highlights\n\n- Revenue up 12%\n\n| Region | Revenue |\n| --- | --- |\n| EMEA | 4.2M |"}}
{"tool": "docs_apply", "arguments": {"file": "reports/q3.docx",
  "ops": [{"op": "insert_content", "afterBlockIndex": 0, "html": "<p>Executive summary.</p>"}]}}
```
