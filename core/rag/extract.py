"""Plain-text extraction for workspace documents, with citation locators.

Every extractor returns :class:`Section` values: a run of text plus the place
it came from (``page 3``, ``sheet Budget · rows 2–51``, ``slide 4``,
``line 120``) and the heading it sits under. Chunks never span two sections,
so a search hit can always be cited precisely.

Office formats (docx/xlsx/pptx) are ZIP packages of XML and are read with the
standard library only. PDFs use ``pypdf`` and fall back to the ``genoffice``
CLI's text-layer reader when it is installed and pypdf fails.
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
import shutil
import subprocess
import zipfile
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from typing import Iterable
from xml.etree import ElementTree

PDF_EXTENSIONS = frozenset({".pdf"})
DOCX_EXTENSIONS = frozenset({".docx"})
XLSX_EXTENSIONS = frozenset({".xlsx", ".xlsm"})
CSV_EXTENSIONS = frozenset({".csv", ".tsv"})
PPTX_EXTENSIONS = frozenset({".pptx"})
MARKDOWN_EXTENSIONS = frozenset({".md", ".markdown", ".mdx"})
TEXT_EXTENSIONS = frozenset({".txt", ".text", ".rst"})
HTML_EXTENSIONS = frozenset({".html", ".htm"})

SUPPORTED_EXTENSIONS: frozenset[str] = (
    PDF_EXTENSIONS
    | DOCX_EXTENSIONS
    | XLSX_EXTENSIONS
    | CSV_EXTENSIONS
    | PPTX_EXTENSIONS
    | MARKDOWN_EXTENSIONS
    | TEXT_EXTENSIONS
    | HTML_EXTENSIONS
)

# Rows per spreadsheet section: small enough that "rows 2–51" is a useful
# citation, large enough that a sheet is not shredded into one chunk per row.
ROWS_PER_SECTION = 50
# A single XML part larger than this is treated as hostile or broken.
_MAX_PART_BYTES = 64 * 1024 * 1024
_GENOFFICE_TIMEOUT_S = 60

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
_S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"


class ExtractionError(Exception):
    """The file is a supported type but no text could be read from it."""


@dataclass(frozen=True, slots=True)
class Section:
    text: str
    locator: str = ""
    heading: str = ""


def is_supported(path: str | Path) -> bool:
    return Path(path).suffix.lower() in SUPPORTED_EXTENSIONS


def extract_document(path: str | Path) -> list[Section]:
    """Extract the readable text of ``path`` as citation-ready sections."""

    file_path = Path(path)
    suffix = file_path.suffix.lower()
    if suffix in PDF_EXTENSIONS:
        sections = _extract_pdf(file_path)
    elif suffix in DOCX_EXTENSIONS:
        sections = _extract_docx(file_path)
    elif suffix in XLSX_EXTENSIONS:
        sections = _extract_xlsx(file_path)
    elif suffix in CSV_EXTENSIONS:
        sections = _extract_csv(file_path)
    elif suffix in PPTX_EXTENSIONS:
        sections = _extract_pptx(file_path)
    elif suffix in MARKDOWN_EXTENSIONS:
        sections = split_markdown(_read_text(file_path))
    elif suffix in HTML_EXTENSIONS:
        sections = split_markdown(html_to_markdown(_read_text(file_path)))
    elif suffix in TEXT_EXTENSIONS:
        sections = [Section(_read_text(file_path))]
    else:
        raise ExtractionError(f"unsupported document type: {suffix or 'none'}")
    sections = [
        Section(_clean(section.text), section.locator, section.heading.strip())
        for section in sections
    ]
    sections = [section for section in sections if section.text]
    if not sections:
        raise ExtractionError("no extractable text (scanned or empty document?)")
    return sections


# ---------------------------------------------------------------------------
# Plain text, Markdown, HTML
# ---------------------------------------------------------------------------


def _read_text(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-16"):
        try:
            if encoding == "utf-16" and not raw.startswith((b"\xff\xfe", b"\xfe\xff")):
                continue
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = re.sub(r"[ \t\f\v]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_FENCE = re.compile(r"^\s*(```|~~~)")


def split_markdown(text: str) -> list[Section]:
    """Split Markdown at headings; each section carries its heading path."""

    sections: list[Section] = []
    stack: list[tuple[int, str]] = []
    buffer: list[str] = []
    start_line = 1
    in_fence = False

    def flush() -> None:
        body = "\n".join(buffer).strip()
        if body:
            sections.append(
                Section(
                    body,
                    locator=f"line {start_line}",
                    heading=" › ".join(title for _level, title in stack),
                )
            )

    for number, line in enumerate(text.splitlines(), start=1):
        if _FENCE.match(line):
            in_fence = not in_fence
        match = None if in_fence else _HEADING.match(line)
        if match:
            flush()
            buffer = []
            level = len(match.group(1))
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, match.group(2).strip()))
            start_line = number
            continue
        if not buffer and not line.strip():
            continue
        if not buffer:
            start_line = number if not stack else start_line
        buffer.append(line)
    flush()
    return sections


class _HtmlToMarkdown(HTMLParser):
    _SKIPPED = frozenset({"script", "style", "noscript", "svg", "template", "head"})
    _BLOCKS = frozenset(
        {
            "address",
            "article",
            "aside",
            "blockquote",
            "br",
            "div",
            "footer",
            "header",
            "li",
            "main",
            "nav",
            "ol",
            "p",
            "pre",
            "section",
            "table",
            "tr",
            "ul",
        }
    )
    _HEADINGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):  # noqa: ANN001
        tag = tag.lower()
        if tag in self._SKIPPED:
            self._skip += 1
        elif self._skip:
            return
        elif tag in self._HEADINGS:
            self.parts.append("\n\n" + "#" * self._HEADINGS[tag] + " ")
        elif tag in {"td", "th"}:
            self.parts.append(" | ")
        elif tag in self._BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag):  # noqa: ANN001
        tag = tag.lower()
        if tag in self._SKIPPED:
            self._skip = max(0, self._skip - 1)
        elif self._skip:
            return
        elif tag in self._HEADINGS:
            self.parts.append("\n\n")
        elif tag in self._BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data):  # noqa: ANN001
        if not self._skip:
            # Headings must stay on one line to be recognised as headings.
            self.parts.append(re.sub(r"\s+", " ", data))


def html_to_markdown(html: str) -> str:
    parser = _HtmlToMarkdown()
    try:
        parser.feed(html)
        parser.close()
    except (AssertionError, ValueError):
        return html
    lines = [line.strip() for line in "".join(parser.parts).splitlines()]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines))


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------


def _extract_pdf(path: Path) -> list[Section]:
    error: Exception | None = None
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as exc:  # noqa: BLE001 - pypdf raises many types
                raise ExtractionError("PDF is password protected") from exc
        sections = []
        for number, page in enumerate(reader.pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception:  # noqa: BLE001 - one bad page must not sink the file
                text = ""
            if text.strip():
                sections.append(Section(text, locator=f"page {number}"))
        if sections:
            return sections
    except ExtractionError:
        raise
    except Exception as exc:  # noqa: BLE001
        error = exc
    fallback = _genoffice_pdf(path)
    if fallback:
        return fallback
    if error is not None:
        raise ExtractionError(f"could not read PDF: {type(error).__name__}") from error
    raise ExtractionError("PDF has no text layer (scanned document?)")


def genoffice_binary() -> str | None:
    """``$GENOFFICE_BIN``, then the repo bundle, then ``genoffice`` on PATH.

    A set-but-empty ``GENOFFICE_BIN`` disables GenOffice entirely."""

    explicit = os.environ.get("GENOFFICE_BIN")
    if explicit is not None:
        return explicit if explicit and Path(explicit).is_file() else None
    bundled = Path(__file__).resolve().parents[2] / "tools" / "genoffice" / "genoffice"
    if bundled.is_file() and os.access(bundled, os.X_OK):
        return str(bundled)
    return shutil.which("genoffice")


def _genoffice_pdf(path: Path) -> list[Section]:
    binary = genoffice_binary()
    if binary is None:
        return []
    sections: list[Section] = []
    start = 1
    while True:
        try:
            completed = subprocess.run(
                [
                    binary,
                    "pdf",
                    "read",
                    str(path),
                    "--range",
                    f"{start}-{start + 199}",
                    "--full",
                    "--json",
                ],
                capture_output=True,
                timeout=_GENOFFICE_TIMEOUT_S,
                check=False,
            )
            payload = json.loads(completed.stdout or b"{}")
        except (OSError, subprocess.SubprocessError, ValueError):
            return sections
        detail = payload.get("detail") if isinstance(payload, dict) else None
        if not isinstance(detail, dict) or payload.get("status") != "ok":
            return sections
        for page in detail.get("pages_read") or []:
            if isinstance(page, dict) and str(page.get("text") or "").strip():
                sections.append(
                    Section(str(page["text"]), locator=f"page {page.get('page')}")
                )
        total = int(detail.get("pages") or 0)
        start += 200
        if start > total:
            return sections


# ---------------------------------------------------------------------------
# OOXML helpers
# ---------------------------------------------------------------------------


def _open_zip(path: Path) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise ExtractionError("not a valid Office document") from exc


def _xml(archive: zipfile.ZipFile, name: str) -> ElementTree.Element | None:
    try:
        info = archive.getinfo(name)
    except KeyError:
        return None
    if info.file_size > _MAX_PART_BYTES:
        raise ExtractionError(f"document part {name} is too large")
    try:
        return ElementTree.fromstring(archive.read(info))
    except ElementTree.ParseError as exc:
        raise ExtractionError(f"document part {name} is not valid XML") from exc


def _relationships(archive: zipfile.ZipFile, part: str) -> dict[str, str]:
    """Map relationship ids of ``part`` to absolute package paths."""

    folder = PurePosixPath(part).parent
    rels_name = str(folder / "_rels" / (PurePosixPath(part).name + ".rels"))
    root = _xml(archive, rels_name)
    if root is None:
        return {}
    mapping: dict[str, str] = {}
    for rel in root.iter(f"{_REL}Relationship"):
        target = rel.get("Target") or ""
        if rel.get("TargetMode") == "External" or not target:
            continue
        resolved = (
            target.lstrip("/")
            if target.startswith("/")
            else _normalize_posix(folder / target)
        )
        mapping[rel.get("Id") or ""] = resolved
    return mapping


def _normalize_posix(path: PurePosixPath) -> str:
    parts: list[str] = []
    for part in path.parts:
        if part == "..":
            if parts:
                parts.pop()
        elif part not in {".", ""}:
            parts.append(part)
    return "/".join(parts)


# ---------------------------------------------------------------------------
# DOCX
# ---------------------------------------------------------------------------


def _paragraph_text(paragraph: ElementTree.Element) -> str:
    pieces: list[str] = []
    for node in paragraph.iter():
        if node.tag == f"{_W}t" and node.text:
            pieces.append(node.text)
        elif node.tag == f"{_W}tab":
            pieces.append("\t")
        elif node.tag in {f"{_W}br", f"{_W}cr"}:
            pieces.append("\n")
    return "".join(pieces)


def _heading_level(paragraph: ElementTree.Element) -> int | None:
    properties = paragraph.find(f"{_W}pPr")
    if properties is None:
        return None
    outline = properties.find(f"{_W}outlineLvl")
    if outline is not None and (outline.get(f"{_W}val") or "").isdigit():
        return int(outline.get(f"{_W}val") or 0) + 1
    style = properties.find(f"{_W}pStyle")
    value = (style.get(f"{_W}val") if style is not None else "") or ""
    lowered = value.lower()
    if lowered in {"title", "subtitle"}:
        return 0  # above Heading 1, so chapters nest under the title
    match = re.match(r"heading\s*(\d)", lowered)
    return int(match.group(1)) if match else None


def _extract_docx(path: Path) -> list[Section]:
    with _open_zip(path) as archive:
        root = _xml(archive, "word/document.xml")
    if root is None:
        raise ExtractionError("Word document has no body")
    body = root.find(f"{_W}body")
    if body is None:
        raise ExtractionError("Word document has no body")
    sections: list[Section] = []
    stack: list[tuple[int, str]] = []
    buffer: list[str] = []

    def flush() -> None:
        text = "\n\n".join(part for part in buffer if part.strip())
        if text.strip():
            heading = " › ".join(title for _level, title in stack)
            sections.append(Section(text, locator=stack[-1][1] if stack else "", heading=heading))

    for block in body:
        if block.tag == f"{_W}p":
            text = _paragraph_text(block).strip()
            level = _heading_level(block)
            if level is not None and text:
                flush()
                buffer = []
                while stack and stack[-1][0] >= level:
                    stack.pop()
                stack.append((level, text))
            elif text:
                buffer.append(text)
        elif block.tag == f"{_W}tbl":
            rows = []
            for row in block.iter(f"{_W}tr"):
                cells = [
                    " ".join(
                        _paragraph_text(p).strip() for p in cell.iter(f"{_W}p")
                    ).strip()
                    for cell in row.iter(f"{_W}tc")
                ]
                if any(cells):
                    rows.append(" | ".join(cells))
            if rows:
                buffer.append("\n".join(rows))
    flush()
    return sections


# ---------------------------------------------------------------------------
# XLSX / CSV
# ---------------------------------------------------------------------------


def _column_index(reference: str) -> int:
    index = 0
    for char in reference:
        if not char.isalpha():
            break
        index = index * 26 + (ord(char.upper()) - 64)
    return max(index - 1, 0)


def _shared_strings(archive: zipfile.ZipFile, workbook_rels: dict[str, str]) -> list[str]:
    candidates = [
        target for target in workbook_rels.values() if target.endswith("sharedStrings.xml")
    ] or ["xl/sharedStrings.xml"]
    root = _xml(archive, candidates[0])
    if root is None:
        return []
    return [
        "".join(node.text or "" for node in item.iter(f"{_S}t"))
        for item in root.iter(f"{_S}si")
    ]


def _cell_value(cell: ElementTree.Element, strings: list[str]) -> str:
    kind = cell.get("t")
    if kind == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(f"{_S}t"))
    value = cell.find(f"{_S}v")
    raw = value.text if value is not None and value.text is not None else ""
    if kind == "s":
        try:
            return strings[int(raw)]
        except (ValueError, IndexError):
            return ""
    if kind == "b":
        return "TRUE" if raw == "1" else "FALSE"
    return raw


def _table_sections(
    rows: Iterable[tuple[int, list[str]]], *, label: str
) -> list[Section]:
    """Group rows into sections; the header row is each section's heading."""

    sections: list[Section] = []
    header: list[str] | None = None
    block: list[tuple[int, list[str]]] = []

    def flush() -> None:
        if not block:
            return
        first, last = block[0][0], block[-1][0]
        lines = []
        for number, values in block:
            if header:
                pairs = [
                    f"{header[i] if i < len(header) and header[i] else f'col {i + 1}'}: {value}"
                    for i, value in enumerate(values)
                    if value
                ]
                lines.append(f"row {number}: " + "; ".join(pairs))
            else:
                lines.append(f"row {number}: " + " | ".join(values))
        rows_label = f"row {first}" if first == last else f"rows {first}–{last}"
        sections.append(
            Section(
                "\n".join(lines),
                locator=f"{label} · {rows_label}" if label else rows_label,
                heading=" | ".join(header) if header else label,
            )
        )
        block.clear()

    for number, values in rows:
        values = [value.strip() for value in values]
        while values and not values[-1]:
            values.pop()
        if not any(values):
            continue
        if header is None:
            header = values
            continue
        block.append((number, values))
        if len(block) >= ROWS_PER_SECTION:
            flush()
    flush()
    if not sections and header:
        sections.append(Section(" | ".join(header), locator=label, heading=label))
    return sections


