"""Detect document files a tool call created or changed, for chat file cards.

The timeline item of a tool call carries only a bounded result preview, so the
projection resolves document outputs once, at completion, while the file is
known to exist: the ``output_path`` of a JSON result envelope (the GenOffice
MCP tools and any tool using the same convention) and the target path of
Khai's own write/edit tools. Only regular files inside the thread workspace
are reported, as workspace-relative paths the Files panel can open.

A result may also list ``alternate_paths``: the same deliverable in other
formats (a deck built as PDF, PPTX and HTML). They ride on the first
document as ``alternates`` so the chat shows one card with a format choice.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

DOCUMENT_EXTENSIONS = frozenset(
    {
        "docx",
        "xlsx",
        "xlsm",
        "pptx",
        "pdf",
        "md",
        "markdown",
        "html",
        "htm",
        "csv",
        "tsv",
    }
)

_OUTPUT_PATH_RE = re.compile(r'"output_path"\s*:\s*("(?:[^"\\]|\\.)*")')
_ALTERNATES_RE = re.compile(r'"alternate_paths"\s*:\s*(\[(?:[^\]"\\]|"(?:[^"\\]|\\.)*")*\])')
_MAX_DOCUMENTS = 8


def _output_paths(result_preview: str | None) -> list[str]:
    if not result_preview:
        return []
    paths: list[str] = []
    for match in _OUTPUT_PATH_RE.finditer(result_preview):
        try:
            value = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        if isinstance(value, str) and value:
            paths.append(value)
    return paths


def _alternate_paths(result_preview: str | None) -> list[str]:
    if not result_preview:
        return []
    paths: list[str] = []
    for match in _ALTERNATES_RE.finditer(result_preview):
        try:
            values = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        paths.extend(value for value in values if isinstance(value, str) and value)
    return paths


def _resolve(raw: str, root: Path) -> dict[str, Any] | None:
    extension = raw.rsplit(".", 1)[-1].lower() if "." in raw else ""
    if extension not in DOCUMENT_EXTENSIONS:
        return None
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = root / candidate
    try:
        resolved = candidate.resolve(strict=True)
        relative = resolved.relative_to(root).as_posix()
        if not resolved.is_file():
            return None
        size = resolved.stat().st_size
    except (OSError, ValueError):
        return None
    return {
        "path": relative,
        "name": resolved.name,
        "extension": extension,
        "sizeBytes": size,
    }


def document_outputs(
    *,
    result_preview: str | None,
    edited_path: str | None,
    workspace: Path | None,
) -> list[dict[str, Any]]:
    """Return ``[{path, name, extension, sizeBytes}]`` for existing documents."""

    if workspace is None:
        return []
    try:
        root = workspace.expanduser().resolve(strict=True)
    except OSError:
        return []
    candidates = _output_paths(result_preview)
    if edited_path:
        candidates.append(edited_path)
    documents: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in candidates:
        document = _resolve(raw, root)
        if document is None or document["path"] in seen:
            continue
        seen.add(document["path"])
        documents.append(document)
        if len(documents) >= _MAX_DOCUMENTS:
            break
    if documents:
        alternates = []
        for raw in _alternate_paths(result_preview):
            document = _resolve(raw, root)
            if document is None or document["path"] in seen:
                continue
            seen.add(document["path"])
            alternates.append(document)
        if alternates:
            documents[0]["alternates"] = alternates[:_MAX_DOCUMENTS]
    return documents


__all__ = ["DOCUMENT_EXTENSIONS", "document_outputs"]
