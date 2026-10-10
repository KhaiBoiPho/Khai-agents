# python-docx fallback

Use only when no `mcp__genoffice__*` tools exist. python-docx is not part of
Khai's base worker image: probe with `python -c "import docx"`. Write scripts
to a scratch file in the workspace and run them; keep the original file
untouched unless the user asked to overwrite it.

## Create a styled report

```python
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

PRIMARY, DARK = "1F3A5F", "1E2329"          # from the document-design style
doc = Document()

# Page setup: A4, 2.5 cm margins (landscape: swap width/height + orientation)
sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
for side in ("left_margin", "right_margin", "top_margin", "bottom_margin"):
    setattr(sec, side, Cm(2.5))

# Styles
normal = doc.styles["Normal"]
normal.font.name, normal.font.size = "Calibri", Pt(11)
normal.font.color.rgb = RGBColor.from_string(DARK)
normal.paragraph_format.space_after = Pt(6)
normal.paragraph_format.line_spacing = 1.15
for level, size in ((1, 20), (2, 16), (3, 13)):
    st = doc.styles[f"Heading {level}"]
    st.font.name, st.font.size, st.font.bold = "Arial", Pt(size), True
    st.font.color.rgb = RGBColor.from_string(PRIMARY)

doc.add_heading("Q3 Review", level=0)
doc.add_paragraph("Executive summary in 3–5 sentences.")
doc.add_heading("1. Results", level=1)
doc.save("reports/q3-review.docx")
```

## Table with a filled header row

```python
def shade(cell, hex_fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    tc_pr.append(shd)

rows = [("Region", "Revenue (bn VND)"), ("North", "4.2"), ("South", "3.9")]
table = doc.add_table(rows=len(rows), cols=len(rows[0]))
table.style = "Table Grid"
table.alignment = WD_TABLE_ALIGNMENT.CENTER
for r, values in enumerate(rows):
    for c, value in enumerate(values):
        cell = table.cell(r, c)
        cell.text = value
        para = cell.paragraphs[0]
        if c > 0 and r > 0:
            para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        if r == 0:
            shade(cell, PRIMARY)
            run = para.runs[0]
            run.font.bold = True
            run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
doc.add_paragraph("Source: finance system, Sept 2026.").runs[0].font.size = Pt(9)
```

## Images, page breaks

```python
doc.add_picture("assets/chart.png", width=Cm(15))
doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
doc.add_page_break()
```

Charts: python-docx cannot draw native charts. Render a PNG with reportlab
graphics or Pillow (or matplotlib if installed) and insert it as an image.

## Header and footer with page numbers

```python
def add_field(paragraph, instr):          # instr: "PAGE" or "NUMPAGES"
    run = paragraph.add_run()
    for kind, text in (("begin", None), (None, instr), ("end", None)):
        if kind:
            el = OxmlElement("w:fldChar"); el.set(qn("w:fldCharType"), kind)
        else:
            el = OxmlElement("w:instrText"); el.set(qn("xml:space"), "preserve")
            el.text = text
        run._r.append(el)

sec.header.paragraphs[0].text = "Q3 Review"
foot = sec.footer.paragraphs[0]
foot.alignment = WD_ALIGN_PARAGRAPH.RIGHT
foot.add_run("Page "); add_field(foot, "PAGE")
foot.add_run(" of "); add_field(foot, "NUMPAGES")
sec.different_first_page_header_footer = True   # no header on the cover
```

## Read (body order, tables included)

```python
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

doc = Document("input.docx")
for block in doc.iter_inner_content():          # python-docx ≥ 1.1
    if isinstance(block, Paragraph):
        if block.text.strip():
            print(f"[{block.style.name}] {block.text}")
    elif isinstance(block, Table):
        for row in block.rows:
            print(" | ".join(cell.text for cell in row.cells))
```

Without python-docx (stdlib only, text and table cells, no formatting):

```python
import zipfile
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
with zipfile.ZipFile("input.docx") as z:
    root = ET.fromstring(z.read("word/document.xml"))
for p in root.iter(f"{W}p"):
    text = "".join(t.text or "" for t in p.iter(f"{W}t"))
    if text.strip():
        print(text)
```

## Edit in place (formatting kept, no tracked changes)

Word splits text into runs; replace inside runs, and fall back to rewriting
the paragraph's first run only when the match spans runs.

```python
def replace_in_paragraph(p, old, new):
    for run in p.runs:
        if old in run.text:
            run.text = run.text.replace(old, new)
            return True
    if old in p.text:                       # match spans several runs
        full = p.text.replace(old, new)
        for run in p.runs[1:]:
            run.text = ""
        p.runs[0].text = full               # keeps the first run's format
        return True
    return False

def all_paragraphs(doc):
    yield from doc.paragraphs
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                yield from cell.paragraphs
    for sec in doc.sections:
        yield from sec.header.paragraphs
        yield from sec.footer.paragraphs
```

- Insert a paragraph after `p` (imports from *Create* and *Read*):
  `new = OxmlElement("w:p"); p._p.addnext(new);
  Paragraph(new, p._parent).add_run("text")`.
- Delete a paragraph: `p._element.getparent().remove(p._element)`.
- Template fill: run `replace_in_paragraph` for every `{{key}}`, then search
  for leftover `{{` and report them.
- A file that already contains tracked changes: python-docx shows inserted
  text but not deletions; tell the user and avoid editing inside revisions.

## Convert

- docx → Markdown: walk blocks as in *Read*; map `Heading n` to `#`×n and
  tables to GFM.
- Markdown → docx: parse with `markdown-it-py` (installed) and emit
  headings, paragraphs, lists and tables with the calls above.
- docx → pdf: needs the internal converter (GenOffice or a render/export
  tool). If none is available, skip it and tell the user.

## Verify

Re-open the saved file with `Document(path)`, print the heading list and the
table count, and compare with the plan.
