---
name: document-design
description: Visual design rules for documents Khai creates — slide decks (pptx), reports and letters (docx), spreadsheets (xlsx) and PDFs. Use together with the genoffice skill whenever a file will be read or presented by a person, so it ships with a deliberate palette, type scale, layout and data styling instead of plain defaults. Includes ready-made style sheets and per-format checklists.
license: Original Khai-Agents content (see repository license)
---

# Document design

The genoffice tools decide *how* a file is built; this skill decides *how it
looks*. Apply it to every deck, report and workbook meant for people. Plain
defaults (black Calibri on white, unstyled tables, bullet walls) read as
unfinished — avoid them.

## 1. Pick one style before writing anything

Choose one of the 15 style sheets in `references/styles.md` that fits the
audience, or derive one from the user's brand colours (Anthropic look:
`brand-guidelines`). If the user wants to choose, list 3–4 fitting names with
a one-line feel each. Keep the style for the whole file:

| Situation | Style |
| --- | --- |
| Business, finance, proposals, reports to management | **Navy** |
| Product, startup, tech, roadmaps | **Indigo** |
| Education, HR, health, community, friendly tone | **Teal** |
| Research, strategy, editorial, long reading | **Editorial** |
| Developer, data, launch on a dark stage | **Night** |
| Themed or industry-specific look (hospitality, fashion, wellness, gaming, …) | one of the 10 *Theme-factory styles* |

A style is 1 primary, 1 accent, 2–3 neutrals and 1 heading + 1 body font. Do
not introduce colours outside it (the deck checker flags off-palette colours).
State the choice in one line of your plan.

**Fonts.** Files open on the reader's machine, so use fonts every Office
install has, unless the user names others: headings `Montserrat`→fallback
`Arial`; body `Calibri` or `Arial`. For Vietnamese text use `Arial`,
`Calibri`, `Segoe UI` or `Be Vietnam Pro` (all carry the diacritics); never a
display font without Vietnamese glyphs.

## 2. Slides (pptx)

- Canvas 1280×720. Margins 64 px left/right, 48 px top/bottom; align
  everything to one left edge.
- Type scale: title 40–44 px bold, slide headline 28–32 px, body 18–22 px,
  captions 12–14 px. Never below 12 px.
- **One idea per slide.** The headline states the takeaway as a sentence
  ("Revenue grew 18% on enterprise deals"), not a topic ("Revenue").
- At most 5 bullets of ≤ 12 words; prefer 3. More content → split the slide.
- Vary layouts; never three bullet slides in a row. Use the patterns in
  `references/styles.md` → *Slide layouts*: cover, section divider, big
  number, two-column compare, 3-card grid, timeline, chart + insight,
  quote, closing / call to action.
- Numbers: one hero figure per slide, 72–96 px in the primary colour with a
  one-line label underneath.
- Data: charts over tables; one chart per slide, highlight the series that
  matters in the accent colour and grey the rest; label directly instead of a
  legend when ≤ 4 series.
- Colour: background white or the style's light neutral (dark only for the
  Night style or cover/section slides); text in the dark neutral, never pure
  #000000; accent for at most one element per slide.
- Cover slide: title, subtitle, presenter/date; a solid primary-colour block
  or band carries the brand. Closing slide: the ask or next steps, not "Thank
  you" alone.
- With the staged flow, paste the chosen style sheet as `style.md` in
  `deck_start`; with `create_pptx`, use only its colours and fonts in every
  element. Finish with `slides_audit` (fix every issue) and look at the
  render when it is available.

## 3. Reports and letters (docx)

- Structure: title block (title, subtitle, author, date) → short executive
  summary (3–5 sentences or bullets) → numbered sections → conclusion /
  recommendations → appendix. Add a table of contents above ~6 sections.
- Headings: H1 for sections, H2 for subsections, nothing deeper than H3.
  Paragraphs of 2–5 sentences; bold only key terms, never whole sentences.
- After `create_docx`, apply the style with `docs_apply`:
  `define_style` for Heading 1–3 (heading font, primary colour, size 20/16/13
  pt, space before 18/12/8 pt) and Normal (body font 11 pt, line spacing 1.15,
  space after 6 pt); `set_page_setup` A4 (or Letter for US readers), margins
  2.5 cm; `set_header_footer` with the document title left and
  `Page {PAGE} of {NUMPAGES}` right (skip the first page:`view: "first"`).
- Tables: header row filled with the primary colour and white bold text,
  light-neutral banding, numbers right-aligned with consistent decimals,
  units in the header ("Revenue (bn VND)"), a source line under the table.
  Use `setTableCellFormat` / `setTableStyle`.
- Callouts for key findings: a one-row table with the light accent fill.
- Letters and memos: no cover; sender block, date, recipient, subject line in
  bold, body, signature.

## 4. Spreadsheets (xlsx)

- One topic per sheet, sheets named in plain words; a `Summary` or `README`
  sheet first when there are several.
- Header row: bold, primary fill, white text, frozen (freeze panes below the
  header and right of the key column), auto-filter on.
- Column widths sized to content (12–40 characters); wrap long text.
- Number formats on every numeric column: thousands separators, fixed
  decimals, `0.0%` for ratios, ISO or locale dates, currency code in the
  header. Inputs in one colour (blue text), formulas in black, never
  hard-coded totals — always `=SUM(...)`.
- Totals row bold with a top border; light banding on long tables;
  conditional formatting only where it carries meaning (negatives red,
  targets met green).
- Add a chart for the main series with `add_chart`, titled with the
  takeaway, using the style's primary/accent colours.
- Run `sheet_check` and fix every formula error before presenting.

## 5. PDFs

Build the docx or pptx with the rules above first, then `create_pdf` /
`convert`. For a one-page brief or flyer, write Markdown or restricted HTML
using the style's colours and convert it.

## 6. Without GenOffice

When no `mcp__genoffice__*` tools exist, the office-* skills build files with
Python libraries; apply the same values there (heading/body fonts, palette
hex codes, table header fill, number formats). The rules above do not change.

## 7. Final check (every file)

- Same palette and fonts everywhere; nothing off-palette.
- No overflowing text, no orphan heading at a page or slide bottom, no
  slide with more than ~40 words of body text.
- Every number has a unit and a source or is marked illustrative.
- Look at the rendered pages when `render` / `slides_render` is available;
  if it reports `app_unavailable`, say the visual check was skipped.
