"""Read the text of the files a prompt attaches.

The composer appends ``Attached workspace context:`` and one ``- <path>`` line
per file. Documents (PDF, Word, PowerPoint, Markdown, HTML, text) are read
with the RAG extractor so they keep page/slide locators; any other UTF-8 file
(code, JSON, logs) is read as plain text. Spreadsheets and binaries are left
to the agent's own tools: a table is data, not prose to summarize.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

from core.rag.chunking import CHARS_PER_TOKEN
from core.rag.extract import (
    CSV_EXTENSIONS,
    XLSX_EXTENSIONS,
    ExtractionError,
    Section,
    extract_document,
    is_supported,
)

ATTACHED_HEADING = "\n\nAttached workspace context:\n"
UPLOAD_PREFIX = "deepcode-upload-"
#: Larger files are never read whole into memory for a prompt.
MAX_FILE_BYTES = 64 * 1024 * 1024
_TABLE_EXTENSIONS = XLSX_EXTENSIONS | CSV_EXTENSIONS


@dataclass(frozen=True, slots=True)
class AttachedText:
    """One attached file's readable text."""

    path: Path
    name: str
    sha256: str
    sections: tuple[Section, ...]

    @property
    def text(self) -> str:
        """The whole text, each located section marked (``[page 3]``)."""

        parts = []
        for section in self.sections:
            label = " · ".join(part for part in (section.locator, section.heading) if part)
            parts.append(f"[{label}]\n{section.text}" if label else section.text)
        return "\n\n".join(parts)

    @property
    def tokens(self) -> int:
        return estimate_tokens(self.text)


def estimate_tokens(text: str) -> int:
    return max(1, (len(text) + CHARS_PER_TOKEN - 1) // CHARS_PER_TOKEN)


def split_attached(prompt: str) -> tuple[str, list[str]]:
    """``(question, paths)``; no paths when the prompt has no attachment list."""

    at = prompt.rfind(ATTACHED_HEADING)
    if at < 0:
        return prompt, []
    lines = prompt[at + len(ATTACHED_HEADING):].split("\n")
    if not lines or not all(line.startswith("- ") for line in lines):
        return prompt, []
    paths = [line[2:].strip() for line in lines if line[2:].strip()]
    return prompt[:at], paths


def display_name(path: Path) -> str:
    """An upload's original name (``deepcode-upload-<24 hex>-<name>``)."""

    name = path.name
    if name.startswith(UPLOAD_PREFIX):
        rest = name[len(UPLOAD_PREFIX):]
        if len(rest) > 25 and rest[24] == "-":
            return rest[25:]
    return name


def _readable(path: Path, workspace: Path | None) -> bool:
    """Uploads anywhere, other files only inside the Session's workspace."""

    if path.name.startswith(UPLOAD_PREFIX):
        return True
    return workspace is not None and path.is_relative_to(workspace)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _decode(data: bytes) -> str | None:
    if b"\x00" in data[:8192]:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def read_attached(raw_path: str, workspace: Path | None) -> AttachedText | None:
    """The file's text, or None when it is not a readable text attachment."""

    try:
        path = Path(raw_path).expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    if not path.is_file() or not _readable(path, workspace):
        return None
    suffix = path.suffix.lower()
    if suffix in _TABLE_EXTENSIONS:
        return None
    try:
        if path.stat().st_size > MAX_FILE_BYTES:
            return None
        data = path.read_bytes()
    except OSError:
        return None
    sections: list[Section]
    if is_supported(path):
        try:
            sections = extract_document(path)
        except ExtractionError:
            return None
        except Exception:  # noqa: BLE001 - a broken file is left to the tools
            return None
    else:
        text = _decode(data)
        if text is None or not text.strip():
            return None
        sections = [Section(text.strip())]
    return AttachedText(
        path=path,
        name=display_name(path),
        sha256=_sha256(data),
        sections=tuple(sections),
    )


__all__ = [
    "ATTACHED_HEADING",
    "AttachedText",
    "display_name",
    "estimate_tokens",
    "read_attached",
    "split_attached",
]
