---
name: brand-guidelines
description: Anthropic's brand colours and typography (dark #141413, cream #faf9f5, orange/blue/green accents; Poppins headings, Lora body). Use only when the user wants Anthropic's or Claude's look-and-feel on a deck, document, page or graphic. For any other brand, ask for its guidelines and apply them through document-design.
license: Apache-2.0 (adapted from anthropics/skills brand-guidelines; see LICENSE.txt)
---

# Anthropic brand styling

Apply on top of the normal build workflow (office-* skills, genoffice tools,
frontend-design); this skill only supplies the values.

## Colours

Main:
- Dark `#141413` — primary text, dark backgrounds
- Light `#faf9f5` — light backgrounds, text on dark
- Mid gray `#b0aea5` — secondary elements
- Light gray `#e8e6dc` — subtle backgrounds

Accents (cycle in this order for non-text shapes):
- Orange `#d97757` — primary accent
- Blue `#6a9bcc` — secondary accent
- Green `#788c5d` — tertiary accent

## Typography

- Headings (24 pt and larger): Poppins, fallback Arial.
- Body: Lora, fallback Georgia.
- Use the fallbacks when the fonts are not installed on the reader's
  machine; never ship a file that depends on a missing font.

## Applying

- Text colour follows the background: dark on light, light on dark.
- Keep hierarchy: one heading font, one body font, no extra colours.
- GenOffice: put these values in the style (`deck_start` `style.md`,
  `docs_apply` `define_style`, `sheet_apply` formats). python-pptx /
  python-docx fallback: set colours with `RGBColor.from_string("D97757")`.
