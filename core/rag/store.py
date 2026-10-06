"""SQLite sidecar holding one workspace's document index.

Each workspace gets its own small database (``<DEEPCODE_HOME>/rag/<key>/``),
so indexing never contends with the application database and deleting a
workspace's index is deleting one folder. Vectors are stored L2-normalised
as float32 blobs; search is a brute-force cosine scan, which at the scale of
a workspace (thousands of chunks) takes milliseconds with numpy and well
under a second without it.
"""

from __future__ import annotations

import hashlib
import math
import sqlite3
import threading
import time
from array import array
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

from core.rag.chunking import Chunk
from core.rag.hybrid import CANDIDATES, Candidate, keyword_overlap, rerank, tokenize

try:  # numpy is optional: it only makes the cosine scan faster.
    import numpy as _np
except ImportError:  # pragma: no cover - exercised when numpy is absent
    _np = None

SCHEMA_VERSION = 1

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
    path TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    mtime_ns INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    indexed_at REAL
);
CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL REFERENCES documents(path) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    locator TEXT NOT NULL DEFAULT '',
    heading TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    dims INTEGER NOT NULL,
    embedding BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_by_path ON chunks(path, ordinal);
"""


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


class IndexStore:
    """Thread-safe access to one workspace's index database."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(
            self.path, check_same_thread=False, isolation_level=None, timeout=30
        )
        self._connection.row_factory = sqlite3.Row
        with self._lock:
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute("PRAGMA foreign_keys=ON")
            self._connection.executescript(_SCHEMA)
            self._connection.execute(
                "INSERT OR IGNORE INTO meta(key, value) VALUES ('schema', ?)",
                (str(SCHEMA_VERSION),),
            )
        self._matrix_generation: tuple[int, int] | None = None
        self._matrix: object | None = None
        self._rows: list[tuple[str, int, str, str, str]] = []
        self._generation = 0
        self._terms: list[set[str]] = []
        self._terms_generation: tuple[int, int] | None = None

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    # -- documents --------------------------------------------------------

    def documents(self) -> dict[str, DocumentRecord]:
        with self._lock:
            rows = self._connection.execute("SELECT * FROM documents").fetchall()
        return {row["path"]: DocumentRecord(**dict(row)) for row in rows}

    def replace_document(
        self,
        record: DocumentRecord,
        chunks: Sequence[Chunk] = (),
        vectors: Sequence[Sequence[float]] = (),
    ) -> None:
        """Atomically swap a document's metadata and chunks."""

        if len(chunks) != len(vectors):
            raise ValueError("one vector is required per chunk")
        with self._lock:
            connection = self._connection
            connection.execute("BEGIN IMMEDIATE")
            try:
                connection.execute("DELETE FROM chunks WHERE path = ?", (record.path,))
                connection.execute(
                    """
                    INSERT INTO documents(path, size, mtime_ns, sha256, status, error,
                                          chunk_count, model, indexed_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(path) DO UPDATE SET
                        size = excluded.size, mtime_ns = excluded.mtime_ns,
                        sha256 = excluded.sha256, status = excluded.status,
                        error = excluded.error, chunk_count = excluded.chunk_count,
                        model = excluded.model, indexed_at = excluded.indexed_at
                    """,
                    (
                        record.path,
                        record.size,
                        record.mtime_ns,
                        record.sha256,
                        record.status,
                        record.error,
                        record.chunk_count,
                        record.model,
                        record.indexed_at,
                    ),
                )
                connection.executemany(
                    """
                    INSERT INTO chunks(path, ordinal, locator, heading, text, dims, embedding)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            record.path,
                            chunk.ordinal,
                            chunk.locator,
                            chunk.heading,
                            chunk.text,
                            len(vector),
                            array("f", normalize(vector)).tobytes(),
                        )
                        for chunk, vector in zip(chunks, vectors, strict=True)
                    ],
                )
                connection.execute("COMMIT")
            except BaseException:
                connection.execute("ROLLBACK")
                raise
            self._generation += 1

    def touch_document(self, path: str, *, size: int, mtime_ns: int) -> None:
        """Record new stat data for a file whose content hash is unchanged."""

        with self._lock:
            self._connection.execute(
                "UPDATE documents SET size = ?, mtime_ns = ? WHERE path = ?",
                (size, mtime_ns, path),
            )

    def remove_documents(self, paths: Iterable[str]) -> int:
        paths = list(paths)
        if not paths:
            return 0
        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                for path in paths:
                    self._connection.execute("DELETE FROM chunks WHERE path = ?", (path,))
                    self._connection.execute("DELETE FROM documents WHERE path = ?", (path,))
                self._connection.execute("COMMIT")
            except BaseException:
                self._connection.execute("ROLLBACK")
                raise
            self._generation += 1
        return len(paths)

    def chunk_count(self) -> int:
        with self._lock:
            return int(self._connection.execute("SELECT COUNT(*) FROM chunks").fetchone()[0])

    # -- search -----------------------------------------------------------

    def _load(self) -> None:
        # ``data_version`` changes when another connection commits, so a
        # second store over the same file never serves a stale matrix.
        version = (
            self._generation,
            int(self._connection.execute("PRAGMA data_version").fetchone()[0]),
        )
        if self._matrix_generation == version:
            return
        rows = self._connection.execute(
            "SELECT path, ordinal, locator, heading, text, dims, embedding FROM chunks"
        ).fetchall()
        self._rows = [
            (row["path"], row["ordinal"], row["locator"], row["heading"], row["text"])
            for row in rows
        ]
        vectors = [array("f", row["embedding"]) for row in rows]
        if _np is not None and vectors:
            dims = {len(vector) for vector in vectors}
            if len(dims) == 1:
                self._matrix = _np.vstack(
                    [_np.frombuffer(vector.tobytes(), dtype=_np.float32) for vector in vectors]
                )
            else:
                self._matrix = vectors
        else:
            self._matrix = vectors
        self._matrix_generation = version

    def search(
        self,
        query_vector: Sequence[float],
        *,
        k: int = 6,
        paths: Sequence[str] | None = None,
        query: str | None = None,
    ) -> list[SearchHit]:
        text_query = query
        query = normalize(query_vector)
        with self._lock:
            self._load()
            rows = self._rows
            matrix = self._matrix
            if not rows:
                return []
            if _np is not None and not isinstance(matrix, list):
                if matrix.shape[1] != len(query):  # type: ignore[union-attr]
                    return []  # vectors from another embedding model
                scores = matrix @ _np.asarray(query, dtype=_np.float32)
                scored = [float(value) for value in scores]
            else:
                scored = [
                    sum(a * b for a, b in zip(vector, query))
                    if len(vector) == len(query)
                    else -1.0
                    for vector in matrix  # type: ignore[union-attr]
                ]
        selected = [
            index for index, row in enumerate(rows) if _path_selected(row[0], paths)
        ]
        # RAGFlow-style candidates: the best vector matches plus the chunks
        # sharing the most query words, re-scored by the hybrid formula.
        by_vector = sorted(selected, key=lambda index: scored[index], reverse=True)
        pool = dict.fromkeys(by_vector[:CANDIDATES])
        terms = list(dict.fromkeys(tokenize(text_query or "")))
        if terms:
            with self._lock:
                term_sets = self._term_sets()
            overlaps = [
                (keyword_overlap(terms, term_sets[index]), index) for index in selected
            ]
            overlaps = [entry for entry in overlaps if entry[0] > 0]
            overlaps.sort(reverse=True)
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
            for candidate in rerank(text_query, candidates, k)
        ]

    def _term_sets(self) -> list[set[str]]:
        if self._terms_generation != self._matrix_generation:
            self._terms = [
                set(tokenize(text)) | set(tokenize(heading))
                for _path, _ordinal, _locator, heading, text in self._rows
            ]
            self._terms_generation = self._matrix_generation
        return self._terms


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
    "IndexStore",
    "SearchHit",
    "normalize",
    "workspace_key",
]
