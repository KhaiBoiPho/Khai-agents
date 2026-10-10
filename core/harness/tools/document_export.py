"""``document_export``: PDF export and page previews (headless LibreOffice).

Registered only where a converter is installed (the hosted Docker image), so
other machines pay no prompt tokens for it. Results are deliberately short:
file paths plus one summary line. Preview images ride the runner's tool-image
channel (``ToolResult.metadata["images"]``): image-capable models see them
inline, text-only models get saved paths instead.
"""

from __future__ import annotations

import base64
import time
from pathlib import Path
from typing import Any

from core.agent_runtime.tools.base import Tool, ToolResult, tool_parameters
from core.documents import convert
from core.harness.tools.files import _resolve, _within

PREVIEW_DIR = ".deepcode/previews"
DEFAULT_WIDTH = 1024
MAX_PAGES = 6


@tool_parameters(
    {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["pdf", "preview"],
                "description": "pdf: export to PDF. preview: render pages to PNG to check layout.",
            },
            "path": {
                "type": "string",
                "description": "Source file in the workspace (docx/xlsx/pptx/odt/html/md/pdf...).",
            },
            "out": {
                "type": "string",
                "description": "pdf: output .pdf path (default: next to the source).",
            },
            "pages": {
                "type": "array",
                "items": {"type": "integer", "minimum": 1},
                "maxItems": MAX_PAGES,
                "description": "preview: 1-based pages (default first, middle, last).",
            },
            "width": {
                "type": "integer",
                "minimum": convert.MIN_RENDER_WIDTH,
                "maximum": convert.MAX_RENDER_WIDTH,
                "description": f"preview: image width in px (default {DEFAULT_WIDTH}).",
            },
        },
        "required": ["action", "path"],
        "additionalProperties": False,
    }
)
class DocumentExportTool(Tool):
    """Export a document to PDF or render a few pages to PNG."""

    def __init__(self, workspace: str):
        self._workspace = str(workspace)

    @property
    def name(self) -> str:
        return "document_export"

    @property
    def description(self) -> str:
        return (
            "Export a document (docx/xlsx/pptx/odt/html/md) to PDF, or preview "
            "pages as PNG to check layout and charts. Preview only when the "
            "visual result matters; it renders at most 3 pages by default."
        )

    @property
    def timeout_s(self) -> float | None:
        return convert.DEFAULT_TIMEOUT_S * 3

    def _path(self, raw: str) -> Path | None:
        target = _resolve(self._workspace, raw)
        return target if _within(self._workspace, target) else None

    def _rel(self, path: Path) -> str:
        try:
            return str(path.relative_to(Path(self._workspace).resolve()))
        except ValueError:
            return str(path)

    async def execute(self, **kwargs: Any) -> Any:
        action = kwargs.get("action")
        src = self._path(str(kwargs.get("path") or ""))
        if src is None:
            return ToolResult("Error: path must be inside the workspace", is_error=True)
        started = time.monotonic()
        try:
            if action == "pdf":
                return await self._pdf(src, kwargs.get("out"), started)
            if action == "preview":
                return await self._preview(src, kwargs, started)
        except convert.ConverterError as exc:
            return ToolResult(
                f"Error ({exc.code}): {exc}",
                is_error=True,
                metadata={"errorCode": exc.code},
            )
        return ToolResult("Error: action must be 'pdf' or 'preview'", is_error=True)

    async def _pdf(self, src: Path, out_raw: Any, started: float) -> ToolResult:
        out = self._path(str(out_raw)) if out_raw else src.with_suffix(".pdf")
        if out is None:
            return ToolResult("Error: out must be inside the workspace", is_error=True)
        if out == src:
            return ToolResult("Error: out must differ from the source", is_error=True)
        await convert.export_pdf(src, out)
        pages = convert.pdf_page_count(out)
        return ToolResult(
            f"Exported {self._rel(out)} ({pages} page{'s' if pages != 1 else ''}, "
            f"{time.monotonic() - started:.1f}s)."
        )

    async def _preview(self, src: Path, kwargs: dict[str, Any], started: float) -> ToolResult:
        pages = [int(p) for p in (kwargs.get("pages") or [])][:MAX_PAGES] or None
        width = int(kwargs.get("width") or DEFAULT_WIDTH)
        out_dir = Path(self._workspace).resolve() / PREVIEW_DIR
        result = await convert.render_pages(
            src, out_dir, pages=pages, width_px=width, max_pages=MAX_PAGES
        )
        if not result.images:
            return ToolResult(
                f"Error: no pages to render ({src.name} has {result.page_count} pages)",
                is_error=True,
            )
        images = [
            {"mimeType": "image/png", "data": base64.b64encode(p.read_bytes()).decode("ascii")}
            for p in result.images
        ]
        listed = ", ".join(self._rel(p) for p in result.images)
        text = (
            f"Rendered page(s) {', '.join(map(str, result.pages))} of "
            f"{result.page_count} ({time.monotonic() - started:.1f}s): {listed}"
        )
        if result.skipped:
            text += f" (skipped out-of-range: {', '.join(map(str, result.skipped))})"
        return ToolResult(text, metadata={"images": images})


__all__ = ["DocumentExportTool"]
