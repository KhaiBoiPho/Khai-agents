---
name: office-pdf
description: Task workflow for PDF files — read and extract text, tables and images; merge, split, rotate, reorder or extract pages; watermark, stamp page numbers, encrypt/decrypt; fill or inspect form fields; create PDFs (reports, one-pagers, certificates, invoices) from docx/md/html or from scratch; convert PDF to docx/md. Use whenever a .pdf is the input or the deliverable. GenOffice tools for reading and printing when present; pypdf and reportlab (installed) for everything else; looks via document-design.
license: Original Khai-Agents content (see repository license)
---

# PDF files

## 0. Pick the tool for the job

| Task | First choice | Otherwise |
| --- | --- | --- |
| Read text | `pdf_read {file, range: "1-20"}` | pypdf `extract_text()` |
| PDF → docx / md | `convert {file, to: "docx"\|"md"}` | extract text, rebuild with `office-docx` |
| Designed document as PDF | build docx/pptx/md first, then `create_pdf` / `convert` | reportlab (Platypus) |
| Merge / split / rotate / reorder | pypdf | — |
| Watermark / page numbers / stamp | pypdf + a reportlab overlay | — |
| Forms (list, fill, flatten) | pypdf | — |
| Encrypt / decrypt, metadata | pypdf | — |
| Images out of a PDF | pypdf `page.images` | — |

pypdf, reportlab and Pillow are installed in Khai's worker image; recipes
are in `references/pypdf-reportlab.md`. GenOffice tools appear as
`mcp__genoffice__*` (load `genoffice` for their arguments). Paths are
workspace-relative; write results to new files, never over the input.

## 1. Read / extract

- `pdf_read`: pass at most one of `page` or `range`; omit both for the first
  pages. Large files: read in ranges, summarise as you go.
- Tables: extract text with layout (`extraction_mode="layout"` in pypdf),
  then rebuild rows by column positions; verify totals. Say when a table
  could not be recovered reliably.
- Scanned PDFs (no text layer, `extract_text()` empty): OCR needs
  `pytesseract` + Tesseract, which are not in the base image — say so, or
  look at rendered page images when an image-capable model and render tool
  are available.
- Encrypted input: try an empty password with `reader.decrypt("")`; ask the
  user for the password otherwise.

## 2. Create

1. Pick a `document-design` style.
2. Preferred: write the content as docx (`office-docx`) or Markdown, then
   `create_pdf {from, out}` / `convert {file, to: "pdf"}`.
3. If the converter is missing or returns `app_unavailable`, or the layout is
   fixed (certificate, invoice, label, one-pager), draw with reportlab:
   Platypus for flowing text and tables, canvas for exact positions, charts
   via `reportlab.graphics.charts`. Register a TTF font that covers the text —
   built-in Helvetica has no Vietnamese diacritics; the `canvas-design`
   skill's `canvas-fonts/` (Lora, Work Sans, IBM Plex Serif) do.

## 3. Page operations

Merge, split by ranges, extract pages, rotate, reorder, delete, add blank
pages, crop: pypdf `PdfReader` → `PdfWriter`, writing a new file. State the
resulting page count. Keep bookmarks when merging (`writer.append` keeps
outlines).

## 4. Overlays

Watermark ("DRAFT", "CONFIDENTIAL"), page numbers, header stamps, signature
images: draw one overlay page per size with reportlab, then
`page.merge_page(overlay)` (stamp on top) or merge the original onto the
overlay (watermark underneath). Keep overlay text light and outside the
content margins.

## 5. Forms

1. List fields: `reader.get_fields()` → name, type (`/Tx`, `/Btn`, `/Ch`),
   current value, options for check/radio boxes.
2. Map the user's data to field names; ask about anything ambiguous.
3. Fill with `writer.update_page_form_field_values(page, values,
   auto_regenerate=False)` and set `writer.set_need_appearances_writer(True)`.
4. Flatten only when the user wants a non-editable copy.
5. Re-read the fields from the output and confirm each value.
A PDF without AcroForm fields cannot be "filled": overlay text at measured
coordinates instead and tell the user.

## 6. Security and metadata

`writer.encrypt(user_password, owner_password, algorithm="AES-256")`;
never put the password in the file name or chat summary unless the user
supplied it there. Metadata via `writer.add_metadata({...})`.

## 7. Final check

- Re-open every output with pypdf: page count, `extract_text()` on the first
  and last page, form values, encryption status.
- Visual check: use the internal converter/renderer when available
  (`render` of page 1 and the last page); otherwise skip and tell the user the
  visual check was skipped.
- Present workspace paths, page counts and anything not recovered
  (scanned pages, unreadable tables).
