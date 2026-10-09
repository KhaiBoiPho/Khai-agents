"""Shared types of the document index.

The index itself is :class:`core.rag.pgstore.PgQdrantStore` (Postgres for
text and metadata, Qdrant for vectors); :class:`DocumentStore` is the
interface :class:`core.rag.index.DocumentIndex` drives.
"""

from __future__ import annotations

import hashlib
import math
import time
from collections.abc import Iterable, Sequence
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


@dataclass(frozen=True, slots=True)
class SearchHit:
    path: str
    locator: str
    heading: str
    text: str
    score: float
    ordinal: int


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
    "DocumentStore",
    "SearchHit",
    "normalize",
    "workspace_key",
]
