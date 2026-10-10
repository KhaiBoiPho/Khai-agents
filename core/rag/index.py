"""Incremental indexing of one workspace's documents.

A file is (re)indexed when its size or mtime changed *and* its content hash
differs from the indexed one, or when the embedding model changed. Files that
disappeared are removed. Work is bounded by a deadline so a caller (an agent
Turn) can index "as much as fits" and leave the rest to a background job.

An optional :class:`core.rag.enrich.Enrichment` adds model-written chunk
contexts (contextual retrieval) and vision transcriptions of PDF figure and
scanned pages. Both are best-effort: any failure indexes the document as
before.
"""

from __future__ import annotations

import hashlib
import os
import time
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import TYPE_CHECKING

from loguru import logger

from core.rag.chunking import chunk_sections
from core.rag.embeddings import Embedder, EmbeddingError
from core.rag.extract import ExtractionError, ExtractStats, extract_document, is_supported
from core.rag.store import DocumentRecord, DocumentStore, SearchHit

if TYPE_CHECKING:
    from core.rag.enrich import Enrichment

MAX_DOCUMENTS = 500
MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
# Plain-text formats this large are logs or data dumps, not documents.
MAX_TEXT_BYTES = 4 * 1024 * 1024
MAX_CHUNKS_PER_DOCUMENT = 2_000
_TEXT_SUFFIXES = frozenset({".md", ".markdown", ".mdx", ".txt", ".text", ".rst", ".html", ".htm"})
SKIPPED_DIRECTORIES = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        ".deepcode",
        ".venv",
        "venv",
        "env",
        "node_modules",
        "__pycache__",
        "dist",
        "build",
        "target",
        ".next",
        ".cache",
        ".idea",
        ".vscode",
        "site-packages",
    }
)

STATUS_INDEXED = "indexed"
STATUS_PENDING = "pending"
STATUS_FAILED = "failed"


@dataclass(frozen=True, slots=True)
class FileState:
    size: int
    mtime_ns: int


@dataclass(slots=True)
class IndexPlan:
    files: dict[str, FileState]
    to_index: list[str]
    to_remove: list[str]
    truncated: bool = False


@dataclass(slots=True)
class IndexReport:
    indexed: list[str] = field(default_factory=list)
    unchanged_content: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)
    removed: list[str] = field(default_factory=list)
    remaining: list[str] = field(default_factory=list)
    error: str | None = None
    # Enrichment totals of this run.
    visual_pages: int = 0
    visual_failed: int = 0
    contextualized: int = 0

    @property
    def complete(self) -> bool:
        return not self.remaining and self.error is None


ProgressCallback = Callable[[int, int, str | None], None]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def embedding_input(
    path: str, locator: str, heading: str, text: str, context: str = ""
) -> str:
    """Text actually embedded: a short provenance header helps retrieval
    match questions that name a file, sheet or section, and the chunk's
    contextual-retrieval context (when there is one) situates it."""

    label = " · ".join(part for part in (path, locator, heading) if part)
    body = f"{context}\n\n{text}" if context else text
    return f"{label}\n\n{body}" if label else body


