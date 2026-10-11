---
name: slides-html
description: Make beautiful new slide decks — presentations, pitch decks, lecture or report slides, explainer decks — by writing HTML/CSS slides on a designed theme and building them with Chromium into a vector PDF, an editable PPTX and PNG previews. First choice whenever the user wants a new deck or slides (PowerPoint or PDF), including Vietnamese. Editing an existing .pptx stays with office-pptx.
license: Original Khai-Agents content (see repository license)
---

# Slides from HTML

You write the deck as one HTML file; `scripts/build.mjs` renders it in
Chromium and produces:

- `<name>.pdf` — vector, real fonts, pixel-identical to the previews;
- `<name>.pptx` — each slide's artwork as its picture, every text block as
  an editable PowerPoint text box in the same place, font and colour;
- `<name>-preview/slide-NN.png` — what each slide looks like;
- a JSON lint report on stdout (overflow, clipped or overlapping text,
  shapes over text, tiny type, dense slides, missing files).

## Workflow

1. **Plan** (in your head or a short outline): audience, the one message,
   6–12 slides. For each slide: layout, a *takeaway headline* (a full
   sentence that states the point, not a topic label), and the content with
   real facts from the source. Gather facts first — read the code or
   documents — and never invent numbers.
2. **Write** `decks/<name>/<name>.html` (workspace-relative). Start from
   `assets/example.html` in this skill (read it once: it shows every layout
   in use). Keep images next to the deck and reference them relatively.
3. **Build**:
   `node <skill-dir>/scripts/build.mjs decks/<name>/<name>.html`
   (`--only check` for a fast lint + previews while iterating; `--out` to
   change the output base path).
4. **Look**: open every `slide-NN.png` from the preview folder (read the
   images). Check hierarchy, alignment, balance, empty space, contrast and
   that nothing is cut off. Fix every lint warning and everything that looks
   off, rebuild, and look again. Two or three rounds are normal; do not
   report done before a clean build *and* a visual pass.
5. **Deliver**: the chat shows the built PDF and PPTX as file cards. Link
   files with workspace-relative paths, e.g.
   `[PDF](decks/<name>/<name>.pdf)` — they open in the Files tab; never
   absolute paths or `file://` URLs. The PDF is the faithful version; the
   PPTX is for editing text in PowerPoint/Keynote.

## Deck structure

```html
<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>Deck title</title>
<style>/* deck-specific CSS; the theme is injected before it */</style>
</head>
<body data-palette="paper">
  <section class="slide cover">…</section>
  <section class="slide">…<aside class="notes">Speaker notes</aside></section>
</body>
</html>
```

Each `<section class="slide">` is exactly 1280×720 px with 72/88 px
padding, flex column. Nothing may extend past it.

## Theme reference (`assets/theme.css`)

Palettes (`<body data-palette>`): `paper` (default: warm off-white, coral),
`ocean` (navy, teal), `forest` (green, ochre), `plum` (violet, pink),
`midnight` (dark UI, blue), `mono` (black/white, red). Pick one per deck to
suit the topic; override tokens in the deck's `<style>` for a brand
(`:root{--accent:#…}` or `body{--accent:#…}`).

Tokens: `--bg --surface --surface-2 --ink --ink-2 --ink-3 --line --accent
--accent-2 --accent-soft --accent-ink --dark-bg --dark-ink --dark-ink-2`,
fonts `--font-sans` (Be Vietnam Pro), `--font-serif` (Lora),
`--font-mono` (JetBrains Mono). Inter is also installed. All cover
Vietnamese. Use only these fonts.

Slide variants: `cover`, `section` (with `.big` number), `dark`,
`accent-bg`.

**Colour contexts.** Text, lines and highlights read the tokens `--ink`,
`--ink-2`, `--ink-3`, `--line`, `--surface` and `--hl`. A `dark` or
`accent-bg` slide, a `.card.dark` / `.card.fill` and a `.callout` re-point
them, so everything inside stays readable. On a dark or accent slide a plain
`.card` is a translucent panel with light text; for a **white card on a dark
or coloured slide use `.card.light`** (it restores dark text). Never paint a
background or text colour by hand (`style="background:#fff"`,
`color: white`) — that is how text ends up white on white. For custom
colours, set the tokens on the element instead.

Building blocks:

