"""In-memory :class:`core.rag.store.DocumentStore` for tests.

Implements the same contract as the Postgres + Qdrant store (atomic document
swap, path selectors, hybrid vector + keyword candidates re-scored by
:func:`core.rag.hybrid.rerank`) so ``DocumentIndex`` logic is tested without
the services.
"""

from __future__ import annotations

import threading
from collections.abc import Iterable, Sequence

from core.rag.chunking import Chunk
from core.rag.hybrid import CANDIDATES, Candidate, keyword_overlap, rerank, tokenize
from core.rag.store import DocumentRecord, SearchHit, _path_selected, normalize


class MemoryStore:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._documents: dict[str, DocumentRecord] = {}
        # path -> [(ordinal, locator, heading, text, vector)]
        self._chunks: dict[str, list[tuple[int, str, str, str, list[float]]]] = {}
        self.closed = False

    def close(self) -> None:
        self.closed = True

    def documents(self) -> dict[str, DocumentRecord]:
        with self._lock:
            return dict(self._documents)

    def replace_document(
        self,
        record: DocumentRecord,
        chunks: Sequence[Chunk] = (),
        vectors: Sequence[Sequence[float]] = (),
    ) -> None:
        if len(chunks) != len(vectors):
            raise ValueError("one vector is required per chunk")
        rows = [
            (chunk.ordinal, chunk.locator, chunk.heading, chunk.text, normalize(vector))
            for chunk, vector in zip(chunks, vectors, strict=True)
        ]
        with self._lock:
            self._documents[record.path] = record
            self._chunks[record.path] = rows

    def touch_document(self, path: str, *, size: int, mtime_ns: int) -> None:
        with self._lock:
            record = self._documents.get(path)
            if record is not None:
                fields = {name: getattr(record, name) for name in record.__slots__}
                self._documents[path] = DocumentRecord(
                    **{**fields, "size": size, "mtime_ns": mtime_ns}
                )

    def remove_documents(self, paths: Iterable[str]) -> int:
        paths = list(paths)
        with self._lock:
            for path in paths:
                self._documents.pop(path, None)
                self._chunks.pop(path, None)
        return len(paths)

    def chunk_count(self) -> int:
        with self._lock:
            return sum(len(rows) for rows in self._chunks.values())

    def search(
        self,
        query_vector: Sequence[float],
        *,
        k: int = 6,
        paths: Sequence[str] | None = None,
        query: str | None = None,
    ) -> list[SearchHit]:
        vector = normalize(query_vector)
        with self._lock:
            rows = [
                (path, *row)
                for path, chunks in self._chunks.items()
                if _path_selected(path, paths)
                for row in chunks
            ]
        scored = [
            sum(a * b for a, b in zip(row[5], vector)) if len(row[5]) == len(vector) else -1.0
            for row in rows
        ]
        by_vector = sorted(range(len(rows)), key=lambda index: scored[index], reverse=True)
        pool = dict.fromkeys(by_vector[:CANDIDATES])
        terms = list(dict.fromkeys(tokenize(query or "")))
        if terms:
            overlaps = [
                (keyword_overlap(terms, set(tokenize(row[4])) | set(tokenize(row[3]))), index)
                for index, row in enumerate(rows)
            ]
            overlaps = sorted((entry for entry in overlaps if entry[0] > 0), reverse=True)
            pool.update(dict.fromkeys(index for _, index in overlaps[:CANDIDATES]))
        candidates = [
            Candidate(
                key=index,
                path=rows[index][0],
                ordinal=rows[index][1],
                locator=rows[index][2],
                heading=rows[index][3],
                text=rows[index][4],
                cosine=max(0.0, scored[index]),
            )
            for index in pool
            if scored[index] > -1.0
        ]
        return [
            SearchHit(
                path=candidate.path,
                locator=candidate.locator,
                heading=candidate.heading,
                text=candidate.text,
                score=round(candidate.score, 4),
                ordinal=candidate.ordinal,
            )
            for candidate in rerank(query, candidates, k)
        ]
