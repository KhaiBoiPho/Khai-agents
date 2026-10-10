# openpyxl fallback

Use only when no `mcp__genoffice__*` tools exist. openpyxl is not part of
Khai's base worker image: probe with `python -c "import openpyxl"`.
openpyxl writes formulas but does not calculate them: values appear when the
file is opened in Excel/LibreOffice. Verify logic by recomputing in Python.

## Create a formatted, formula-driven sheet

```python
from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

PRIMARY = "1F3A5F"
wb = Workbook()
ws = wb.active
ws.title = "Sales"
rows = [("Month", "Units", "Price (USD)", "Revenue (USD)"),
        ("Jan", 120, 9.5), ("Feb", 135, 9.5), ("Mar", 150, 9.0)]
for r, row in enumerate(rows, start=1):
    for c, value in enumerate(row, start=1):
        ws.cell(r, c, value)
    if r > 1:
        ws.cell(r, 4, f"=B{r}*C{r}")                 # live formula
last = len(rows)
total = last + 1
ws.cell(total, 1, "Total")
ws.cell(total, 2, f"=SUM(B2:B{last})")
ws.cell(total, 4, f"=SUM(D2:D{last})")

# Header, totals, formats, widths, freeze, filter
for cell in ws[1]:
    cell.font = Font(bold=True, color="FFFFFF")
    cell.fill = PatternFill("solid", fgColor=PRIMARY)
for cell in ws[total]:
    cell.font = Font(bold=True)
    cell.border = Border(top=Side(style="thin"))
for r in range(2, total + 1):
    ws.cell(r, 2).number_format = "#,##0"
    ws.cell(r, 3).number_format = "#,##0.00"
    ws.cell(r, 4).number_format = "#,##0.00"
    ws.cell(r, 2).font = Font(color="0000FF") if r < total else Font(bold=True)
for col, width in zip("ABCD", (12, 10, 14, 16)):
    ws.column_dimensions[col].width = width
ws.freeze_panes = "B2"
ws.auto_filter.ref = f"A1:D{last}"

# Conditional formatting and validation
ws.conditional_formatting.add(f"B2:B{last}",
    CellIsRule(operator="lessThan", formula=["130"], font=Font(color="C00000")))
dv = DataValidation(type="list", formula1='"Open,Won,Lost"', allow_blank=True)
ws.add_data_validation(dv)
dv.add("E2:E100")

# Chart
chart = BarChart()
chart.title = "Revenue rose every month"
chart.y_axis.title = "USD"
chart.add_data(Reference(ws, min_col=4, min_row=1, max_row=last), titles_from_data=True)
chart.set_categories(Reference(ws, min_col=1, min_row=2, max_row=last))
chart.legend = None
ws.add_chart(chart, "G2")

# Print setup for later PDF export
ws.page_setup.orientation = "landscape"
ws.page_setup.fitToWidth = 1
ws.sheet_properties.pageSetUpPr.fitToPage = True
wb.save("data/sales.xlsx")
```

Cross-sheet reference: `='Inputs'!$B$2`. Named range:
`from openpyxl.workbook.defined_name import DefinedName;
wb.defined_names["growth"] = DefinedName("growth", attr_text="Inputs!$B$2")`.

## Read

```python
from openpyxl import load_workbook
wb = load_workbook("input.xlsx", data_only=True, read_only=True)  # cached values
for ws in wb.worksheets:
    print(f"--- {ws.title} ({ws.max_row}×{ws.max_column})")
    for row in ws.iter_rows(min_row=1, max_row=20, values_only=True):
        print(row)
formulas = load_workbook("input.xlsx")                  # formulas as strings
```

Without openpyxl (stdlib, first sheet, values only):

```python
import re, zipfile
from xml.etree import ElementTree as ET

N = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
with zipfile.ZipFile("input.xlsx") as z:
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(f"{N}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{N}t")))
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
for row in sheet.iter(f"{N}row"):
    out = []
    for c in row.iter(f"{N}c"):
        v = c.find(f"{N}v")
        inline = c.find(f"{N}is")
        if c.get("t") == "s" and v is not None:
            out.append(shared[int(v.text)])
        elif inline is not None:
            out.append("".join(t.text or "" for t in inline.iter(f"{N}t")))
        else:
            out.append((v.text or "") if v is not None else "")
    print(row.get("r"), out)
```

## Edit safely

- Open without `data_only` so formulas survive: `wb = load_workbook(path)`.
- `ws.insert_rows(idx, amount)` / `delete_rows` do **not** rewrite formulas
  that point at moved cells — after a structural change, rewrite affected
  formulas or append rows at the end instead.
- Keep `keep_vba=True` for `.xlsm`; charts and images in an existing file
  may be lost on save by openpyxl — warn the user and save to a new name.
- Error scan before presenting:

```python
bad = ("#REF!", "#DIV/0!", "#NAME?", "#VALUE!", "#N/A", "#NUM!")
vals = load_workbook("data/sales.xlsx", data_only=True)
for ws in vals.worksheets:
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and cell.value in bad:
                print(ws.title, cell.coordinate, cell.value)
```

(Files written by openpyxl have no cached values until opened in Excel, so
this finds errors only in workbooks that were calculated before.)

## CSV

```python
import csv
from openpyxl import Workbook
def typed(x):
    try:
        return float(x) if any(ch in x for ch in ".eE") else int(x)
    except ValueError:
        return x

wb = Workbook(); ws = wb.active
with open("input.csv", newline="", encoding="utf-8-sig") as f:
    for row in csv.reader(f):
        ws.append([typed(x) for x in row])
wb.save("data/input.xlsx")
```
