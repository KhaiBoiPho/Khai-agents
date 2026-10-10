"""Read PDF pages from their image with a vision model (figures, scans).

:func:`core.rag.extract.visual_candidates` picks the pages that need it;
:class:`VisualReader` renders each one, downscales it and asks the vision
model for a faithful transcription of the visible text plus a short
description of charts and tables with their numbers. The answer is indexed as
a ``[figure]`` section of that page.

Rendering tries, in order: ``pypdfium2`` (with Pillow) when installed, then
the GenOffice CLI's ``render`` command, else the page is skipped. Everything
is bounded (pages per document, image bytes, time per page, retries) and
cached by (page image hash, text layer, model, prompt version) in the
document store, so re-indexing an unchanged page costs nothing. A page that
fails is counted, never fatal: the document still indexes its text pages.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import subprocess
import tempfile
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from core.rag.extract import PdfPage, VisualResult, genoffice_binary
from core.rag.llm import (
    DEFAULT_CONCURRENCY,
    ChatClient,
    EnrichmentError,
    EnrichmentUnavailable,
    env_int,
    log_once,
)
from core.rag.store import read_cache, write_cache

VISION_ENV = "KHAI_RAG_VISION"
VISION_MODEL_ENV = "KHAI_RAG_VISION_MODEL"
MAX_PAGES_ENV = "KHAI_RAG_VISUAL_MAX_PAGES"
MAX_BYTES_ENV = "KHAI_RAG_VISUAL_MAX_BYTES"
TIMEOUT_ENV = "KHAI_RAG_VISUAL_TIMEOUT_S"

DEFAULT_MAX_PAGES = 30
DEFAULT_MAX_IMAGE_BYTES = 1_500_000
DEFAULT_TIMEOUT_S = 60.0
TARGET_PX = 1024  # longest side of the image sent to the model
JPEG_QUALITY = 72
SCAN_MAX_TOKENS = 1_500  # a full page transcription
FIGURE_MAX_TOKENS = 600  # only what the text layer misses
_TEXT_LAYER_CHARS = 1_500
_RENDER_TIMEOUT_S = 30
PROMPT_VERSION = "vis1"
CACHE_KIND = "visual"
_NOTHING = {"none", "none.", "blank", "blank.", "n/a"}


@dataclass(frozen=True, slots=True)
class PageImage:
    data: bytes
    mime: str


class PageRenderer(Protocol):
    name: str

    def render(self, path: Path, page: PdfPage, target_px: int) -> PageImage | None: ...


def _scale(page: PdfPage, target_px: int) -> float:
    longest = max(page.width, page.height) or 792.0
    return max(0.1, min(4.0, target_px / longest))


def compress(data: bytes, target_px: int = TARGET_PX) -> PageImage:
    """Downscale to ``target_px`` and re-encode as JPEG when Pillow is
    available; otherwise the PNG as rendered (already sized by the scale)."""

    try:
        from PIL import Image
    except ImportError:
        return PageImage(data, "image/png")
    try:
        with Image.open(io.BytesIO(data)) as image:
            image = image.convert("RGB")
            image.thumbnail((target_px, target_px))
            out = io.BytesIO()
            image.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        return PageImage(out.getvalue(), "image/jpeg")
    except Exception:  # noqa: BLE001 - keep the original bytes
        return PageImage(data, "image/png")


class PdfiumRenderer:
    name = "pypdfium2"

    @staticmethod
    def available() -> bool:
        try:
            import PIL  # noqa: F401
            import pypdfium2  # noqa: F401
        except ImportError:
            return False
        return True

    def render(self, path: Path, page: PdfPage, target_px: int) -> PageImage | None:
        import pypdfium2 as pdfium

        document = pdfium.PdfDocument(str(path))
        try:
            bitmap = document[page.number - 1].render(scale=_scale(page, target_px))
            image = bitmap.to_pil()
            out = io.BytesIO()
            image.save(out, format="PNG")
        finally:
            document.close()
        return compress(out.getvalue(), target_px)


class GenOfficeRenderer:
    name = "genoffice"

    def __init__(self, binary: str | None = None) -> None:
        self.binary = binary

    @staticmethod
    def available() -> bool:
        return genoffice_binary() is not None

    def render(self, path: Path, page: PdfPage, target_px: int) -> PageImage | None:
        binary = self.binary or genoffice_binary()
        if binary is None:
            return None
        with tempfile.TemporaryDirectory(prefix="khai-rag-render-") as out:
            completed = subprocess.run(
                [
                    binary,
                    "render",
                    str(path),
                    "--out",
                    out,
                    "--page",
                    str(page.number),
                    "--scale",
                    f"{_scale(page, target_px):.3f}",
                    "--json",
                ],
                capture_output=True,
                timeout=_RENDER_TIMEOUT_S,
                check=False,
            )
            try:
                payload = json.loads(completed.stdout or b"{}")
            except ValueError:
                return None
            if not isinstance(payload, dict) or payload.get("status") != "ok":
                return None
            files = (payload.get("detail") or {}).get("files") or []
            for entry in files:
                file = Path(str(entry.get("path") or "")) if isinstance(entry, dict) else None
                if file is not None and file.is_file() and Path(out) in file.parents:
                    return compress(file.read_bytes(), target_px)
        return None


def default_renderers() -> list[PageRenderer]:
    renderers: list[PageRenderer] = []
    if PdfiumRenderer.available():
        renderers.append(PdfiumRenderer())
    if GenOfficeRenderer.available():
        renderers.append(GenOfficeRenderer())
    return renderers


def _prompt(page: PdfPage) -> tuple[str, int]:
    text = page.text.strip()
    if len(text) >= 40:
        return (
            f"This is page {page.number} of a PDF. Its text layer is already "
            "indexed (below); do not repeat it. Describe concisely only what the "
            "text layer misses: charts, diagrams, tables and photos, and any text "
            "inside images. For charts and tables give the title, axes or columns, "
            "series and the key numbers. Write in the document's language, plain "
            "text only. If nothing is missing, answer exactly NONE.\n"
            f"<text_layer>\n{text[:_TEXT_LAYER_CHARS]}\n</text_layer>",
            FIGURE_MAX_TOKENS,
        )
    return (
        f"This is page {page.number} of a PDF that has no usable text layer "
        "(a scan, a slide or a figure). Transcribe all visible text faithfully, "
        "in reading order and in its original language; keep headings and lists, "
        "and write table rows as 'cell | cell'. Then describe briefly any chart, "
        "diagram or photo, including its numbers. Plain text only, no "
        "commentary. If the page is blank, answer exactly NONE.",
        SCAN_MAX_TOKENS,
    )


class VisualReader:
    """Vision transcription of selected PDF pages, bounded and cached."""

    def __init__(
        self,
        chat: ChatClient,
        *,
        renderers: Sequence[PageRenderer] | None = None,
        max_pages: int | None = None,
        max_image_bytes: int | None = None,
        concurrency: int = DEFAULT_CONCURRENCY,
        target_px: int = TARGET_PX,
    ) -> None:
        self.chat = chat
        self.renderers = list(default_renderers() if renderers is None else renderers)
        self.max_pages = (
            env_int(MAX_PAGES_ENV, DEFAULT_MAX_PAGES) if max_pages is None else max_pages
        )
        self.max_image_bytes = (
            env_int(MAX_BYTES_ENV, DEFAULT_MAX_IMAGE_BYTES, minimum=1)
            if max_image_bytes is None
            else max_image_bytes
        )
        self.concurrency = max(1, concurrency)
        self.target_px = target_px
        self.disabled = False

    @property
    def model(self) -> str:
        return self.chat.model

    def read_pages(
        self, path: Path, pages: list[PdfPage], *, cache: object | None = None
    ) -> VisualResult:
        result = VisualResult({})
        if self.disabled or not pages:
            result.skipped = len(pages)
            return result
        if not self.renderers:
            log_once(
                "RAG page vision skipped: no PDF renderer (install pypdfium2 or GenOffice)"
            )
            result.skipped = len(pages)
            return result
        selected = pages[: max(0, self.max_pages)]
        result.skipped = len(pages) - len(selected)

        images: dict[int, PageImage] = {}
        keys: dict[int, str] = {}
        for page in selected:
            image = self._render(path, page)
            if image is None:
                result.skipped += 1
                continue
            if len(image.data) > self.max_image_bytes:
                result.failed += 1
                continue
            images[page.number] = image
            keys[page.number] = self._cache_key(page, image)
        cached = read_cache(cache, CACHE_KIND, list(keys.values()))
        todo = []
        for page in selected:
            key = keys.get(page.number)
            if key is None:
                continue
            if key in cached:
                result.texts[page.number] = _clean_answer(cached[key])
            else:
                todo.append(page)

        fresh: dict[str, str] = {}

        def ask(page: PdfPage) -> tuple[PdfPage, str | None]:
            if self.disabled:
                return page, None
            prompt, max_tokens = _prompt(page)
            image = images[page.number]
            url = f"data:{image.mime};base64,{base64.b64encode(image.data).decode('ascii')}"
            try:
                answer = self.chat.complete(
                    [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": url}},
                    ],
                    max_tokens=max_tokens,
                )
            except EnrichmentUnavailable as exc:
                self.disabled = True
                log_once("RAG page vision disabled for this run: {}", exc)
                return page, None
            except EnrichmentError as exc:
                log_once("RAG page vision failed for a page: {}", exc)
                return page, None
            except Exception as exc:  # noqa: BLE001 - never fail the document
                log_once("RAG page vision failed for a page: {}", type(exc).__name__)
                return page, None
            return page, answer

        if todo:
            with ThreadPoolExecutor(
                max_workers=min(self.concurrency, len(todo)),
                thread_name_prefix="rag-vision",
            ) as pool:
                for page, answer in pool.map(ask, todo):
                    if answer is None:
                        result.failed += 1
                        continue
                    fresh[keys[page.number]] = answer
                    result.texts[page.number] = _clean_answer(answer)
        write_cache(cache, CACHE_KIND, self.model, fresh)
        result.texts = {n: t for n, t in result.texts.items() if t}
        return result

    def _render(self, path: Path, page: PdfPage) -> PageImage | None:
        for renderer in self.renderers:
            try:
                image = renderer.render(path, page, self.target_px)
            except Exception as exc:  # noqa: BLE001 - try the next renderer
                log_once("RAG page render failed with {}: {}", renderer.name, type(exc).__name__)
                continue
            if image is not None and image.data:
                return image
        return None

    def _cache_key(self, page: PdfPage, image: PageImage) -> str:
        digest = hashlib.sha256()
        for part in (
            PROMPT_VERSION,
            self.model,
            hashlib.sha256(image.data).hexdigest(),
            hashlib.sha256(page.text.strip()[:_TEXT_LAYER_CHARS].encode("utf-8")).hexdigest(),
        ):
            digest.update(part.encode("utf-8"))
            digest.update(b"\0")
        return digest.hexdigest()


def _clean_answer(answer: str) -> str:
    text = answer.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if "\n" in text else ""
    return "" if text.strip().lower() in _NOTHING else text.strip()


__all__ = [
    "DEFAULT_MAX_IMAGE_BYTES",
    "DEFAULT_MAX_PAGES",
    "GenOfficeRenderer",
    "PageImage",
    "PageRenderer",
    "PdfiumRenderer",
    "VisualReader",
    "compress",
    "default_renderers",
]
