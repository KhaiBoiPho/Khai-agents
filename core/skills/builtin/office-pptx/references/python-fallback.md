# python-pptx fallback

Use only when no `mcp__genoffice__*` tools exist. python-pptx is not part of
Khai's base worker image: probe with `python -c "import pptx"`. Run scripts
from the workspace; keep the source deck unchanged unless asked.

## Create on a 16:9 grid

```python
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Emu, Pt

PRIMARY, ACCENT, DARK, LIGHT = "1F3A5F", "E8A33D", "1E2329", "F3F5F8"
prs = Presentation()
prs.slide_width, prs.slide_height = Emu(12192000), Emu(6858000)  # 13.333×7.5 in
PX = 9525                                    # 1 px of the 1280×720 canvas in EMU
BLANK = prs.slide_layouts[6]

def box(slide, x, y, w, h, text, size=20, bold=False, color=DARK):
    tb = slide.shapes.add_textbox(Emu(x * PX), Emu(y * PX), Emu(w * PX), Emu(h * PX))
    tf = tb.text_frame
    tf.word_wrap = True
    lines = text if isinstance(text, list) else [text]
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        run = p.add_run()
        run.text = line
        run.font.size, run.font.bold = Pt(size * 0.75), bold   # px → pt
        run.font.color.rgb = RGBColor.from_string(color)
        run.font.name = "Calibri"
    return tb

def band(slide, x, y, w, h, color):
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Emu(x * PX), Emu(y * PX),
                                 Emu(w * PX), Emu(h * PX))
    shp.fill.solid(); shp.fill.fore_color.rgb = RGBColor.from_string(color)
    shp.line.fill.background()
    return shp

# Cover
s = prs.slides.add_slide(BLANK)
band(s, 0, 0, 512, 720, PRIMARY)
box(s, 576, 260, 640, 120, "Launch plan 2027", 44, True)
box(s, 576, 380, 640, 60, "Board review · 10 Oct 2026", 22, color="5B6573")

# Content slide: takeaway headline + bullets
s = prs.slides.add_slide(BLANK)
box(s, 64, 48, 1152, 80, "Enterprise deals drove 18% growth", 32, True)
band(s, 64, 128, 1152, 6, PRIMARY)
box(s, 64, 170, 700, 400, ["Three new banks signed", "Churn down to 2.1%",
                           "Pipeline covers 1.4× next year's target"], 22)
s.notes_slide.notes_text_frame.text = "Speaker notes here."
prs.save("decks/launch.pptx")
```

Rules: margins 64 px left/right, 48 px top; fonts every Office install has;
body ≥ 18 px; one accent element per slide.

## Charts (native, editable in PowerPoint)

```python
data = CategoryChartData()
data.categories = ["Q1", "Q2", "Q3", "Q4"]
data.add_series("Revenue (bn VND)", (3.1, 3.4, 3.9, 4.2))
frame = s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Emu(64 * PX),
                           Emu(170 * PX), Emu(740 * PX), Emu(480 * PX), data)
chart = frame.chart
chart.has_legend = False
plot = chart.plots[0]
plot.has_data_labels = True
series = plot.series[0]
series.format.fill.solid()
series.format.fill.fore_color.rgb = RGBColor.from_string(PRIMARY)
point = series.points[3]                      # highlight the latest value
point.format.fill.solid()
point.format.fill.fore_color.rgb = RGBColor.from_string(ACCENT)
```

Other types: `LINE_MARKERS`, `BAR_CLUSTERED`, `PIE`, `DOUGHNUT`,
`XY_SCATTER` (use `XyChartData`).

## Tables and images

```python
rows = [("Plan", "Price", "Seats"), ("Team", "$12", "10"), ("Business", "$30", "50")]
gt = s.shapes.add_table(len(rows), 3, Emu(820 * PX), Emu(170 * PX),
                        Emu(396 * PX), Emu(200 * PX)).table
for r, values in enumerate(rows):
    for c, value in enumerate(values):
        cell = gt.cell(r, c)
        cell.text = value
        font = cell.text_frame.paragraphs[0].runs[0].font
        font.size = Pt(14)
        if r == 0:
            cell.fill.solid(); cell.fill.fore_color.rgb = RGBColor.from_string(PRIMARY)
            font.bold = True; font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

pic = s.shapes.add_picture("assets/photo.png", Emu(820 * PX), Emu(400 * PX),
                           width=Emu(396 * PX))   # height follows aspect ratio
```

## Read

```python
from pptx import Presentation
prs = Presentation("input.pptx")
for n, slide in enumerate(prs.slides, start=1):
    print(f"--- slide {n}")
    for shape in slide.shapes:
        if shape.has_text_frame and shape.text_frame.text.strip():
            print(shape.text_frame.text)
        if shape.has_table:
            for row in shape.table.rows:
                print(" | ".join(c.text for c in row.cells))
    if slide.has_notes_slide:
        print("notes:", slide.notes_slide.notes_text_frame.text)
```

Without python-pptx (stdlib, text only):

```python
import re, zipfile
from xml.etree import ElementTree as ET

A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
with zipfile.ZipFile("input.pptx") as z:
    names = sorted((n for n in z.namelist()
                    if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
                   key=lambda n: int(re.findall(r"\d+", n)[0]))
    for n in names:
        root = ET.fromstring(z.read(n))
        paras = ["".join(t.text or "" for t in p.iter(f"{A}t"))
                 for p in root.iter(f"{A}p")]
        print(f"--- {n}\n" + "\n".join(x for x in paras if x.strip()))
```

## Edit

- Replace text but keep formatting: set `run.text` on existing runs (as in
  the docx fallback); do not assign `text_frame.text`, which drops run
  styles.
- Delete slide `i`:
  ```python
  ids = prs.slides._sldIdLst
  sld = ids[i]
  prs.part.drop_rel(sld.rId)
  ids.remove(sld)
  ```
- Move slide from `i` to `j`: `ids = prs.slides._sldIdLst; el = ids[i];
  ids.remove(el); ids.insert(j, el)`.
- Duplicate a slide: add a slide with the same layout and copy shapes with
  `copy.deepcopy(shape._element)` into `new.shapes._spTree`; pictures and
  charts need their relationships copied too, so prefer rebuilding them.
- Template deck: open it, use `prs.slide_layouts` by name, fill placeholders
  via `slide.placeholders[idx].text`.

## Convert

pptx → pdf/png needs the internal converter (GenOffice or a render/export
tool). If none is available, skip and tell the user.

## Verify

Re-open the file; print each slide's first text (headline) and check every
shape fits: `shape.left + shape.width <= prs.slide_width` and the same for
height.
