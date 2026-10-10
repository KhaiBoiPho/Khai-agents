---
name: office-pptx
description: Task workflow for PowerPoint decks (.pptx) — plan and build presentations, pitch decks and slide reports; read or extract slide text, tables and speaker notes; edit existing decks (text, images, charts, tables, layout fixes, add/remove/reorder slides); fill templates; export to PDF. Use whenever the user wants slides, a deck or a .pptx made, read or changed. Builds with GenOffice tools when present, Python otherwise; looks via document-design.
license: Original Khai-Agents content (see repository license)
---

# PowerPoint decks (.pptx)

## 0. Choose the engine and the look

- `mcp__genoffice__*` tools listed → **GenOffice path** (load `genoffice` for
  arguments and errors; `guide slides` / `guide slides spec` for op and spec
  fields — never invent `layout` or page `type` names).
- No GenOffice tools → **Python path**: `references/python-fallback.md`.
  Probe `python -c "import pptx"`. If python-pptx is missing, read with the
  stdlib extractor there; for creation tell the user and offer a PDF slide
  deck drawn with reportlab (landscape pages, see `office-pdf`). Install
  packages only when the user agrees and the network allows it.
- Pick a `document-design` style first; its slide rules (one idea per slide,
  takeaway headlines, ≤ 5 bullets, varied layouts) apply to both paths.
- Paths: workspace-relative (`decks/launch.pptx`); keep originals intact.

## 1. Plan the deck (before any tool call)

Write a numbered outline: for each slide the layout pattern from
document-design (cover, section, big number, compare, 3 cards, timeline,
chart + insight, quote, closing), the headline sentence, and the content or
data with its source. Ask for approval only when the user wanted to review
the outline or the brief is ambiguous.

## 2. Create

GenOffice:
- ≤ ~5 slides with concrete content → read `guide slides spec` once, then one
  `create_pptx {spec: {pages: [...]}, out, render: true, audit: true}`
  (1280×720 px canvas).
- Longer or presented decks → staged flow: `deck_start {dir, style, outline}`
  with the document-design style as `style.md`; fix every outline error; one
  `deck_page` per page in order until its audit, outline and off-palette
  findings are empty; `deck_build`; `deck_replace` to redo one page.
- Do not repeat a layout on consecutive content slides; use at least three
  variants in a long deck. Image layouts need a real workspace image.

Python: one blank-layout slide per outline item, shapes placed on a grid
from the style (fallback reference §Create).

## 3. Read / extract

- `slides_read {file, full: true}` → every slide's text, tables, notes and
  element ids. `slides_read {file, slide: n, full: true}` for one slide.
- Python: text frames, tables and notes per slide (fallback §Read).
- For "summarise this deck", read everything first; cite slide numbers.

## 4. Edit an existing deck

1. `slides_read {slide: n, full: true}` for each slide you touch.
2. `guide slides <op>` for each op; `slides_apply {file, ops, out?}`.
   `setText` keeps the element's style. Ops in one batch run in order.
3. Slides are 0-based in ops, `render.page` is 1-based. Element ids change
   after structural edits — read again before a second batch.
4. `slides_audit` → apply its `suggest` ops; re-audit.

Common edits: replace text, swap a picture (`replacePicture`), add a slide
(then fill it), delete or reorder slides, add speaker notes, fix overflow by
splitting a slide rather than shrinking text below 12 px.

## 5. Charts, tables, images

- Charts: one per slide; highlight the series that matters in the accent
  colour, grey the rest, label directly when ≤ 4 series. GenOffice: use the
  chart page type / op listed in the guide. Python: native charts via
  `add_chart` (fallback §Charts).
- Tables: ≤ 6 rows × 5 columns on a slide; otherwise chart it or move detail
  to an appendix slide.
- Images: workspace files only (or GenOffice image search when the guide
  offers it); keep aspect ratio; never stretch.

## 6. Templates and conversion

- `{{key}}` template: `merge {file, data, out, strict: true}`.
- Brand template deck: copy it to the output path, then edit with
  `slides_apply` (GenOffice) or open it with python-pptx and reuse its layouts.
- pptx → pdf: use the internal converter when available (`create_pdf` /
  `convert` to pdf); otherwise skip and tell the user. The PDF has no text
  layer.

## 7. Final check

- `slides_audit` → `detail.issues` empty (two fix rounds max).
- If render is available, `slides_render` (or `render {grid: true}`) and look
  for overflow, overlap, low contrast, empty placeholders; on
  `app_unavailable` skip and say the visual check was skipped.
- Python path: re-open the file, list slide titles and shape counts, check no
  text box extends past 1280×720 equivalents (13.333 × 7.5 in).
- Present the workspace path, slide count and anything illustrative.
