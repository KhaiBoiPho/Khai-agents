"""Document index backed by Postgres (text, full-text) and Qdrant (vectors).

Same interface as :class:`core.rag.store.IndexStore`, shared by every
workspace (rows carry a ``workspace`` key):

* Postgres ``rag_documents`` / ``rag_chunks`` hold metadata and chunk text;
  a generated ``tsvector`` (heading weighted above body, ``simple`` config so
  any language tokenizes) with a GIN index serves the full-text half.
* Qdrant holds one cosine collection per embedding size
  (``khai_rag_<dims>``); point ids are derived from (workspace, path,
  ordinal) so re-indexing a file overwrites its points in place.

Search follows RAGFlow: full-text and kNN candidates are merged, then scored
by :func:`core.rag.hybrid.rerank`. Postgres is the source of truth for what
exists: a vector whose chunk row is gone is simply never returned.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Iterable, Sequence

import httpx
import psycopg
from psycopg.rows import dict_row

from core.rag.chunking import Chunk
from core.rag.hybrid import CANDIDATES, Candidate, rerank, tokenize
from core.rag.store import DocumentRecord, SearchHit, normalize

_SCHEMA = """
CREATE TABLE IF NOT EXISTS rag_documents (
    workspace TEXT NOT NULL,
    path TEXT NOT NULL,
    size BIGINT NOT NULL,
    mtime_ns BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    indexed_at DOUBLE PRECISION,
    PRIMARY KEY (workspace, path)
);
CREATE TABLE IF NOT EXISTS rag_chunks (
    workspace TEXT NOT NULL,
    path TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    locator TEXT NOT NULL,
    heading TEXT NOT NULL,
    text TEXT NOT NULL,
    dims INTEGER NOT NULL,
    point_id UUID NOT NULL,
    tsv TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(heading, '')), 'A')
        || to_tsvector('simple', text)
    ) STORED,
    PRIMARY KEY (workspace, path, ordinal),
    FOREIGN KEY (workspace, path) REFERENCES rag_documents ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rag_chunks_tsv ON rag_chunks USING GIN (tsv);
