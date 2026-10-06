"""Detect document files a tool call created or changed, for chat file cards.

The timeline item of a tool call carries only a bounded result preview, so the
projection resolves document outputs once, at completion, while the file is
known to exist: the ``output_path`` of a JSON result envelope (the GenOffice
MCP tools and any tool using the same convention) and the target path of
Khai's own write/edit tools. Only regular files inside the thread workspace
are reported, as workspace-relative paths the Files panel can open.
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
        extension = raw.rsplit(".", 1)[-1].lower() if "." in raw else ""
        if extension not in DOCUMENT_EXTENSIONS:
            continue
        candidate = Path(raw).expanduser()
        if not candidate.is_absolute():
            candidate = root / candidate
        try:
            resolved = candidate.resolve(strict=True)
            relative = resolved.relative_to(root).as_posix()
            if not resolved.is_file():
                continue
            size = resolved.stat().st_size
        except (OSError, ValueError):
            continue
        if relative in seen:
            continue
        seen.add(relative)
        documents.append(
            {
                "path": relative,
                "name": resolved.name,
                "extension": extension,
                "sizeBytes": size,
            }
        )
        if len(documents) >= _MAX_DOCUMENTS:
            break
    return documents


__all__ = ["DOCUMENT_EXTENSIONS", "document_outputs"]
