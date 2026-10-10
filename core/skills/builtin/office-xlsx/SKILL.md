---
name: office-xlsx
description: Task workflow for Excel workbooks (.xlsx, plus csv/tsv) — build spreadsheets, trackers, budgets and financial models with live formulas; read or analyse sheets; edit existing workbooks (values, formulas, formats, rows/columns, sheets, charts, conditional formatting, validation); clean messy tables; convert csv↔xlsx and xlsx→pdf. Use whenever a spreadsheet is the input or deliverable. Builds with GenOffice tools when present, Python otherwise; looks via document-design.
license: Original Khai-Agents content (see repository license)
---

# Excel workbooks (.xlsx)

## 0. Choose the engine and the look

- `mcp__genoffice__*` tools listed → **GenOffice path** (load `genoffice`;
  `guide sheets <op>` for op fields).
- No GenOffice tools → **Python path**: `references/python-fallback.md`.
  Probe `python -c "import openpyxl"`. If openpyxl is missing, deliver CSV
  (stdlib `csv`) and tell the user formatting and formulas need the engine
  or openpyxl. Install packages only when the user agrees and the network
  allows it.
- Apply the `document-design` spreadsheet rules (header fill, frozen header,
  number formats, totals row). Paths workspace-relative; keep originals.

## 1. Model rules (both paths)

- **Formulas, not pasted results**: totals, ratios, growth, lookups are
  Excel formulas (`=SUM(B2:B13)`, `=IFERROR(C5/B5,0)`), so the workbook stays
  live. Compute in Python only to check the formulas.
- Inputs separated from calculations: an `Inputs` / `Assumptions` block or
  sheet; inputs in blue text, formulas black, links to other sheets green.
- No hard-coded numbers inside formulas (`=B5*1.1` → reference an input
  cell). Absolute refs (`$B$2`) for shared inputs.
- One table per sheet starting at A1, one header row, no merged cells inside
  data, consistent units per column (unit in the header).
- Dates as real dates, numbers as numbers (never text with thousands
  separators). Document sources in a `README` / `Notes` sheet.

## 2. Create

GenOffice: `create_xlsx {data | sheets:[{name, rows}], header: true, out}`;
strings starting with `=` are formulas. Then one `sheet_apply` batch:
number formats, column widths, freeze panes, filters, conditional
formatting, data validation, `add_chart` — look each op up in `guide sheets`.
Python: openpyxl per the fallback reference.

## 3. Read / analyse

- Size first: `sheet_read {file, stats: true}`; then ranges
  (`range: "A1:H200"`) or `convert {to: "csv", sheet}` for a whole sheet.
- Python: openpyxl `load_workbook(data_only=True)` for cached values,
  without `data_only` for formulas. A formula with no cached value reads as
  `None` — say so rather than guessing.
- For analysis, compute with Python (`csv`, `statistics`) on the extracted
  values and state the method; write results back as formulas when the user
  wants them in the workbook.

## 4. Edit an existing workbook

1. Read the target sheet and header row; address sheets by their exact tab
   name.
2. `sheet_apply {file, ops, out?}` (or `cells` for plain cell writes).
   Ops run in order: after inserting/deleting rows or columns, later ops use
   the shifted grid — put structural ops last or write post-shift addresses.
3. Preserve existing formats, formulas, named ranges and other sheets.
   Python: never `load_workbook(data_only=True)` and save — that destroys
   formulas.
4. `sheet_check`, then re-read the changed range.

## 5. Formats, charts, rules

| Need | Approach |
| --- | --- |
| Number formats | `#,##0`, `#,##0.00`, `0.0%`, `yyyy-mm-dd`, currency code in header |
| Header | bold, primary fill, white text, freeze below header, auto-filter |
| Totals | bold row with top border, `=SUM()` / `=SUBTOTAL(109, …)` |
| Conditional formatting | only where it carries meaning (negative red, target met green) |
| Validation | dropdown lists for categorical inputs |
| Chart | one per main series, titled with the takeaway, style colours |
| Pivot / summary | GenOffice `add_pivot`; Python: `SUMIFS` summary table |

Formulas the engine cannot evaluate (FILTER, SORT, UNIQUE, LET, LAMBDA)
are saved without cached values (`formulas_not_cached`): fine, but mention
it. Prefer SUMIFS/INDEX-MATCH/XLOOKUP when the user's Excel is unknown.

## 6. Clean messy data

Detect the real header row, drop blank/junk rows, split combined columns,
trim whitespace, normalise dates and decimal separators (`--decimal ,` for
`1.234,5` with GenOffice csv import), de-duplicate, and report what changed
(row counts before/after) in a Notes sheet or the reply.

## 7. Convert

- csv → xlsx: `convert` or `create_xlsx` from csv; Python: read with `csv`,
  write with openpyxl, then format.
- xlsx → csv: `convert {to: "csv", sheet}`; Python: `csv.writer` over
  `ws.iter_rows(values_only=True)` (one file per sheet).
- xlsx → pdf: use the internal converter when available; otherwise skip and
  tell the user. Set print area / landscape / fit-to-width first.

## 8. Final check

- `sheet_check` → no `formula_error`, `missing_sheet_ref`, `number_overflow`
  (two fix rounds max). Python: scan for `#REF!`, `#DIV/0!`, `#NAME?`,
  `#VALUE!` in cached values when present, and for formulas pointing at
  empty or missing sheets.
- Spot-check two totals by recomputing them from the inputs.
- If render is available, `render` the main sheet and look; on
  `app_unavailable` skip and say the visual check was skipped.
- Present the workspace path, sheets and what each holds, and any uncached
  formulas or illustrative numbers.
