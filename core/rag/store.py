"""Shared types of the document index.

The index itself is :class:`core.rag.pgstore.PgQdrantStore` (Postgres for
text and metadata, Qdrant for vectors); :class:`DocumentStore` is the
interface :class:`core.rag.index.DocumentIndex` drives.
"""

from __future__ import annotations

import hashlib
import math
import time
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from core.rag.chunking import Chunk


@dataclass(frozen=True, slots=True)
class DocumentRecord:
    path: str
    size: int
    mtime_ns: int
    sha256: str
    status: str
    error: str | None
    chunk_count: int
    model: str | None
    indexed_at: float | None
    # Index-time enrichment: PDF pages read by the vision model, pages it
    # failed on, and chunks that carry a contextual-retrieval context.
    visual_pages: int = 0
    visual_failed: int = 0
    contextualized: int = 0


@dataclass(frozen=True, slots=True)
class SearchHit:
    path: str
    locator: str
    heading: str
    text: str
    score: float
    ordinal: int
    # The passage was transcribed from a PDF page image (figure or scan).
    visual: bool = False


def workspace_key(root: str | Path) -> str:
    return hashlib.sha256(str(Path(root)).encode("utf-8")).hexdigest()[:24]


def normalize(vector: Sequence[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    return [value / norm for value in vector] if norm else list(vector)


class DocumentStore(Protocol):
    """One workspace's document index (see :class:`core.rag.pgstore.PgQdrantStore`)."""

    def close(self) -> None: ...

    def documents(self) -> dict[str, DocumentRecord]: ...

    def replace_document(
        self,
        record: DocumentRecord,
        chunks: Sequence[Chunk] = (),
        vectors: Sequence[Sequence[float]] = (),
    ) -> None: ...

    def touch_document(self, path: str, *, size: int, mtime_ns: int) -> None: ...

    def remove_documents(self, paths: Iterable[str]) -> int: ...

    def chunk_count(self) -> int: ...

    def search(
        self,
        query_vector: Sequence[float],
        *,
        k: int = 6,
        paths: Sequence[str] | None = None,
        query: str | None = None,
    ) -> list[SearchHit]: ...


class EnrichmentCache(Protocol):
    """Optional store capability: remembered enrichment answers.

    ``kind`` separates the namespaces (``context``, ``visual``); keys are
    content hashes that already include the model and prompt version."""

    def cached_values(self, kind: str, keys: Sequence[str]) -> dict[str, str]: ...

    def cache_values(self, kind: str, model: str, values: Mapping[str, str]) -> None: ...


def read_cache(store: object, kind: str, keys: Sequence[str]) -> dict[str, str]:
    """Cached values, or nothing when the store has no cache or it fails."""

    method = getattr(store, "cached_values", None)
    if method is None or not keys:
        return {}
    try:
        return dict(method(kind, list(dict.fromkeys(keys))))
    except Exception as exc:  # noqa: BLE001 - a cache miss is never fatal
        from core.rag.llm import log_once

        log_once("RAG enrichment cache read failed: {}", type(exc).__name__)
        return {}


def write_cache(store: object, kind: str, model: str, values: Mapping[str, str]) -> None:
    method = getattr(store, "cache_values", None)
    if method is None or not values:
        return
    try:
        method(kind, model, dict(values))
    except Exception as exc:  # noqa: BLE001
        from core.rag.llm import log_once

        log_once("RAG enrichment cache write failed: {}", type(exc).__name__)


def _path_selected(path: str, selectors: Sequence[str] | None) -> bool:
    if not selectors:
        return True
    for selector in selectors:
        clean = selector.strip().strip("/")
        if not clean or clean == ".":
            return True
        if path == clean or path.startswith(clean + "/"):
            return True
    return False


def now() -> float:
    return time.time()


__all__ = [
    "DocumentRecord",
    "EnrichmentCache",
    "read_cache",
    "write_cache",
    "DocumentStore",
    "SearchHit",
    "normalize",
    "workspace_key",
]