class DocumentIndex:
    def __init__(
        self,
        root: str | Path,
        store: DocumentStore,
        *,
        max_documents: int = MAX_DOCUMENTS,
    ) -> None:
        self.root = Path(root)
        self.store = store
        self.max_documents = max_documents

    # -- scanning ---------------------------------------------------------

    def scan(self) -> tuple[dict[str, FileState], bool]:
        """Supported documents under the root, as ``{relative posix path: state}``."""

        files: dict[str, FileState] = {}
        truncated = False
        for directory, subdirectories, names in os.walk(self.root, followlinks=False):
            subdirectories[:] = sorted(
                name
                for name in subdirectories
                if name not in SKIPPED_DIRECTORIES and not name.startswith(".")
            )
            for name in sorted(names):
                if name.startswith(".") or not is_supported(name):
                    continue
                full = Path(directory) / name
                try:
                    if full.is_symlink():
                        continue
                    stat = full.stat()
                except OSError:
                    continue
                limit = (
                    MAX_TEXT_BYTES
                    if full.suffix.lower() in _TEXT_SUFFIXES
                    else MAX_DOCUMENT_BYTES
                )
                if stat.st_size == 0 or stat.st_size > limit:
                    continue
                if len(files) >= self.max_documents:
                    truncated = True
                    break
                relative = full.relative_to(self.root).as_posix()
                files[relative] = FileState(stat.st_size, stat.st_mtime_ns)
            if truncated:
                break
        return files, truncated

    def plan(self, model: str, *, force: bool = False) -> IndexPlan:
        files, truncated = self.scan()
        records = self.store.documents()
        to_index = []
        for path, state in files.items():
            record = records.get(path)
            if force or record is None or record.status == STATUS_PENDING:
                to_index.append(path)
            elif record.status == STATUS_INDEXED and record.model != model:
                to_index.append(path)
            elif (record.size, record.mtime_ns) != (state.size, state.mtime_ns):
                to_index.append(path)
        to_remove = [path for path in records if path not in files]
        return IndexPlan(files, to_index, to_remove, truncated)

    # -- indexing ---------------------------------------------------------

    def index(
        self,
        embedder: Embedder,
        *,
        force: bool = False,
        only: set[str] | None = None,
        deadline: float | None = None,
        progress: ProgressCallback | None = None,
        should_stop: Callable[[], bool] | None = None,
        enrichment: Enrichment | None = None,
    ) -> IndexReport:
        plan = self.plan(embedder.model, force=force)
        report = IndexReport()
        report.removed = plan.to_remove
        self.store.remove_documents(plan.to_remove)
        queue = [path for path in plan.to_index if only is None or path in only]
        records = self.store.documents()
        total = len(queue)
        for position, path in enumerate(queue):
            if (deadline is not None and time.monotonic() >= deadline) or (
                should_stop is not None and should_stop()
            ):
                report.remaining = queue[position:]
                break
            if progress is not None:
                progress(position, total, path)
            try:
                self._index_one(
                    path,
                    plan.files[path],
                    records.get(path),
                    embedder,
                    force,
                    report,
                    enrichment,
                )
            except EmbeddingError as exc:
                # The service, not this file, is the problem: stop and keep the
                # rest pending so a later run picks them up.
                report.error = str(exc)
                report.remaining = queue[position:]
                break
        if progress is not None:
            progress(total - len(report.remaining), total, None)
        return report

    def _index_one(
        self,
        path: str,
        state: FileState,
        previous: DocumentRecord | None,
        embedder: Embedder,
        force: bool,
        report: IndexReport,
        enrichment: Enrichment | None = None,
    ) -> None:
        full = self.root / path
        try:
            digest = _sha256(full)
        except OSError as exc:
            report.failed[path] = f"cannot read file: {exc.strerror or exc}"
            self._record_failure(path, state, "", report.failed[path], embedder.model)
            return
        if (
            not force
            and previous is not None
            and previous.sha256 == digest
            and previous.model == embedder.model
            and previous.status in {STATUS_INDEXED, STATUS_FAILED}
        ):
            self.store.touch_document(path, size=state.size, mtime_ns=state.mtime_ns)
            report.unchanged_content.append(path)
            return
        stats = ExtractStats()
        visual = None
        if enrichment is not None and enrichment.visual is not None:
            reader = enrichment.visual

            def visual(file: Path, pages: list) -> object:  # noqa: ANN001
                return reader.read_pages(file, pages, cache=self.store)

        try:
            sections = extract_document(full, visual=visual, stats=stats)
        except ExtractionError as exc:
            report.failed[path] = str(exc)
            self._record_failure(path, state, digest, str(exc), embedder.model)
            return
        except Exception as exc:  # noqa: BLE001 - a hostile file must not stop the run
            report.failed[path] = f"extraction failed: {type(exc).__name__}"
            self._record_failure(path, state, digest, report.failed[path], embedder.model)
            return
        chunks = chunk_sections(sections)[:MAX_CHUNKS_PER_DOCUMENT]
        if enrichment is not None and enrichment.contextualizer is not None and chunks:
            try:
                contexts = enrichment.contextualizer.contextualize(
                    "\n\n".join(section.text for section in sections),
                    chunks,
                    cache=self.store,
                )
            except Exception:  # noqa: BLE001 - contexts are optional
                logger.exception("contextual retrieval failed for {}", path)
                contexts = []
            if len(contexts) == len(chunks):
                chunks = [
                    replace(chunk, context=context) if context else chunk
                    for chunk, context in zip(chunks, contexts, strict=True)
                ]
        contextualized = sum(1 for chunk in chunks if chunk.context)
        vectors = embedder.embed(
            [
                embedding_input(path, c.locator, c.heading, c.text, c.context)
                for c in chunks
            ]
        )
        if len(vectors) != len(chunks):
            raise EmbeddingError("embedding service returned the wrong number of vectors")
        self.store.replace_document(
            DocumentRecord(
                path=path,
                size=state.size,
                mtime_ns=state.mtime_ns,
                sha256=digest,
                status=STATUS_INDEXED,
                error=None,
                chunk_count=len(chunks),
                model=embedder.model,
                indexed_at=time.time(),
                visual_pages=stats.visual_pages,
                visual_failed=stats.visual_failed,
                contextualized=contextualized,
            ),
            chunks,
            vectors,
        )
        report.indexed.append(path)
        report.visual_pages += stats.visual_pages
        report.visual_failed += stats.visual_failed
        report.contextualized += contextualized

    def _record_failure(
        self, path: str, state: FileState, digest: str, error: str, model: str
    ) -> None:
        self.store.replace_document(
            DocumentRecord(
                path=path,
                size=state.size,
                mtime_ns=state.mtime_ns,
                sha256=digest,
                status=STATUS_FAILED,
                error=error[:500],
                chunk_count=0,
                model=model,
                indexed_at=time.time(),
            )
        )

    # -- reading ----------------------------------------------------------

    def document_statuses(self, model: str) -> tuple[list[dict], bool]:
        """Every on-disk document with its index state, for the UI."""

        files, truncated = self.scan()
        records = self.store.documents()
        documents = []
        for path, state in files.items():
            record = records.get(path)
            if record is None:
                status, error, chunks, indexed_at = STATUS_PENDING, None, 0, None
            else:
                stale = (record.size, record.mtime_ns) != (state.size, state.mtime_ns) or (
                    record.status == STATUS_INDEXED and record.model != model
                )
                status = STATUS_PENDING if stale else record.status
                error = record.error if status == STATUS_FAILED else None
                chunks = record.chunk_count if status == STATUS_INDEXED else 0
                indexed_at = record.indexed_at
            documents.append(
                {
                    "path": path,
                    "status": status,
                    "chunks": chunks,
                    "error": error,
                    "indexedAt": indexed_at,
                }
            )
        return documents, truncated

    def search(
        self,
        embedder: Embedder,
        query: str,
        *,
        k: int = 6,
        paths: list[str] | None = None,
    ) -> list[SearchHit]:
        if self.store.chunk_count() == 0:
            return []
        (vector,) = embedder.embed([query])
        return self.store.search(vector, k=k, paths=paths, query=query)


__all__ = [
    "MAX_DOCUMENTS",
    "STATUS_FAILED",
    "STATUS_INDEXED",
    "STATUS_PENDING",
    "DocumentIndex",
    "FileState",
    "IndexPlan",
    "IndexReport",
    "embedding_input",
]