| Class | Use |
| --- | --- |
| `.title` (`.rule` adds an accent bar) with `.kicker` + `h2` | slide header |
| `h1` 72 · `h2` 44 · `h3` 26 · `h4` 20 · body 24 · `.lead` 28 · `.small` 18 | type scale |
| `.body` (`.center`, `.bottom`) | fills the space under the title |
| `.cols-2/3/4`, `.split` (`.wide-left/right`), `.row`, `.stack`, `.grow` | layout |
| `.card` (`.tint`, `.fill`, `.dark`, `.top-rule`), `.num`, `.icon` | cards |
| `.metric` (`.huge`) with `.value` + `.label` | big numbers |
| `.timeline` > `.step` (`.when`, `h4`, `p`); `.flow` > `.card` + `.arrow` | sequences |
| `.quote` > `blockquote` + `.who` | quotes |
| `ul` (dots), `ol` (numbered badges), `ul.checks` | lists |
| `table` (`tr.hl` highlights a row), `pre`/`code` (`.k .s .c .f` spans) | data, code |
| `.bars` > `.bar` (`style="--v:.72"`, `.hl`, `.v`, `.k`) | simple bar chart |
| `.callout` (`.accent-bg`), `.tag`, `.footer` (two spans), `.highlight` | accents |
| `.glow`, `.grid-bg`, `.blob` (position it in the deck CSS) | decoration |
| `.muted`, `.accent`, `.serif`, `.mono` | text colour/face |

Inline SVG works for diagrams, icons and charts (keep SVG text minimal —
it stays part of the picture in the PPTX). `<img>` for photos and
screenshots (`.photo` covers its box).

## Lint warnings you must clear

`warnings` in the build output lists every problem as `slide N: …`. A deck
is not done until it is empty (or each remaining item is a deliberate,
explained choice):

- `low contrast X:1` — text is hard to read on what is behind it (needs
  4.5:1, 3:1 for large text). Use the colour contexts above.
- `boxes overlap` / `text spills out of its box` / `text blocks overlap` —
  content does not fit: cut text, split the slide, or give the boxes room.
  Never fix overlap with negative margins or absolute positions.
- `runs off the slide`, `extends past the slide edge`, `clipped` — too
  much content or a fixed size that is too small.
- `content ends in the top half` — centre (`.body.center`) or enlarge.
- `dense slide`, `text under 14px` — cut copy.

## Design rules — what makes slides look professional

- **One idea per slide.** The headline says the conclusion; the body proves
  it. If a slide needs two headlines, it is two slides.
- **Little text.** ≤ 40 words of body copy on a typical slide, ≤ 5 bullets,
  bullets ≤ 2 lines. Body text never below 18 px; footers/sources 14 px.
  Prefer a number, a diagram, a comparison or a quote to a paragraph.
- **Vary the layout.** Never the same layout on two consecutive slides; a
  10-slide deck uses at least five different layouts. Mix light slides with
  one or two `dark` or `accent-bg` slides for rhythm (cover, a key number,
  the closing).
- **Hierarchy through size and weight**, not colour: one dominant element
  per slide (headline, big number or picture), then supporting text in
  `--ink-2`, then sources in `--ink-3`.
- **Colour sparingly.** Neutral surfaces, one accent for what matters
  (highlighted bar, key word, the one callout). `--accent-2` only as a
  secondary note.
- **Align to a grid**; keep the theme padding; equal gaps; cards in a row
  have equal height (the grid does this). Fill the slide: content that ends
  in the top half looks unfinished — centre it (`.body.center`) or enlarge.
- **Real content**: cite sources in `.footer` (file paths, URLs, dates);
  name things concretely; no lorem ipsum, no placeholder icons with no
  meaning.
- **Vietnamese**: write proper diacritics (NFC); the fonts cover them.
  Uppercase kickers are fine; avoid letter-spacing on long Vietnamese text.

Good slide types to reach for: cover with decoration, agenda, section
divider, big number + explanation, three cards, before/after comparison
(`.cols-2` with `.card` and `.card.dark`), timeline or flow, chart + insight
(`.split`), table with one highlighted row, code + explanation, quote,
closing with the takeaway and next steps.

## Troubleshooting

- `build failed: … Executable doesn't exist` — Chromium is missing; set
  `KHAI_CHROMIUM` to a Chromium/Chrome binary.
- `missing file:` in `problems` — an image or stylesheet path is wrong
  (paths are relative to the HTML file).
- A PPTX text box wraps differently in PowerPoint when the viewer lacks the
  font: the PDF is unaffected. Mention that the fonts (Be Vietnam Pro, Lora,
  JetBrains Mono — free from Google Fonts) give the exact look.
