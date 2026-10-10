# Style sheets

Copy one block as `style.md` for `deck_start`, or use its values directly in
`create_pptx` specs, `docs_apply` styles and `sheet_apply` formats.

## Navy — business, finance, management

- Palette: primary `#1F3A5F`, accent `#E8A33D`, dark `#1E2329`,
  mid `#5B6573`, light `#F3F5F8`, white `#FFFFFF`.
- Fonts: headings Montserrat (fallback Arial) bold; body Calibri.
- Layouts: cover with a full-height navy panel on the left 40%; content
  slides on white with a 6 px navy rule under the headline; numbers in navy,
  the single highlight in amber.
- Style sentence: calm, precise, board-room ready.

## Indigo — product, tech, startup

- Palette: primary `#4F46E5`, accent `#06B6D4`, dark `#111827`,
  mid `#6B7280`, light `#F5F5FF`, white `#FFFFFF`.
- Fonts: headings Montserrat bold; body Arial.
- Layouts: cover with an indigo→violet band across the bottom third; cards
  with 12 px rounded corners on the light background; icons as simple
  outlined shapes in indigo.
- Style sentence: modern, energetic, clean.

## Teal — education, HR, health, community

- Palette: primary `#0F766E`, accent `#F59E0B`, dark `#1F2937`,
  mid `#64748B`, light `#F0FDFA`, white `#FFFFFF`.
- Fonts: headings Arial bold; body Calibri.
- Layouts: generous white space, rounded cards, one illustration or photo
  per section divider, friendly sentence-case headlines.
- Style sentence: warm, approachable, clear.

## Editorial — research, strategy, long reading

- Palette: primary `#7C2D12`, accent `#B45309`, dark `#1C1917`,
  mid `#78716C`, light `#FAF7F2`, white `#FFFFFF`.
- Fonts: headings Georgia bold; body Calibri (Georgia for long docx body).
- Layouts: wide margins, large pull quotes in the accent colour, thin rules
  between sections, footnote-style sources.
- Style sentence: thoughtful, authoritative, magazine-like.

## Night — developer, data, launch stage

- Palette: primary `#38BDF8`, accent `#A78BFA`, dark `#0B1120` (background),
  mid `#94A3B8`, light `#E2E8F0` (text), surface `#1E293B`.
- Fonts: headings Montserrat bold; body Arial; code Consolas.
- Layouts: dark background on every slide, surface-coloured cards, bright
  primary for figures and chart highlights. Docx/xlsx built in this style
  use the light variant (white page, primary as headings) for print.
- Style sentence: bold, technical, high contrast.

## Theme-factory styles

Ten more palettes from anthropics/skills `theme-factory` (Apache-2.0, see
`NOTICE`), condensed and re-mapped to the roles above. Upstream fonts
(DejaVu / Free*) are not on Office machines: in docx/pptx/xlsx use the Office
font shown; in PDFs drawn with reportlab or in HTML the upstream font is fine.
Check text contrast: several palettes pair mid tones, so put body text on the
light colour in the dark colour.

| Style | Primary | Accent | Dark | Mid | Light | Headings / body (Office) | Best for |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Ocean Depths** | `#2D8B8B` | `#A8DADC` | `#1A2332` | `#5B6573` | `#F1FAEE` | Arial bold / Calibri (DejaVu Sans) | corporate, finance, consulting |
| **Sunset Boulevard** | `#E76F51` | `#F4A261` | `#264653` | `#E9C46A` | `#FFFFFF` | Georgia bold / Calibri (DejaVu Serif / Sans) | creative pitches, marketing, events |
| **Forest Canopy** | `#2D4A2B` | `#A4AC86` | `#2D4A2B` | `#7D8471` | `#FAF9F6` | Georgia bold / Calibri (FreeSerif / FreeSans) | sustainability, outdoor, wellness |
| **Modern Minimalist** | `#36454F` | `#708090` | `#36454F` | `#708090` | `#D3D3D3` (rules), `#FFFFFF` page | Arial bold / Arial (DejaVu Sans) | architecture, design, data-heavy |
| **Golden Hour** | `#F4A900` | `#C1666B` | `#4A403A` | `#D4B896` | `#FBF7F0` | Arial bold / Calibri (FreeSans) | hospitality, food, lifestyle |
| **Arctic Frost** | `#4A6FA5` | `#C0C0C0` | `#1E2A3A` | `#6B7A8F` | `#D4E4F7` / `#FAFAFA` | Arial bold / Calibri (DejaVu Sans) | healthcare, clean tech, pharma |
| **Desert Rose** | `#B87D6D` | `#D4A5A5` | `#5D2E46` | `#8A6F68` | `#E8D5C4` | Arial bold / Calibri (FreeSans) | fashion, beauty, weddings, interiors |
| **Tech Innovation** | `#0066FF` | `#00FFFF` | `#1E1E1E` (background) | `#9CA3AF` | `#FFFFFF` (text) | Arial bold / Arial (DejaVu Sans) | launches, AI/ML, dark-stage decks |
| **Botanical Garden** | `#4A7C59` | `#F9A620` | `#2F3B2F` | `#B7472A` | `#F5F3ED` | Georgia bold / Calibri (DejaVu Serif / Sans) | food, farm-to-table, natural brands |
| **Midnight Galaxy** | `#4A4E8F` | `#A490C2` | `#2B1E3E` (background) | `#8E87A8` | `#E6E6FA` (text) | Arial bold / Arial (FreeSans) | entertainment, gaming, luxury |

Mid and some dark values not in the upstream four-colour palettes were added
to fill the roles; Tech Innovation and Midnight Galaxy are dark-stage styles
(like Night): use their light variant (white page, primary headings) for
print docx/xlsx.

## Slide layouts (all styles)

1. **Cover** — title (44 px), subtitle (22 px), presenter · date (14 px);
   brand block in the primary colour.
2. **Section divider** — big section number + title on the primary colour.
3. **Big number** — one figure at 96 px, a label, one supporting sentence.
4. **Two-column compare** — before/after or option A/B, equal columns,
   headings in primary, a verdict line in accent at the bottom.
5. **3-card grid** — three equal cards: icon/shape, 2–4 word title, ≤ 20
   words each.
6. **Timeline / process** — 3–6 steps on one horizontal line with dots,
   dates above, labels below.
7. **Chart + insight** — chart on the left 60%, the takeaway and 2 bullets
   on the right.
8. **Quote** — one quote at 28–32 px with attribution; light background.
9. **Closing** — the ask / next steps as 2–3 short lines and a contact.