def _extract_xlsx(path: Path) -> list[Section]:
    with _open_zip(path) as archive:
        workbook = _xml(archive, "xl/workbook.xml")
        if workbook is None:
            raise ExtractionError("workbook has no sheets")
        rels = _relationships(archive, "xl/workbook.xml")
        strings = _shared_strings(archive, rels)
        sections: list[Section] = []
        for sheet in workbook.iter(f"{_S}sheet"):
            name = sheet.get("name") or "Sheet"
            target = rels.get(sheet.get(f"{_R}id") or "")
            root = _xml(archive, target) if target else None
            if root is None:
                continue

            def rows(root: ElementTree.Element = root) -> Iterable[tuple[int, list[str]]]:
                for position, row in enumerate(root.iter(f"{_S}row"), start=1):
                    number = int(row.get("r") or position)
                    values: list[str] = []
                    for cell in row.iter(f"{_S}c"):
                        index = _column_index(cell.get("r") or "") if cell.get("r") else len(values)
                        while len(values) < index:
                            values.append("")
                        values.append(_cell_value(cell, strings))
                    yield number, values

            sections.extend(_table_sections(rows(), label=f"sheet {name}"))
    return sections


def _extract_csv(path: Path) -> list[Section]:
    text = _read_text(path)
    delimiter = "\t" if path.suffix.lower() == ".tsv" else ","
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        pass
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    return _table_sections(
        ((number, row) for number, row in enumerate(reader, start=1)), label=""
    )


