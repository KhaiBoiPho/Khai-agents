"""KhaiDocs pages as virtual documents of the document index (stub embedder)."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest

from core.harness.tools.documents import SearchDocumentsTool
from core.khaidocs import KhaiDocsStore, agent_markdown as md
from core.persistence import Database
from core.rag import khaidocs_source as source
from core.rag.index import STATUS_INDEXED
from core.rag.service import RagService
from tests.khaidocs.conftest import make_user
from tests.rag.memory_store import MemoryStore
from tests.rag.test_rag import StubEmbedder


@pytest.fixture
def wiki(tmp_path: Path):
    database = Database(tmp_path / "state")
    database.initialize()
    return KhaiDocsStore(database.for_user(make_user(database, "alice")))


def put(wiki: KhaiDocsStore, title: str, markdown: str, **kw) -> dict:
    return wiki.create_page(title=title, content=md.markdown_to_pm(markdown), **kw)


def make_index(wiki, **kw):
    return source.KhaiDocsIndex(source.KHAIDOCS_ROOT, MemoryStore(), wiki, **kw)


def test_sections_follow_headings() -> None:
    sections = source.split_sections("Vườn", "Mở đầu\n\n## Cắt tỉa\n\nMùa đông.\n\n### Cành\n\nCành già.\n", 10_000)
    assert [(s.locator, s.heading) for s in sections] == [
        ("", "Vườn"), ("Cắt tỉa", "Vườn > Cắt tỉa"), ("Cành", "Vườn > Cắt tỉa > Cành"),
    ]
    assert source.split_sections("T", "```\n# not a heading\n```", 100)[0].locator == ""
    assert len(source.split_sections("T", "x" * 500, 100)[0].text) == 100


def test_index_search_and_incremental_updates(wiki) -> None:
    a = put(wiki, "Vườn táo", "## Cắt tỉa\n\nCắt tỉa cành vào mùa đông trước khi nảy chồi.\n\n## Sâu bệnh\n\nPhun thuốc.")
    b = put(wiki, "Bếp", "Công thức bánh mì: bột, nước, men.")
    index, embedder = make_index(wiki), StubEmbedder()
    report = index.index(embedder)
    assert len(report.indexed) == 2 and report.complete
    paths = sorted(index.store.documents())
    assert all(p.startswith("khaidocs/") for p in paths)
    assert paths[0].endswith(a["slug_id"]) or paths[1].endswith(a["slug_id"])
    hit = index.search(embedder, "cắt tỉa cành mùa đông", k=1)[0]
    assert hit.path.endswith(a["slug_id"]) and hit.locator == "Cắt tỉa"
    assert source.slug_of(hit.path) == a["slug_id"]

    # nothing changed: nothing embedded
    again = StubEmbedder()
    assert index.index(again).indexed == [] and again.calls == []

    # an edit (agent write) re-embeds only that page; a trash removes it
    wiki.set_content(b["id"], md.markdown_to_pm("Công thức bánh mì mới: bột mì, men khô."), updated_by="agent")
    wiki.trash_page(a["id"])
    changed = StubEmbedder()
    report = index.index(changed)
    assert [source.slug_of(p) for p in report.indexed] == [b["slug_id"]]
    assert [source.slug_of(p) for p in report.removed] == [a["slug_id"]]
    assert len(index.store.documents()) == 1
    wiki.restore_page(a["id"])
    assert [source.slug_of(p) for p in index.index(StubEmbedder()).indexed] == [a["slug_id"]]


def test_unchanged_text_is_only_touched(wiki) -> None:
    page = put(wiki, "Ghi chú", "nội dung giữ nguyên")
    index = make_index(wiki)
    index.index(StubEmbedder())
    wiki.update_page(page["id"], icon="📝")  # bumps updated_at, not the text
    time.sleep(0.01)
    embedder = StubEmbedder()
    report = index.index(embedder)
    assert embedder.calls == [] and len(report.unchanged_content) in (0, 1)


def test_cost_caps(wiki, monkeypatch) -> None:
    for i in range(5):
        put(wiki, f"Trang {i}", f"nội dung số {i} " + "chữ " * 200)
    monkeypatch.setenv(source.MAX_PAGES_ENV, "2")
    monkeypatch.setenv(source.MAX_CHARS_ENV, "300")
    index = make_index(wiki)
    files, truncated = index.scan()
    assert len(files) == 2 and truncated
    embedder = StubEmbedder()
    index.index(embedder)
    assert max(len(t) for call in embedder.calls for t in call) < 700
    monkeypatch.setenv(source.ENABLE_ENV, "0")
    assert not source.enabled()


def test_service_and_tool_merge_wiki_hits_with_a_hint(wiki, tmp_path) -> None:
    put(wiki, "Vườn táo", "## Cắt tỉa\n\nCắt tỉa cành vào mùa đông trước khi nảy chồi.")
    workspace = tmp_path / "chat"
    workspace.mkdir()
    (workspace / "notes.md").write_text("# Cider\n\nPress pears in November.\n", encoding="utf-8")
    service = RagService(store_factory=lambda _key: MemoryStore(), khaidocs_source=lambda: wiki)
    try:
        tool = SearchDocumentsTool(workspace, StubEmbedder, service=service, khaidocs=True)
        result = asyncio.run(tool.execute(query="cắt tỉa cành mùa đông"))
        assert not result.is_error
        assert "khaidocs/" in result and "Cắt tỉa" in result
        assert "khaidocs_read" in result and "Index: 2 documents indexed." in result
        assert result.metadata["sources"][0]["path"].startswith("khaidocs/")
        assert "Press pears" in asyncio.run(tool.execute(query="press pears november"))
        # off: workspace files only
        plain = SearchDocumentsTool(workspace, StubEmbedder, service=service)
        assert "khaidocs/" not in asyncio.run(plain.execute(query="cắt tỉa cành mùa đông"))
        # a code project (uploads only) never searches the wiki
        code = SearchDocumentsTool(workspace, StubEmbedder, service=service, uploads_only=True, khaidocs=True)
        assert code._khaidocs is False
    finally:
        service.close()


def test_a_broken_wiki_does_not_break_file_search(tmp_path) -> None:
    workspace = tmp_path / "chat"
    workspace.mkdir()
    (workspace / "notes.md").write_text("# Cider\n\nPress pears in November.\n", encoding="utf-8")

    def boom():
        raise RuntimeError("db down")

    service = RagService(store_factory=lambda _key: MemoryStore(), khaidocs_source=boom)
    try:
        tool = SearchDocumentsTool(workspace, StubEmbedder, service=service, khaidocs=True)
        result = asyncio.run(tool.execute(query="press pears november"))
        assert not result.is_error and "notes.md" in result
    finally:
        service.close()
