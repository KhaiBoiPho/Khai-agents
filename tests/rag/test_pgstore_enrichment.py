"""The Postgres side of enrichment (migration 0006): chunk contexts are
keyword-searchable but never shown, visual flags and per-document counters
round-trip, and the enrichment cache is per user. Qdrant is faked."""

from __future__ import annotations

from pathlib import Path

import pytest

from core.persistence import Database
from core.rag.chunking import Chunk
from core.rag.store import DocumentRecord


class FakeQdrant:
    def __init__(self, url: str, *, api_key: str | None = None, timeout: float = 30.0) -> None:
        self.points: dict[str, dict[str, dict]] = {}

    def ready(self) -> bool:
        return True

    def close(self) -> None:
        pass

    def has_collection(self, name: str) -> bool:
        return name in self.points

    def ensure_collection(self, name: str, dims: int) -> None:
        self.points.setdefault(name, {})

    def upsert(self, name: str, points: list[dict]) -> None:
        for point in points:
            self.points[name][point["id"]] = point

    def delete(self, name: str, must: list[dict]) -> None:
        pass

    def collections(self) -> list[str]:
        return list(self.points)

    def search(self, name, vector, limit, query_filter):
        scored = [
            (pid, sum(a * b for a, b in zip(point["vector"], vector)))
            for pid, point in self.points.get(name, {}).items()
        ]
        return sorted(scored, key=lambda item: item[1], reverse=True)[:limit]

    def vectors(self, name, ids):
        return {pid: self.points[name][pid]["vector"] for pid in ids if pid in self.points[name]}


def _user(database: Database, username: str) -> str:
    with database.system().transaction() as connection:
        row = connection.execute(
            "INSERT INTO users (username, display_name, password_hash, role, status) "
            "VALUES (?, ?, '!test', 'member', 'active') RETURNING id",
            (username, username.title()),
        ).fetchone()
    return str(row[0])


@pytest.fixture
def stores(tmp_path: Path, monkeypatch):
    import core.rag.pgstore as pgstore

    monkeypatch.setattr(pgstore, "QdrantClient", FakeQdrant)
    base = Database(tmp_path / "state")
    base.initialize()
    alice = pgstore.PgQdrantStore(
        "ws", database=base.for_user(_user(base, "alice")), qdrant_url="http://q"
    )
    bob = pgstore.PgQdrantStore(
        "ws", database=base.for_user(_user(base, "bob")), qdrant_url="http://q"
    )
    yield alice, bob
    alice.close()
    bob.close()


def test_context_is_searchable_but_hits_show_the_chunk(stores) -> None:
    alice, _bob = stores
    record = DocumentRecord(
        "report.pdf", 10, 1, "h", "indexed", None, 2, "m", 1.0,
        visual_pages=1, visual_failed=2, contextualized=1,
    )
    alice.replace_document(
        record,
        [
            Chunk(0, "Revenue grew 12 percent.", "page 2", context="ACME Corporation 2023 results"),
            Chunk(1, "Bar chart of yields.", "page 3", "[figure]", visual=True),
        ],
        [[1.0, 0.0], [0.0, 1.0]],
    )
    stored = alice.documents()["report.pdf"]
    assert (stored.visual_pages, stored.visual_failed, stored.contextualized) == (1, 2, 1)

    # "acme" appears only in the context; the vector points elsewhere.
    (hit, *_rest) = alice.search([0.0, 1.0], k=2, query="ACME Corporation")
    assert hit.locator == "page 2"
    assert hit.text == "Revenue grew 12 percent." and not hit.visual
    figure = next(h for h in alice.search([0.0, 1.0], k=2, query="yields chart") if h.visual)
    assert figure.locator == "page 3"


def test_enrichment_cache_round_trips_per_user(stores) -> None:
    alice, bob = stores
    assert alice.cached_values("context", ["k1"]) == {}
    alice.cache_values("context", "luna", {"k1": "first", "k2": "second"})
    alice.cache_values("context", "luna", {"k1": "updated"})
    assert alice.cached_values("context", ["k1", "k2", "k3"]) == {"k1": "updated", "k2": "second"}
    assert alice.cached_values("visual", ["k1"]) == {}
    assert bob.cached_values("context", ["k1", "k2"]) == {}  # row-level security
