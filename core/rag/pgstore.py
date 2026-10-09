"""Document index backed by Postgres (text, full-text) and Qdrant (vectors).

One store is one user's view of one workspace. The Postgres rows live in the
application database (core/persistence/schema/0002_rag.sql) under row-level
security, so the store only ever sees its own user's rows; the Qdrant points
carry the same ``user_id`` and every Qdrant filter requires it.

* Postgres ``rag_documents`` / ``rag_chunks`` hold metadata and chunk text;
  a generated ``tsvector`` (heading weighted above body, ``simple`` config so
  any language tokenizes) with a GIN index serves the full-text half.
* Qdrant holds one cosine collection per embedding size
  (``<prefix><dims>``, prefix ``khai_rag_`` or, in the hosted deployment,
  ``khai_rag_<user hex>_`` from ``KHAI_QDRANT_COLLECTION_PREFIX``, whose token
  opens only those collections); point ids are derived from (user, workspace,
  path, ordinal) so re-indexing a file overwrites its points in place.

Search follows RAGFlow: full-text and kNN candidates are merged, then scored
by :func:`core.rag.hybrid.rerank`. Postgres is the source of truth for what
exists: a vector whose chunk row is gone is simply never returned.
"""

from __future__ import annotations

import os
import threading
import uuid
from collections.abc import Iterable, Sequence

import httpx

from core.persistence.database import Database

from core.rag.chunking import Chunk
from core.rag.hybrid import CANDIDATES, Candidate, rerank, tokenize
from core.rag.store import DocumentRecord, SearchHit, normalize

def collection_prefix() -> str:
    return os.environ.get("KHAI_QDRANT_COLLECTION_PREFIX", "").strip() or "khai_rag_"


_NAMESPACE = uuid.UUID("6f1b0c2e-3d4a-4b8e-9a51-7c2d9e0f4a10")
_DOCUMENT_COLUMNS = (
    "path, size, mtime_ns, sha256, status, error, chunk_count, model, indexed_at"
)