# ---------------------------------------------------------------------------
# PPTX
# ---------------------------------------------------------------------------


def _shape_paragraphs(root: ElementTree.Element) -> list[str]:
    paragraphs = []
    for paragraph in root.iter(f"{_A}p"):
        text = "".join(node.text or "" for node in paragraph.iter(f"{_A}t")).strip()
        if text:
            paragraphs.append(text)
    return paragraphs


def _slide_title(root: ElementTree.Element) -> str:
    for shape in root.iter(f"{_P}sp"):
        placeholder = shape.find(f"{_P}nvSpPr/{_P}nvPr/{_P}ph")
        if placeholder is not None and placeholder.get("type") in {"title", "ctrTitle"}:
            return " ".join(_shape_paragraphs(shape))
    return ""


def _extract_pptx(path: Path) -> list[Section]:
    with _open_zip(path) as archive:
        presentation = _xml(archive, "ppt/presentation.xml")
        rels = _relationships(archive, "ppt/presentation.xml")
        order: list[str] = []
        if presentation is not None:
            for slide in presentation.iter(f"{_P}sldId"):
                target = rels.get(slide.get(f"{_R}id") or "")
                if target:
                    order.append(target)
        if not order:
            order = sorted(
                (
                    name
                    for name in archive.namelist()
                    if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
                ),
                key=lambda name: int(re.findall(r"\d+", name)[-1]),
            )
        sections: list[Section] = []
        for number, target in enumerate(order, start=1):
            root = _xml(archive, target)
            if root is None:
                continue
            title = _slide_title(root)
            lines = _shape_paragraphs(root)
            notes_target = next(
                (
                    value
                    for value in _relationships(archive, target).values()
                    if "notesSlide" in value
                ),
                None,
            )
            notes_root = _xml(archive, notes_target) if notes_target else None
            if notes_root is not None:
                notes = [
                    line
                    for line in _shape_paragraphs(notes_root)
                    if not line.isdigit()
                ]
                if notes:
                    lines.append("Speaker notes: " + " ".join(notes))
            if lines:
                sections.append(Section("\n".join(lines), locator=f"slide {number}", heading=title))
    return sections


__all__ = [
    "SUPPORTED_EXTENSIONS",
    "ExtractionError",
    "Section",
    "extract_document",
    "genoffice_binary",
    "html_to_markdown",
    "is_supported",
    "split_markdown",
]