CREATE UNIQUE INDEX IF NOT EXISTS rag_chunks_point ON rag_chunks (point_id);
"""

_NAMESPACE = uuid.UUID("6f1b0c2e-3d4a-4b8e-9a51-7c2d9e0f4a10")
_DOCUMENT_COLUMNS = (
    "path, size, mtime_ns, sha256, status, error, chunk_count, model, indexed_at"
)


def point_id(workspace: str, path: str, ordinal: int) -> str:
    return str(uuid.uuid5(_NAMESPACE, f"{workspace}\0{path}\0{ordinal}"))


def _ancestors(path: str) -> list[str]:
    parts = path.split("/")[:-1]
    return ["/".join(parts[: index + 1]) for index in range(len(parts))]


def _selectors(paths: Sequence[str] | None) -> list[str] | None:
    """Cleaned path selectors, or None when they select everything."""
    if not paths:
        return None
    cleaned = []
    for selector in paths:
        clean = selector.strip().strip("/")
        if not clean or clean == ".":
            return None
        cleaned.append(clean)
    return cleaned


class QdrantClient:
    """The few Qdrant REST calls the index needs."""

    def __init__(self, url: str, *, timeout: float = 30.0) -> None:
        self._http = httpx.Client(base_url=url.rstrip("/"), timeout=timeout)
        self._known: set[str] = set()

    def close(self) -> None:
        self._http.close()

    def ready(self) -> bool:
        try:
            return self._http.get("/readyz", timeout=3).status_code == 200
        except httpx.HTTPError:
            return False

    def has_collection(self, name: str) -> bool:
        if name in self._known:
            return True
        response = self._http.get(f"/collections/{name}/exists")
        response.raise_for_status()
        exists = bool(response.json()["result"]["exists"])
        if exists:
            self._known.add(name)
        return exists

    def ensure_collection(self, name: str, dims: int) -> None:
        if self.has_collection(name):
            return
        response = self._http.put(
            f"/collections/{name}",
            json={"vectors": {"size": dims, "distance": "Cosine"}},
        )
        if response.status_code not in (200, 409):
            response.raise_for_status()
        for field in ("workspace", "path", "dirs"):
            self._http.put(
                f"/collections/{name}/index",
                params={"wait": "true"},
                json={"field_name": field, "field_schema": "keyword"},
            )
        self._known.add(name)

    def upsert(self, name: str, points: list[dict]) -> None:
        for start in range(0, len(points), 256):
            response = self._http.put(
                f"/collections/{name}/points",
                params={"wait": "true"},
                json={"points": points[start : start + 256]},
            )
            response.raise_for_status()

    def delete(self, name: str, must: list[dict]) -> None:
        response = self._http.post(
            f"/collections/{name}/points/delete",
            params={"wait": "true"},
            json={"filter": {"must": must}},
        )
        if response.status_code != 404:
            response.raise_for_status()

    def collections(self) -> list[str]:
        response = self._http.get("/collections")
        response.raise_for_status()
        return [entry["name"] for entry in response.json()["result"]["collections"]]

    def search(
        self, name: str, vector: Sequence[float], limit: int, query_filter: dict
    ) -> list[tuple[str, float]]:
        response = self._http.post(
            f"/collections/{name}/points/search",
            json={
                "vector": list(vector),
                "limit": limit,
                "filter": query_filter,
                "with_payload": False,
            },
        )
        response.raise_for_status()
        return [(str(hit["id"]), float(hit["score"])) for hit in response.json()["result"]]

    def vectors(self, name: str, ids: list[str]) -> dict[str, list[float]]:
        if not ids:
            return {}
        response = self._http.post(
            f"/collections/{name}/points",
            json={"ids": ids, "with_vector": True, "with_payload": False},
        )
        response.raise_for_status()
        return {str(point["id"]): point["vector"] for point in response.json()["result"]}


class PgQdrantStore:
    """One workspace's view of the shared Postgres + Qdrant index."""

    def __init__(self, workspace: str, *, dsn: str, qdrant_url: str) -> None:
        self.workspace = workspace
        self._dsn = dsn
        self._lock = threading.RLock()
        self._connection = self._connect()
        self.qdrant = QdrantClient(qdrant_url)
        if not self.qdrant.ready():
            self._connection.close()
            raise ConnectionError(f"Qdrant is not ready at {qdrant_url}")

    def _connect(self) -> psycopg.Connection:
        connection = psycopg.connect(
            self._dsn, autocommit=True, row_factory=dict_row, connect_timeout=5
        )
        with connection.transaction():
            # Serialize schema creation across stores opening at once.
            connection.execute("SELECT pg_advisory_xact_lock(724110)")
            connection.execute(_SCHEMA)
        return connection

    def _db(self) -> psycopg.Connection:
        if self._connection.closed or self._connection.broken:
            self._connection = self._connect()
        return self._connection

    def close(self) -> None:
        with self._lock:
            self._connection.close()
            self.qdrant.close()

    # -- documents --------------------------------------------------------

    def documents(self) -> dict[str, DocumentRecord]:
        with self._lock:
            rows = self._db().execute(
                f"SELECT {_DOCUMENT_COLUMNS} FROM rag_documents WHERE workspace = %s",
                (self.workspace,),
            ).fetchall()
        return {row["path"]: DocumentRecord(**row) for row in rows}

    def replace_document(
        self,
        record: DocumentRecord,
        chunks: Sequence[Chunk] = (),
        vectors: Sequence[Sequence[float]] = (),
    ) -> None:
        """Swap a document's metadata and chunks (vectors first, then rows)."""

        if len(chunks) != len(vectors):
            raise ValueError("one vector is required per chunk")
        normalized = [normalize(vector) for vector in vectors]
        ids = [point_id(self.workspace, record.path, chunk.ordinal) for chunk in chunks]
        with self._lock:
            by_dims: dict[int, list[dict]] = {}
            dirs = _ancestors(record.path)
            for chunk, vector, pid in zip(chunks, normalized, ids, strict=True):
                by_dims.setdefault(len(vector), []).append(
                    {
                        "id": pid,
                        "vector": vector,
                        "payload": {
                            "workspace": self.workspace,
                            "path": record.path,
                            "dirs": dirs,
                            "ordinal": chunk.ordinal,
                        },
                    }
                )
            for dims, points in by_dims.items():
                name = f"khai_rag_{dims}"
                self.qdrant.ensure_collection(name, dims)
                self.qdrant.upsert(name, points)
            connection = self._db()
            with connection.transaction():
                connection.execute(
                    "DELETE FROM rag_chunks WHERE workspace = %s AND path = %s",
                    (self.workspace, record.path),
                )
                connection.execute(
                    f"""
                    INSERT INTO rag_documents(workspace, {_DOCUMENT_COLUMNS})
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (workspace, path) DO UPDATE SET
                        size = excluded.size, mtime_ns = excluded.mtime_ns,
                        sha256 = excluded.sha256, status = excluded.status,
                        error = excluded.error, chunk_count = excluded.chunk_count,
                        model = excluded.model, indexed_at = excluded.indexed_at
                    """,
                    (
                        self.workspace,
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
                if chunks:
                    with connection.cursor() as cursor:
                        cursor.executemany(
                            """
                            INSERT INTO rag_chunks(workspace, path, ordinal, locator,
                                                   heading, text, dims, point_id)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            [
                                (
                                    self.workspace,
                                    record.path,
                                    chunk.ordinal,
                                    chunk.locator,
                                    chunk.heading,
                                    chunk.text.replace("\x00", ""),
                                    len(vector),
                                    pid,
                                )
                                for chunk, vector, pid in zip(
                                    chunks, normalized, ids, strict=True
                                )
                            ],
                        )
            # Points beyond the new chunk count belonged to the old version.
            self._delete_points(record.path, from_ordinal=len(chunks))

    def _delete_points(self, path: str, *, from_ordinal: int = 0) -> None:
        must: list[dict] = [
            {"key": "workspace", "match": {"value": self.workspace}},
            {"key": "path", "match": {"value": path}},
        ]
        if from_ordinal:
            must.append({"key": "ordinal", "range": {"gte": from_ordinal}})
        for name in self.qdrant.collections():
            if name.startswith("khai_rag_"):
                self.qdrant.delete(name, must)

    def touch_document(self, path: str, *, size: int, mtime_ns: int) -> None:
        with self._lock:
            self._db().execute(
                "UPDATE rag_documents SET size = %s, mtime_ns = %s"
                " WHERE workspace = %s AND path = %s",
                (size, mtime_ns, self.workspace, path),
            )

    def remove_documents(self, paths: Iterable[str]) -> int:
        paths = list(paths)
        if not paths:
            return 0
        with self._lock:
            self._db().execute(
                "DELETE FROM rag_documents WHERE workspace = %s AND path = ANY(%s)",
                (self.workspace, paths),
            )
            for path in paths:
                self._delete_points(path)
        return len(paths)

    def chunk_count(self) -> int:
        with self._lock:
            row = self._db().execute(
                "SELECT COUNT(*) AS n FROM rag_chunks WHERE workspace = %s",
                (self.workspace,),
            ).fetchone()
        return int(row["n"])

    # -- search -----------------------------------------------------------

    def search(
        self,
        query_vector: Sequence[float],
        *,
        k: int = 6,
        paths: Sequence[str] | None = None,
        query: str | None = None,
    ) -> list[SearchHit]:
        vector = normalize(query_vector)
        selectors = _selectors(paths)
        collection = f"khai_rag_{len(vector)}"
        with self._lock:
            has_vectors = self.qdrant.has_collection(collection)
            cosines: dict[str, float] = {}
            if has_vectors:
                must: list[dict] = [
                    {"key": "workspace", "match": {"value": self.workspace}}
                ]
                if selectors:
                    must.append(
                        {
                            "should": [
                                {"key": "path", "match": {"any": selectors}},
                                {"key": "dirs", "match": {"any": selectors}},
                            ]
                        }
                    )
                cosines = dict(
                    self.qdrant.search(collection, vector, CANDIDATES, {"must": must})
                )

            keyword_ids: list[str] = []
            terms = list(dict.fromkeys(tokenize(query or "")))
            if terms:
                tsquery = " | ".join(f"'{term}'" for term in terms)
                rows = self._db().execute(
                    """
                    SELECT point_id::text AS id
                    FROM rag_chunks, to_tsquery('simple', %s) AS q
                    WHERE workspace = %s AND dims = %s AND tsv @@ q
                      AND (%s::text[] IS NULL OR EXISTS (
                          SELECT 1 FROM unnest(%s::text[]) AS s
                          WHERE path = s OR starts_with(path, s || '/')))
                    ORDER BY ts_rank_cd(tsv, q) DESC
                    LIMIT %s
                    """,
                    (tsquery, self.workspace, len(vector), selectors, selectors, CANDIDATES),
                ).fetchall()
                keyword_ids = [row["id"] for row in rows]

            missing = [pid for pid in keyword_ids if pid not in cosines]
            if missing and has_vectors:
                for pid, stored in self.qdrant.vectors(collection, missing).items():
                    cosines[pid] = sum(a * b for a, b in zip(stored, vector))

            ids = list(dict.fromkeys([*cosines, *keyword_ids]))
            if not ids:
                return []
            rows = self._db().execute(
                """
                SELECT point_id::text AS id, path, ordinal, locator, heading, text
                FROM rag_chunks WHERE workspace = %s AND point_id = ANY(%s::uuid[])
                """,
                (self.workspace, ids),
            ).fetchall()

        candidates = [
            Candidate(
                key=row["id"],
                path=row["path"],
                ordinal=row["ordinal"],
                locator=row["locator"],
                heading=row["heading"],
                text=row["text"],
                cosine=cosines.get(row["id"], 0.0),
            )
            for row in rows
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


__all__ = ["PgQdrantStore", "QdrantClient", "point_id"]
