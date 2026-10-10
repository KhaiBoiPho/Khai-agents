# pypdf + reportlab recipes

Both are installed in Khai's worker image (pypdf 6.x, reportlab 5.x).
Write to new files; page numbers below are 0-based in code, 1-based when you
talk to the user.

## Read

```python
from pypdf import PdfReader
reader = PdfReader("input.pdf")
if reader.is_encrypted:
    reader.decrypt("")                       # or the user's password
print(len(reader.pages), reader.metadata)
for i, page in enumerate(reader.pages[:20]):
    print(f"--- page {i + 1}")
    print(page.extract_text(extraction_mode="layout"))   # keeps columns
```

Images: `for img in page.images: open(f"out/{img.name}", "wb").write(img.data)`.

## Merge, split, extract, rotate, reorder

```python
from pypdf import PdfReader, PdfWriter

writer = PdfWriter()                         # merge (keeps bookmarks)
for path in ("a.pdf", "b.pdf"):
    writer.append(path)
writer.write("out/merged.pdf")

reader = PdfReader("input.pdf")              # split into ranges
for name, (start, end) in {"part1": (0, 3), "part2": (3, len(reader.pages))}.items():
    w = PdfWriter()
    for i in range(start, end):
        w.add_page(reader.pages[i])
    w.write(f"out/{name}.pdf")

w = PdfWriter()                              # reorder / delete / rotate
for i in (2, 0, 1):                          # new order; omit an index to drop it
    w.add_page(reader.pages[i])
w.pages[0].rotate(90)                        # clockwise, multiples of 90
w.write("out/reordered.pdf")
```

## Overlay: watermark and page numbers

```python
import io
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import Color
from reportlab.pdfgen import canvas

def overlay(width, height, draw):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    draw(c, width, height)
    c.save()
    buf.seek(0)
    return PdfReader(buf).pages[0]

reader = PdfReader("input.pdf")
writer = PdfWriter()
total = len(reader.pages)
for n, page in enumerate(reader.pages, start=1):
    w, h = float(page.mediabox.width), float(page.mediabox.height)
    def draw(c, w, h, n=n):
        c.setFont("Helvetica", 9)
        c.drawRightString(w - 40, 24, f"Page {n} of {total}")
        c.setFillColor(Color(0.6, 0.6, 0.6, alpha=0.25))
        c.setFont("Helvetica-Bold", 60)
        c.translate(w / 2, h / 2); c.rotate(45)
        c.drawCentredString(0, 0, "DRAFT")
    page.merge_page(overlay(w, h, draw))
    writer.add_page(page)
writer.write("out/stamped.pdf")
```

## Forms

```python
from pypdf import PdfReader, PdfWriter
reader = PdfReader("form.pdf")
for name, field in (reader.get_fields() or {}).items():
    print(name, field.get("/FT"), field.get("/V"), field.get("/_States_", ""))

writer = PdfWriter(clone_from=reader)
values = {"full_name": "Nguyen Van A", "agree": "/Yes"}   # checkbox: an /_States_ value
for page in writer.pages:
    writer.update_page_form_field_values(page, values, auto_regenerate=False)
writer.set_need_appearances_writer(True)
writer.write("out/form-filled.pdf")
# Non-editable copy: writer.update_page_form_field_values(..., flatten=True)
```

Confirm with `PdfReader("out/form-filled.pdf").get_fields()`.

## Encrypt, decrypt, metadata

```python
from pypdf import PdfReader, PdfWriter
writer = PdfWriter(clone_from=PdfReader("input.pdf"))
writer.add_metadata({"/Title": "Q3 Review", "/Author": "Finance"})
writer.encrypt(user_password="open-me", owner_password="owner", algorithm="AES-256")
writer.write("out/protected.pdf")
```

Decrypt: `reader.decrypt(pw)`, then copy pages into a new `PdfWriter`.

## Create from scratch (Platypus)

```python
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (Image, PageBreak, Paragraph, SimpleDocTemplate,
                                Spacer, Table, TableStyle)

PRIMARY = colors.HexColor("#1F3A5F")
# Unicode text (e.g. Vietnamese): register a TTF that has the glyphs
# pdfmetrics.registerFont(TTFont("Body", "path/to/Lora-Regular.ttf"))
styles = getSampleStyleSheet()
h1 = ParagraphStyle("h1", parent=styles["Heading1"], textColor=PRIMARY, fontSize=20)
body = ParagraphStyle("body", parent=styles["BodyText"], fontSize=11, leading=15)

def footer(c, doc):
    c.setFont("Helvetica", 9)
    c.drawRightString(A4[0] - 2.5 * cm, 1.5 * cm, f"Page {doc.page}")

data = [["Region", "Revenue (bn VND)"], ["North", "4.2"], ["South", "3.9"]]
table = Table(data, colWidths=[8 * cm, 5 * cm])
table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F3F5F8")]),
    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#5B6573")),
]))
story = [Paragraph("Q3 Review", h1), Paragraph("Executive summary…", body),
         Spacer(1, 0.4 * cm), table]
doc = SimpleDocTemplate("out/report.pdf", pagesize=A4, leftMargin=2.5 * cm,
                        rightMargin=2.5 * cm, topMargin=2.5 * cm, bottomMargin=2.5 * cm,
                        title="Q3 Review")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
```

Charts without matplotlib:

```python
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.shapes import Drawing

d = Drawing(14 * cm, 7 * cm)
chart = VerticalBarChart()
chart.x, chart.y, chart.width, chart.height = 30, 30, 12 * cm, 5.5 * cm
chart.data = [(3.1, 3.4, 3.9, 4.2)]
chart.categoryAxis.categoryNames = ["Q1", "Q2", "Q3", "Q4"]
chart.bars[0].fillColor = PRIMARY
d.add(chart)
story.append(d)                              # Drawings are flowables
```

Markdown → PDF without GenOffice: parse with `markdown-it-py` (installed)
and map headings, paragraphs, lists and tables to the flowables above.
