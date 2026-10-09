"""Document search: extraction, chunking, store/search, incremental indexing,
the ``search_documents`` tool and the ``rag/*`` RPCs — all with a stub
embedder, no network."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import time
import zipfile
from pathlib import Path

import httpx
import pytest

from core.rag.chunking import chunk_sections, estimate_tokens
from core.rag.embeddings import (
    DEFAULT_EMBEDDING_MODEL,
    EmbeddingError,
    EmbeddingNotConfigured,
    OpenRouterEmbedder,
)
from core.rag.extract import (
    ExtractionError,
    Section,
    extract_document,
    split_markdown,
)
from core.rag.index import DocumentIndex
from core.rag.service import RagService, openrouter_embedder_factory
from tests.rag.memory_store import MemoryStore

# ---------------------------------------------------------------------------
# Fixtures: tiny real documents built with the standard library / reportlab
# ---------------------------------------------------------------------------

_CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_S_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
_A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


def make_docx(path: Path) -> Path:
    def para(text: str, style: str | None = None) -> str:
        props = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
        return f"<w:p>{props}<w:r><w:t>{text}</w:t></w:r></w:p>"

    body = (
        para("Quarterly Report", "Title")
        + para("Revenue", "Heading1")
        + para("Revenue grew 12 percent driven by the orchard division.")
        + "<w:tbl><w:tr><w:tc>"
        + para("Region")
        + "</w:tc><w:tc>"
        + para("Sales")
        + "</w:tc></w:tr><w:tr><w:tc>"
        + para("North")
        + "</w:tc><w:tc>"
        + para("420")
        + "</w:tc></w:tr></w:tbl>"
        + para("Risks", "Heading1")
        + para("Frost remains the main risk to the apple harvest.")
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(
            "word/document.xml",
            f'{_CT}<w:document xmlns:w="{_W_NS}"><w:body>{body}</w:body></w:document>',
        )
    return path


def make_xlsx(path: Path) -> Path:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(
            "xl/workbook.xml",
            f'{_CT}<workbook xmlns="{_S_NS}" xmlns:r="{_R_NS}"><sheets>'
            '<sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>',
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            f'{_CT}<Relationships xmlns="{_REL_NS}">'
            '<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="sharedStrings" Target="sharedStrings.xml"/>'
            "</Relationships>",
        )
        archive.writestr(
            "xl/sharedStrings.xml",
            f'{_CT}<sst xmlns="{_S_NS}"><si><t>Item</t></si><si><t>Cost</t></si>'
            "<si><t>Fertilizer</t></si></sst>",
        )
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            f'{_CT}<worksheet xmlns="{_S_NS}"><sheetData>'
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
            '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1250</v></c></row>'
            '<row r="3"><c r="A3" t="inlineStr"><is><t>Irrigation</t></is></c>'
            '<c r="B3"><v>980</v></c></row>'
            "</sheetData></worksheet>",
        )
    return path


def make_pptx(path: Path) -> Path:
    def slide(title: str, body: str) -> str:
        return (
            f'{_CT}<p:sld xmlns:p="{_P_NS}" xmlns:a="{_A_NS}"><p:cSld><p:spTree>'
            '<p:sp><p:nvSpPr><p:cNvPr id="1" name="t"/><p:cNvSpPr/><p:nvPr>'
            '<p:ph type="title"/></p:nvPr></p:nvSpPr>'
            f"<p:txBody><a:p><a:r><a:t>{title}</a:t></a:r></a:p></p:txBody></p:sp>"
            '<p:sp><p:nvSpPr><p:cNvPr id="2" name="b"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
            f"<p:txBody><a:p><a:r><a:t>{body}</a:t></a:r></a:p></p:txBody></p:sp>"
            "</p:spTree></p:cSld></p:sld>"
        )

    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(
            "ppt/presentation.xml",
            f'{_CT}<p:presentation xmlns:p="{_P_NS}" xmlns:r="{_R_NS}"><p:sldIdLst>'
            '<p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/>'
            "</p:sldIdLst></p:presentation>",
        )
        archive.writestr(
            "ppt/_rels/presentation.xml.rels",
            f'{_CT}<Relationships xmlns="{_REL_NS}">'
            '<Relationship Id="rId1" Type="slide" Target="slides/slide2.xml"/>'
            '<Relationship Id="rId2" Type="slide" Target="slides/slide1.xml"/>'
            "</Relationships>",
        )
        archive.writestr("ppt/slides/slide1.xml", slide("Roadmap", "Launch cider line in spring"))
        archive.writestr("ppt/slides/slide2.xml", slide("Team", "Hire two orchard managers"))
    return path


def make_pdf(path: Path) -> Path:
    from reportlab.pdfgen import canvas

    pdf = canvas.Canvas(str(path))
    pdf.drawString(72, 720, "Soil acidity should stay between 6.0 and 6.5.")
    pdf.showPage()
    pdf.drawString(72, 720, "Pruning happens in late winter before bud break.")
    pdf.save()
    return path


# ---------------------------------------------------------------------------
# Stub embedder: deterministic bag-of-words hashing, so related texts are close
# ---------------------------------------------------------------------------

_DIMS = 1024


class StubEmbedder:
    def __init__(self, model: str = "stub/bow-64") -> None:
        self.model = model
        self.calls: list[list[str]] = []

    def embed(self, texts):
        self.calls.append(list(texts))
        vectors = []
        for text in texts:
            vector = [0.0] * _DIMS
            for word in re.findall(r"[a-z]+", text.lower()):
                if len(word) < 3:
                    continue
                bucket = int(hashlib.md5(word.encode()).hexdigest(), 16) % _DIMS
                vector[bucket] += 1.0
            vectors.append(vector)
        return vectors

    @property
    def embedded_texts(self) -> int:
        return sum(len(call) for call in self.calls)


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------


def test_extract_pdf_keeps_page_locators(tmp_path: Path) -> None:
    sections = extract_document(make_pdf(tmp_path / "guide.pdf"))
    assert [s.locator for s in sections] == ["page 1", "page 2"]
    assert "Soil acidity" in sections[0].text
    assert "Pruning" in sections[1].text


def test_extract_docx_sections_follow_headings_and_tables(tmp_path: Path) -> None:
    sections = extract_document(make_docx(tmp_path / "report.docx"))
    revenue = next(s for s in sections if "Revenue grew" in s.text)
    assert revenue.locator == "Revenue"
    assert revenue.heading == "Quarterly Report › Revenue"
    assert "North | 420" in revenue.text
    risks = next(s for s in sections if "Frost" in s.text)
    assert risks.locator == "Risks"


def test_extract_xlsx_uses_sheet_and_row_locators(tmp_path: Path) -> None:
    (section,) = extract_document(make_xlsx(tmp_path / "budget.xlsx"))
    assert section.locator == "sheet Budget · rows 2–3"
    assert section.heading == "Item | Cost"
    assert "row 2: Item: Fertilizer; Cost: 1250" in section.text
    assert "Irrigation" in section.text


def test_extract_csv_rows(tmp_path: Path) -> None:
    path = tmp_path / "harvest.csv"
    path.write_text("variety,tons\nGala,30\nFuji,22\n", encoding="utf-8")
    (section,) = extract_document(path)
    assert section.locator == "rows 2–3"
    assert "variety: Fuji; tons: 22" in section.text


def test_extract_pptx_follows_presentation_order(tmp_path: Path) -> None:
    sections = extract_document(make_pptx(tmp_path / "deck.pptx"))
    assert [(s.locator, s.heading) for s in sections] == [
        ("slide 1", "Roadmap"),
        ("slide 2", "Team"),
    ]
    assert "cider" in sections[0].text


def test_extract_markdown_text_and_html(tmp_path: Path) -> None:
    md = tmp_path / "notes.md"
    md.write_text("intro line\n\n# Setup\n\nInstall it.\n\n## Linux\n\nUse apt.\n", encoding="utf-8")
    sections = extract_document(md)
    assert [(s.heading, s.locator) for s in sections] == [
        ("", "line 1"),
        ("Setup", "line 3"),
        ("Setup › Linux", "line 7"),
    ]
    txt = tmp_path / "plain.txt"
    txt.write_text("just text", encoding="utf-8")
    assert extract_document(txt) == [Section("just text")]
    html = tmp_path / "page.html"
    html.write_text(
        "<html><head><title>x</title><script>evil()</script></head><body>"
        "<h1>Orchard</h1><p>Apples &amp; pears.</p><h2>Care</h2><p>Water weekly.</p>"
        "</body></html>",
        encoding="utf-8",
    )
    sections = extract_document(html)
    assert [s.heading for s in sections] == ["Orchard", "Orchard › Care"]
    assert sections[0].text == "Apples & pears."
    assert all("evil" not in s.text for s in sections)


def test_markdown_headings_inside_code_fences_are_text() -> None:
    sections = split_markdown("# Real\n\n```\n# not a heading\n```\n")
    assert len(sections) == 1
    assert "# not a heading" in sections[0].text


def test_extract_failures_are_reported(tmp_path: Path) -> None:
    broken = tmp_path / "broken.docx"
    broken.write_bytes(b"not a zip")
    with pytest.raises(ExtractionError):
        extract_document(broken)
    empty_pdf = tmp_path / "blank.pdf"
    from reportlab.pdfgen import canvas

    pdf = canvas.Canvas(str(empty_pdf))
    pdf.showPage()
    pdf.save()
    with pytest.raises(ExtractionError, match="no text"):
        extract_document(empty_pdf)


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------


def test_chunking_respects_size_overlap_and_sections() -> None:
    paragraph = " ".join(f"word{i}" for i in range(120))  # ~840 chars
    sections = [
        Section("\n\n".join([paragraph] * 12), locator="page 1", heading="Intro"),
        Section("short page", locator="page 2"),
    ]
    chunks = chunk_sections(sections, chunk_tokens=400, overlap_tokens=50)
    page1 = [c for c in chunks if c.locator == "page 1"]
    assert len(page1) >= 3
    assert all(estimate_tokens(c.text) <= 401 for c in chunks)
    assert all(c.heading == "Intro" for c in page1)
    # Consecutive chunks share text (the overlap).
    tail = page1[0].text[-80:].split()[-3:]
    assert " ".join(tail) in page1[1].text
    assert chunks[-1].locator == "page 2" and chunks[-1].text == "short page"
    assert [c.ordinal for c in chunks] == list(range(len(chunks)))


def test_chunking_splits_an_oversized_paragraph() -> None:
    giant = "x" * 10_000
    chunks = chunk_sections([Section(giant)], chunk_tokens=200, overlap_tokens=0)
    assert len(chunks) >= 12
    assert all(len(c.text) <= 800 for c in chunks)


# ---------------------------------------------------------------------------
# Store, search and incremental indexing
# ---------------------------------------------------------------------------


def _workspace(tmp_path: Path) -> Path:
    root = tmp_path / "ws"
    (root / "docs").mkdir(parents=True)
    make_pdf(root / "docs" / "guide.pdf")
    make_docx(root / "report.docx")
    make_xlsx(root / "budget.xlsx")
    make_pptx(root / "deck.pptx")
    (root / "notes.md").write_text("# Cider\n\nPress apples in October.\n", encoding="utf-8")
    (root / "code.py").write_text("print('not a document')\n", encoding="utf-8")
    (root / "node_modules").mkdir()
    (root / "node_modules" / "skip.md").write_text("# skipped", encoding="utf-8")
    return root


def test_index_and_search_returns_cited_hits(tmp_path: Path) -> None:
    root = _workspace(tmp_path)
    index = DocumentIndex(root, MemoryStore())
    embedder = StubEmbedder()
    report = index.index(embedder)
    assert sorted(report.indexed) == [
        "budget.xlsx",
        "deck.pptx",
        "docs/guide.pdf",
        "notes.md",
        "report.docx",
    ]
    assert report.failed == {} and report.complete
    hits = index.search(embedder, "pruning before bud break in winter", k=3)
    assert hits[0].path == "docs/guide.pdf"
    assert hits[0].locator == "page 2"
    assert 0 < hits[0].score <= 1.0001
    scoped = index.search(embedder, "pruning winter", k=5, paths=["report.docx"])
    assert {hit.path for hit in scoped} == {"report.docx"}


def test_incremental_reindex_changes_and_deletions(tmp_path: Path) -> None:
    root = _workspace(tmp_path)
    index = DocumentIndex(root, MemoryStore())
    first = StubEmbedder()
    index.index(first)

    # Nothing changed: nothing is embedded again.
    again = StubEmbedder()
    report = index.index(again)
    assert report.indexed == [] and again.calls == []

    # Touch without changing content: hash matches, no re-embedding.
    notes = root / "notes.md"
    stat = notes.stat()
    os.utime(notes, ns=(stat.st_atime_ns, stat.st_mtime_ns + 5_000_000_000))
    touched = StubEmbedder()
    report = index.index(touched)
    assert report.unchanged_content == ["notes.md"] and touched.calls == []
    assert index.plan(touched.model).to_index == []

    # Real edit + deletion + new file.
    notes.write_text("# Cider\n\nPress pears in November instead.\n", encoding="utf-8")
    (root / "deck.pptx").unlink()
    (root / "new.txt").write_text("Beekeeping helps pollination.", encoding="utf-8")
    changed = StubEmbedder()
    report = index.index(changed)
    assert sorted(report.indexed) == ["new.txt", "notes.md"]
    assert report.removed == ["deck.pptx"]
    assert "deck.pptx" not in index.store.documents()
    assert index.search(changed, "pears November", k=1)[0].path == "notes.md"

    # A different embedding model re-embeds everything.
    other = StubEmbedder(model="stub/other")
    assert len(index.plan(other.model).to_index) == 5


def test_failed_documents_are_recorded_and_not_retried(tmp_path: Path) -> None:
    root = tmp_path / "ws"
    root.mkdir()
    (root / "bad.docx").write_bytes(b"garbage")
    index = DocumentIndex(root, MemoryStore())
    report = index.index(StubEmbedder())
    assert "bad.docx" in report.failed
    documents, _ = index.document_statuses("stub/bow-64")
    assert documents[0]["status"] == "failed" and documents[0]["error"]
    assert index.plan("stub/bow-64").to_index == []


def test_embedding_outage_keeps_files_pending(tmp_path: Path) -> None:
    root = _workspace(tmp_path)
    index = DocumentIndex(root, MemoryStore())

    class Down(StubEmbedder):
        def embed(self, texts):
            raise EmbeddingError("HTTP 503")

    report = index.index(Down())
    assert report.error == "HTTP 503" and len(report.remaining) == 5
    documents, _ = index.document_statuses("stub/bow-64")
    assert {d["status"] for d in documents} == {"pending"}


def test_indexing_honours_a_deadline(tmp_path: Path) -> None:
    root = _workspace(tmp_path)
    index = DocumentIndex(root, MemoryStore())
    report = index.index(StubEmbedder(), deadline=time.monotonic() - 1)
    assert report.indexed == [] and len(report.remaining) == 5


# ---------------------------------------------------------------------------
# Service + tool
# ---------------------------------------------------------------------------


def test_service_status_and_background_indexing(tmp_path: Path) -> None:
    root = _workspace(tmp_path)
    service = RagService(store_factory=lambda _key: MemoryStore())
    try:
        status = service.status(root, configured=True, model="stub/bow-64")
        assert status["counts"] == {"total": 5, "indexed": 0, "pending": 5, "failed": 0}
        assert service.start(root, StubEmbedder)
        assert service.wait(root, 30)
        status = service.status(root, configured=True, model="stub/bow-64")
        assert status["state"] == "idle"
        assert status["counts"]["indexed"] == 5
        assert all(d["chunks"] > 0 for d in status["documents"])
        unconfigured = service.status(root, configured=False)
        assert unconfigured["state"] == "unconfigured"
        assert "OPENROUTER_API_KEY" in unconfigured["error"]
    finally:
        service.close()


def test_search_documents_tool_output_shape(tmp_path: Path) -> None:
    from core.harness.tools.documents import SearchDocumentsTool

    root = _workspace(tmp_path)
    service = RagService(store_factory=lambda _key: MemoryStore())
    try:
        tool = SearchDocumentsTool(root, StubEmbedder, service=service)
        assert tool.name == "search_documents" and tool.read_only
        assert tool.presentation_detail({"query": "soil acidity"}) == "soil acidity"
        result = asyncio.run(tool.execute(query="soil acidity range", k=2))
        assert not result.is_error
        lines = result.splitlines()
        # The unrelated second chunk falls under the hybrid similarity threshold.
        assert lines[0] == 'Found 1 result for "soil acidity range".'
        assert lines[1] == "Index: 5 documents indexed."
        assert "[1] docs/guide.pdf · page 1 · score " in result
        assert "Soil acidity should stay between 6.0 and 6.5." in result
        assert result.metadata["resultCount"] == 1
        assert result.metadata["sources"][0] == {
            "path": "docs/guide.pdf",
            "locator": "page 1",
            "score": pytest.approx(result.metadata["sources"][0]["score"]),
        }
        bad = asyncio.run(tool.execute(query="x", paths=["../etc"]))
        assert bad.is_error
    finally:
        service.close()


def test_search_documents_tool_reports_missing_key(tmp_path: Path) -> None:
    from core.harness.tools.documents import SearchDocumentsTool

    service = RagService(store_factory=lambda _key: MemoryStore())
    try:
        tool = SearchDocumentsTool(
            tmp_path, openrouter_embedder_factory(lambda: None), service=service
        )
        result = asyncio.run(tool.execute(query="anything"))
        assert result.is_error
        assert "OPENROUTER_API_KEY is not set" in result
    finally:
        service.close()


def test_tool_activity_reads_as_document_search() -> None:
    from core.events.protocol import ToolActivityKind, describe_tool_activity

    activity = describe_tool_activity("search_documents", {"query": "q3 revenue"})
    assert activity.kind is ToolActivityKind.SEARCH
    assert (activity.label, activity.subject) == ("Search documents", "q3 revenue")


# ---------------------------------------------------------------------------
# OpenRouter embedder (HTTP mocked)
# ---------------------------------------------------------------------------


def test_openrouter_embedder_batches_orders_and_retries() -> None:
    requests: list[dict] = []
    failures = {"left": 1}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append(body)
        assert request.url == "https://openrouter.ai/api/v1/embeddings"
        assert request.headers["Authorization"] == "Bearer sk-or-test"
        if failures["left"]:
            failures["left"] -= 1
            return httpx.Response(429, json={"error": {"message": "slow down"}})
        data = [
            {"index": i, "embedding": [float(len(text)), 1.0]}
            for i, text in enumerate(body["input"])
        ]
        return httpx.Response(200, json={"data": list(reversed(data))})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    embedder = OpenRouterEmbedder(
        "sk-or-test", batch_size=2, client=client, sleep=lambda _s: None
    )
    assert embedder.model == DEFAULT_EMBEDDING_MODEL
    vectors = embedder.embed(["a", "bb", "ccc"])
    assert vectors == [[1.0, 1.0], [2.0, 1.0], [3.0, 1.0]]
    assert [len(r["input"]) for r in requests] == [2, 2, 1]  # first was a 429 retry
    assert all(r["model"] == "baai/bge-m3" for r in requests)


def test_openrouter_embedder_requires_key_and_reports_auth_errors(monkeypatch) -> None:
    with pytest.raises(EmbeddingNotConfigured, match="OPENROUTER_API_KEY"):
        OpenRouterEmbedder(None)
    monkeypatch.setenv("KHAI_RAG_EMBEDDING_MODEL", "qwen/qwen3-embedding-8b")
    client = httpx.Client(
        transport=httpx.MockTransport(lambda _r: httpx.Response(401, json={}))
    )
    embedder = OpenRouterEmbedder("bad", client=client, sleep=lambda _s: None)
    assert embedder.model == "qwen/qwen3-embedding-8b"
    with pytest.raises(EmbeddingNotConfigured):
        embedder.embed(["x"])


def test_factory_falls_back_to_environment_key(monkeypatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-env")
    embedder = openrouter_embedder_factory(lambda: None)()
    assert embedder.model == DEFAULT_EMBEDDING_MODEL


def test_normalized_scores_are_cosine(tmp_path: Path) -> None:
    store = MemoryStore()
    from core.rag.chunking import Chunk
    from core.rag.store import DocumentRecord

    store.replace_document(
        DocumentRecord("a.txt", 1, 1, "h", "indexed", None, 2, "m", 0.0),
        [Chunk(0, "x"), Chunk(1, "y")],
        [[3.0, 4.0], [0.0, 2.0]],
    )
    hits = store.search([0.0, 1.0], k=2)
    assert [h.text for h in hits] == ["y", "x"]
    assert hits[0].score == pytest.approx(1.0)
    assert hits[1].score == pytest.approx(0.8)
    assert math.isclose(sum(1 for _ in hits), 2)
    store.close()


# ---------------------------------------------------------------------------
# rag/* RPCs
# ---------------------------------------------------------------------------


def test_rag_rpcs_report_and_start_indexing(tmp_path: Path, monkeypatch) -> None:
    import app_server.dispatcher as dispatcher_module
    from app_server.connection import ConnectionState
    from app_server.dispatcher import Dispatcher, Params
    from core.application import DeepCodeApplication
    from core.domain.project import TrustState
    from core.rag.service import get_rag_service, reset_rag_service

    root = _workspace(tmp_path)
    application = DeepCodeApplication.open(tmp_path / "state.sqlite3")
    reset_rag_service(RagService(store_factory=lambda _key: MemoryStore()))
    try:
        project = application.projects.add(str(root), trust_state=TrustState.TRUSTED)
        thread = application.threads.start(project.id, title="Docs")
        dispatcher = Dispatcher(application, ConnectionState(application.broker))

        # No key anywhere: everything is pending and the state says why.
        status = dispatcher._handlers["rag/status"](Params({"threadId": thread.id}))
        assert status["state"] == "unconfigured" and status["configured"] is False
        assert status["counts"]["pending"] == 5
        started = dispatcher._handlers["rag/index"](Params({"threadId": thread.id}))
        assert started["state"] == "unconfigured"

        monkeypatch.setattr(
            dispatcher_module,
            "rag_embedder_factory",
            lambda _application, _project_id: StubEmbedder,
        )
        monkeypatch.setenv("KHAI_RAG_EMBEDDING_MODEL", "stub/bow-64")
        started = dispatcher._handlers["rag/index"](
            Params({"threadId": thread.id, "force": True})
        )
        assert started["configured"] is True
        assert get_rag_service().wait(root, 30)
        status = dispatcher._handlers["rag/status"](Params({"threadId": thread.id}))
        assert status["state"] == "idle"
        assert status["counts"] == {"total": 5, "indexed": 5, "pending": 0, "failed": 0}
        assert status["embeddingModel"] == "stub/bow-64"
        assert {d["path"] for d in status["documents"]} >= {"docs/guide.pdf", "budget.xlsx"}
        _assert_matches_schema(status, "RagStatusResult")
    finally:
        reset_rag_service(None)
        application.close()


def _assert_matches_schema(value: dict, definition: str) -> None:
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads(
        (Path(__file__).resolve().parents[2] / "protocol" / "app-server.schema.json").read_text(
            encoding="utf-8"
        )
    )
    jsonschema.validate(value, {"$ref": f"#/$defs/{definition}", "$defs": schema["$defs"]})


def test_upload_hook_starts_background_indexing(tmp_path: Path, monkeypatch) -> None:
    import app_server.dispatcher as dispatcher_module
    from app_server.web_surface import WebSurface
    from core.application import DeepCodeApplication
    from core.domain.project import TrustState
    from core.rag.service import get_rag_service, reset_rag_service

    root = _workspace(tmp_path)
    application = DeepCodeApplication.open(tmp_path / "state.sqlite3")
    reset_rag_service(RagService(store_factory=lambda _key: MemoryStore()))
    monkeypatch.setattr(
        dispatcher_module, "rag_embedder_factory", lambda _a, _p: StubEmbedder
    )
    try:
        project = application.projects.add(str(root), trust_state=TrustState.TRUSTED)
        thread = application.threads.start(project.id, title="Upload")
        context = application.workspaces.resolve(thread.id, require_trusted=True)
        surface = WebSurface(application, auth=None, phase=lambda: "ready")
        asyncio.run(surface._index_upload(context, "deepcode-upload-1-code.py"))
        assert not get_rag_service().running(root)  # not a document: no job
        asyncio.run(surface._index_upload(context, "deepcode-upload-1-guide.pdf"))
        assert get_rag_service().wait(root, 30)
        status = get_rag_service().status(root, configured=True, model="stub/bow-64")
        assert status["counts"]["indexed"] == 5
    finally:
        reset_rag_service(None)
        application.close()


# ---------------------------------------------------------------------------
# Hybrid scoring (RAGFlow)
# ---------------------------------------------------------------------------


def test_hybrid_rerank_prefers_keyword_matches_and_drops_noise() -> None:
    from core.rag.hybrid import Candidate, rerank, tokenize

    assert tokenize("Độ pH của đất là bao nhiêu?") == ["độ", "ph", "đất", "bao", "nhiêu"]

    def candidate(key: str, text: str, cosine: float, heading: str = "") -> Candidate:
        return Candidate(key, f"{key}.md", 0, "", heading, text, cosine)

    ranked = rerank(
        "soil acidity",
        [
            candidate("vector-only", "Weather in spring is mild.", 0.40),
            candidate("keyword", "Soil acidity should stay near 6.5.", 0.30),
            candidate("title", "Keep it between 6 and 7.", 0.30, heading="Soil acidity"),
        ],
        k=5,
    )
    assert [c.key for c in ranked][:2] in (["keyword", "title"], ["title", "keyword"])
    assert "vector-only" not in [c.key for c in ranked]  # 0.3 * 0.4 < 0.2
    # A strong semantic match survives without shared words (other language).
    kept = rerank("soil acidity", [candidate("vi", "Độ pH của đất", 0.8)], k=5)
    assert [c.key for c in kept] == ["vi"]