def point_id(user_id: str, workspace: str, path: str, ordinal: int) -> str:
    return str(uuid.uuid5(_NAMESPACE, f"{user_id}\0{workspace}\0{path}\0{ordinal}"))


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

    def __init__(
        self, url: str, *, api_key: str | None = None, timeout: float = 30.0
    ) -> None:
        self._http = httpx.Client(
            base_url=url.rstrip("/"),
            timeout=timeout,
            headers={"api-key": api_key} if api_key else None,
        )
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
        if response.status_code in (401, 403):
            raise PermissionError(
                f"No document index for {dims}-dimension embeddings is provisioned "
                f"for this account; set KHAI_RAG_EMBEDDING_DIMS on the server to {dims}."
            )
        if response.status_code not in (200, 409):
            response.raise_for_status()
        for field in ("user_id", "workspace", "path", "dirs"):
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
    """One user's view of one workspace in the shared Postgres + Qdrant index."""

    def __init__(
        self,
        workspace: str,
        *,
        database: Database,
        qdrant_url: str,
        qdrant_api_key: str | None = None,
    ) -> None:
        self.workspace = workspace
        self.prefix = collection_prefix()
        self.database = database
        self.user_id = database.user_id
        self._lock = threading.RLock()
        self.qdrant = QdrantClient(qdrant_url, api_key=qdrant_api_key)
        if not self.qdrant.ready():
            self.qdrant.close()
            raise ConnectionError(f"Qdrant is not ready at {qdrant_url}")

    def close(self) -> None:
        with self._lock:
            self.qdrant.close()

    def _scope(self) -> list[dict]:
        """The Qdrant conditions every query and delete starts from."""
        return [
            {"key": "user_id", "match": {"value": self.user_id}},
            {"key": "workspace", "match": {"value": self.workspace}},
        ]

    # -- documents --------------------------------------------------------

    def documents(self) -> dict[str, DocumentRecord]:
        with self.database.read() as connection:
            rows = connection.execute(
                f"SELECT {_DOCUMENT_COLUMNS} FROM rag_documents WHERE workspace = ?",
                (self.workspace,),
            ).fetchall()
        return {
            row["path"]: DocumentRecord(**{key: row[key] for key in row.keys()})
            for row in rows
        }

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
        ids = [
            point_id(self.user_id, self.workspace, record.path, chunk.ordinal)
            for chunk in chunks
        ]
        with self._lock:
            by_dims: dict[int, list[dict]] = {}
            dirs = _ancestors(record.path)
            for chunk, vector, pid in zip(chunks, normalized, ids, strict=True):
                by_dims.setdefault(len(vector), []).append(
                    {
                        "id": pid,
                        "vector": vector,
                        "payload": {
                            "user_id": self.user_id,
                            "workspace": self.workspace,
                            "path": record.path,
                            "dirs": dirs,
                            "ordinal": chunk.ordinal,
                        },
                    }
                )
            for dims, points in by_dims.items():
                name = f"{self.prefix}{dims}"
                self.qdrant.ensure_collection(name, dims)
                self.qdrant.upsert(name, points)
            with self.database.transaction() as connection:
                connection.execute(
                    "DELETE FROM rag_chunks WHERE workspace = ? AND path = ?",
                    (self.workspace, record.path),
                )
                connection.execute(
                    f"""
                    INSERT INTO rag_documents(workspace, {_DOCUMENT_COLUMNS})
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (user_id, workspace, path) DO UPDATE SET
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
                    connection.executemany(
                        """
                        INSERT INTO rag_chunks(workspace, path, ordinal, locator,
                                               heading, text, dims, point_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
        must: list[dict] = [*self._scope(), {"key": "path", "match": {"value": path}}]
        if from_ordinal:
            must.append({"key": "ordinal", "range": {"gte": from_ordinal}})
        for name in self._collections():
            self.qdrant.delete(name, must)

    def _collections(self) -> list[str]:
        """This store's collections. A hosted worker's token may not list
        collections; it then uses the sizes its own chunks were stored at."""

        try:
            return [name for name in self.qdrant.collections() if name.startswith(self.prefix)]
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code not in (401, 403):
                raise
        with self.database.read() as connection:
            dims = {row[0] for row in connection.execute("SELECT DISTINCT dims FROM rag_chunks")}
        dims.add(int(os.environ.get("KHAI_RAG_EMBEDDING_DIMS", "1024")))
        return [f"{self.prefix}{size}" for size in sorted(dims)]

    def touch_document(self, path: str, *, size: int, mtime_ns: int) -> None:
        with self.database.transaction() as connection:
            connection.execute(
                "UPDATE rag_documents SET size = ?, mtime_ns = ?"
                " WHERE workspace = ? AND path = ?",
                (size, mtime_ns, self.workspace, path),
            )

    def remove_documents(self, paths: Iterable[str]) -> int:
        paths = list(paths)
        if not paths:
            return 0
        with self._lock:
            with self.database.transaction() as connection:
                connection.execute(
                    "DELETE FROM rag_documents WHERE workspace = ? AND path = ANY(?)",
                    (self.workspace, paths),
                )
            for path in paths:
                self._delete_points(path)
        return len(paths)

    def chunk_count(self) -> int:
        with self.database.read() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS n FROM rag_chunks WHERE workspace = ?",
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
        collection = f"{self.prefix}{len(vector)}"
        with self._lock:
            has_vectors = self.qdrant.has_collection(collection)
            cosines: dict[str, float] = {}
            if has_vectors:
                must: list[dict] = self._scope()
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
                with self.database.read() as connection:
                    rows = connection.execute(
                        """
                        SELECT point_id::text AS id
                        FROM rag_chunks, to_tsquery('simple', ?) AS q
                        WHERE workspace = ? AND dims = ? AND tsv @@ q
                          AND (?::text[] IS NULL OR EXISTS (
                              SELECT 1 FROM unnest(?::text[]) AS s
                              WHERE path = s OR starts_with(path, s || '/')))
                        ORDER BY ts_rank_cd(tsv, q) DESC
                        LIMIT ?
                        """,
                        (
                            tsquery,
                            self.workspace,
                            len(vector),
                            selectors,
                            selectors,
                            CANDIDATES,
                        ),
                    ).fetchall()
                keyword_ids = [row["id"] for row in rows]

            missing = [pid for pid in keyword_ids if pid not in cosines]
            if missing and has_vectors:
                for pid, stored in self.qdrant.vectors(collection, missing).items():
                    cosines[pid] = sum(a * b for a, b in zip(stored, vector))

            ids = list(dict.fromkeys([*cosines, *keyword_ids]))
            if not ids:
                return []
            with self.database.read() as connection:
                rows = connection.execute(
                    """
                    SELECT point_id::text AS id, path, ordinal, locator, heading, text
                    FROM rag_chunks WHERE workspace = ? AND point_id = ANY(?::uuid[])
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
