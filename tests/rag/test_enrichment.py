"""Index-time enrichment: contextual retrieval and PDF page vision.

Everything runs against stubs (a fake chat model, fake renderers, the stub
embedder and the in-memory store): no network, no real model.
"""

from __future__ import annotations

import asyncio
import io
import json
import re
import stat
import threading
from pathlib import Path

import httpx
import pytest

from core.rag.chunking import Chunk
from core.rag.contextual import Contextualizer
from core.rag.embeddings import OpenRouterEmbedder
from core.rag.enrich import Enrichment, default_enrichment
from core.rag.extract import (
    VISUAL_HEADING,
    ExtractionError,
    ExtractStats,
    PdfPage,
    extract_document,
    visual_candidates,
)
from core.rag.index import DocumentIndex
from core.rag.llm import (
    DEFAULT_ENRICHMENT_MODEL,
    EnrichmentError,
    EnrichmentUnavailable,
    OpenRouterChat,
)
from core.rag.service import RagService
from core.rag.visual import GenOfficeRenderer, PageImage, VisualReader, default_renderers
from tests.rag.memory_store import MemoryStore
from tests.rag.test_rag import StubEmbedder, make_pdf

# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------

_CHUNK = re.compile(r'<chunk id="(\d+)"(?: location="([^"]*)")?')


class FakeChat:
    """Records every request; answers with ``respond(content) -> str``."""

    def __init__(self, respond=None, model: str = "stub/luna") -> None:
        self.model = model
        self.calls: list[list[dict]] = []
        self.max_tokens: list[int] = []
        self._respond = respond or self.situate
        self._lock = threading.Lock()

    def complete(self, content, *, max_tokens):
        with self._lock:
            self.calls.append(list(content))
            self.max_tokens.append(max_tokens)
        return self._respond(list(content))

    @staticmethod
    def situate(content: list[dict]) -> str:
        """A deterministic 'model': the document's first line + the location."""
        document = content[0]["text"]
        first = document.split("<document>\n", 1)[-1].strip().splitlines()[0]
        rows = [
            {"id": int(number), "context": f"{first}. This chunk is {where or 'a part'} of it."}
            for number, where in _CHUNK.findall(content[1]["text"])
        ]
        return json.dumps(rows)


def chunks_of(texts: list[str]) -> list[Chunk]:
    return [Chunk(i, text, f"page {i + 1}") for i, text in enumerate(texts)]


def png_bytes(color=(200, 30, 30), size=(400, 300)) -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, format="PNG")
    return out.getvalue()


class FakeRenderer:
    def __init__(self, name="fake", fail_pages=(), raise_all=False, data=None) -> None:
        self.name = name
        self.fail_pages = set(fail_pages)
        self.raise_all = raise_all
        self.data = data
        self.rendered: list[int] = []

    def render(self, path, page, target_px):
        if self.raise_all:
            raise RuntimeError("renderer broke")
        self.rendered.append(page.number)
        if page.number in self.fail_pages:
            return None
        return PageImage(self.data or f"img-{page.number}".encode(), "image/png")


def vision_answer(content: list[dict]) -> str:
    match = re.search(r"page (\d+)", content[0]["text"])
    return f"Bar chart: orchard yield per hectare, page {match.group(1)}, peak 42 tonnes."


def make_mixed_pdf(path: Path, *, scanned: bool = False) -> Path:
    """Page 1: text. Page 2: a large image plus a caption. (scanned: image only)"""
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    pdf = canvas.Canvas(str(path))
    if not scanned:
        pdf.drawString(72, 720, "Soil acidity should stay between 6.0 and 6.5 " * 6)
        pdf.showPage()
        pdf.drawString(72, 760, "Figure 1: harvest results across the five blocks, 2020 to 2024")
    pdf.drawImage(ImageReader(io.BytesIO(png_bytes())), 72, 300, width=400, height=300)
    pdf.showPage()
    pdf.save()
    return path


# ---------------------------------------------------------------------------
# Contextual retrieval
# ---------------------------------------------------------------------------


def test_contexts_are_batched_per_document_and_cached() -> None:
    document = "ACME annual report 2023\n\n" + "\n\n".join(f"Paragraph {i} " * 30 for i in range(20))
    chunks = chunks_of([f"Paragraph {i} " * 30 for i in range(20)])
    store = MemoryStore()
    chat = FakeChat()
    contextualizer = Contextualizer(chat, batch_size=8, concurrency=2)

    contexts = contextualizer.contextualize(document, chunks, cache=store)
    assert len(chat.calls) == 3  # 8 + 8 + 4 chunks
    assert all(context.startswith("ACME annual report 2023.") for context in contexts)
    assert contexts[5].endswith("page 6 of it.")
    # The document goes first and identically in every request (prefix caching).
    assert len({call[0]["text"] for call in chat.calls}) == 1
    assert all(tokens <= 300 + 80 * 8 for tokens in chat.max_tokens)

    # Re-indexing the unchanged document costs nothing.
    again = FakeChat()
    assert Contextualizer(again, batch_size=8).contextualize(document, chunks, cache=store) == contexts
    assert again.calls == []
    # A different model is a different cache key.
    other = FakeChat(model="stub/other")
    Contextualizer(other, batch_size=8).contextualize(document, chunks, cache=store)
    assert len(other.calls) == 3


def test_chunks_inside_the_document_prefix_are_referenced_not_resent() -> None:
    body = [f"Section {i}: " + "orchard " * 120 for i in range(6)]
    document = "Orchard handbook\n\n" + "\n\n".join(body)
    chat = FakeChat()
    Contextualizer(chat, batch_size=2, doc_tokens=600, concurrency=1).contextualize(
        document, chunks_of(body)
    )
    first, last = chat.calls[0][1]["text"], chat.calls[-1][1]["text"]
    assert 'in_document="yes"' in first and "starts: Section 0" in first
    assert "[The document continues" in chat.calls[0][0]["text"]
    # Past the prefix: full chunk text plus the text just before the batch.
    assert "<preceding_text>" in last and 'in_document="yes"' not in last
    assert body[5][:200] in last


def test_per_document_cap_leaves_the_rest_without_context() -> None:
    chat = FakeChat()
    chunks = chunks_of([f"chunk {i}" for i in range(12)])
    contexts = Contextualizer(chat, batch_size=8, max_chunks=5).contextualize("Doc\n\nx", chunks)
    assert sum(1 for c in contexts if c) == 5 and contexts[5:] == [""] * 7
    assert len(chat.calls) == 1


def test_failed_batches_fall_back_and_repeated_failures_stop_asking() -> None:
    def broken(_content):
        raise EnrichmentError("HTTP 503")

    chat = FakeChat(broken)
    store = MemoryStore()
    chunks = chunks_of([f"chunk {i}" for i in range(40)])
    contexts = Contextualizer(chat, batch_size=4, concurrency=1).contextualize(
        "Doc\n\nbody", chunks, cache=store
    )
    assert contexts == [""] * 40
    assert len(chat.calls) == 3  # FAILURE_LIMIT, then the rest go without
    assert store.cache == {}

    # Malformed JSON: no context, nothing cached.
    garbage = FakeChat(lambda _c: "I cannot help with that")
    assert Contextualizer(garbage).contextualize("Doc", chunks_of(["a"]), cache=store) == [""]
    assert store.cache == {}

    # A rejected key disables at once.
    def unauthorized(_content):
        raise EnrichmentUnavailable("HTTP 401")

    rejected = FakeChat(unauthorized)
    contextualizer = Contextualizer(rejected, batch_size=1, concurrency=1)
    assert contextualizer.contextualize("Doc", chunks_of(["a", "b", "c"])) == ["", "", ""]
    assert len(rejected.calls) == 1 and contextualizer.disabled


def test_partial_answers_and_fenced_json_are_accepted() -> None:
    chat = FakeChat(lambda _c: '```json\n[{"id": 2, "context": "  second   one "}, {"id": 9, "context": "x"}]\n```')
    contexts = Contextualizer(chat).contextualize("Doc", chunks_of(["a", "b"]))
    assert contexts == ["", "second one"]


# ---------------------------------------------------------------------------
# Configuration and the OpenRouter chat client
# ---------------------------------------------------------------------------


def test_enrichment_needs_an_openrouter_key_and_honours_switches(monkeypatch) -> None:
    assert default_enrichment(StubEmbedder()) is None  # no key: behave as before
    embedder = OpenRouterEmbedder("sk-or-test")
    enrichment = default_enrichment(embedder)
    assert enrichment is not None
    assert enrichment.contextualizer.model == DEFAULT_ENRICHMENT_MODEL == "openai/gpt-6-luna"
    assert enrichment.visual.model == "openai/gpt-6-luna"

    monkeypatch.setenv("KHAI_RAG_CONTEXT_MODEL", "stub/ctx")
    monkeypatch.setenv("KHAI_RAG_VISION_MODEL", "stub/vision")
    enrichment = default_enrichment(embedder)
    assert (enrichment.contextualizer.model, enrichment.visual.model) == ("stub/ctx", "stub/vision")

    monkeypatch.setenv("KHAI_RAG_CONTEXTUAL", "off")
    enrichment = default_enrichment(embedder)
    assert enrichment.contextualizer is None and enrichment.visual is not None
    monkeypatch.setenv("KHAI_RAG_VISION", "0")
    assert default_enrichment(embedder) is None

    monkeypatch.delenv("KHAI_RAG_CONTEXTUAL")
    monkeypatch.delenv("KHAI_RAG_VISION")
    monkeypatch.setenv("KHAI_RAG_VISUAL_MAX_PAGES", "3")
    assert default_enrichment(embedder).visual.max_pages == 3


def test_openrouter_chat_request_retries_and_failures() -> None:
    requests: list[dict] = []
    replies = [
        httpx.Response(429, json={"error": {"message": "slow down"}}),
        httpx.Response(200, json={"choices": [{"message": {"content": " hi "}}]}),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        assert request.url == "https://openrouter.ai/api/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer sk-or-test"
        return replies.pop(0)

    chat = OpenRouterChat(
        "sk-or-test",
        "openai/gpt-6-luna",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        sleep=lambda _s: None,
    )
    assert chat.complete([{"type": "text", "text": "q"}], max_tokens=50) == "hi"
    assert len(requests) == 2
    body = requests[0]
    assert body["model"] == "openai/gpt-6-luna" and body["max_tokens"] == 50
    assert body["reasoning"] == {"effort": "low", "exclude": True}
    assert body["temperature"] == 0

    always_busy = OpenRouterChat(
        "k",
        "m",
        max_retries=2,
        client=httpx.Client(transport=httpx.MockTransport(lambda _r: httpx.Response(503))),
        sleep=lambda _s: None,
    )
    with pytest.raises(EnrichmentError, match="3 attempts"):
        always_busy.complete([], max_tokens=10)
    rejected = OpenRouterChat(
        "k",
        "m",
        client=httpx.Client(transport=httpx.MockTransport(lambda _r: httpx.Response(401))),
        sleep=lambda _s: None,
    )
    with pytest.raises(EnrichmentUnavailable):
        rejected.complete([], max_tokens=10)
    with pytest.raises(EnrichmentUnavailable):
        OpenRouterChat("", "m")


# ---------------------------------------------------------------------------
# Retrieval eval: contextual text improves ranking (deterministic)
# ---------------------------------------------------------------------------

_REPORTS = {
    "doc_a.pdf": ("ACME Corporation annual report 2023", "Revenue grew 12 percent and margins widened."),
    "doc_b.pdf": ("ACME Corporation annual report 2022", "Revenue grew 4 percent and margins narrowed."),
    "doc_c.pdf": ("Globex Industries annual report 2023", "Revenue grew 9 percent and margins held."),
}
_EVAL = [
    ("How much did ACME revenue grow in 2023?", ("doc_a.pdf", "page 2")),
    ("ACME revenue growth 2022", ("doc_b.pdf", "page 2")),
    ("Globex revenue growth", ("doc_c.pdf", "page 2")),
]


def _report_workspace(tmp_path: Path) -> Path:
    from reportlab.pdfgen import canvas

    root = tmp_path / "reports"
    root.mkdir()
    for name, (title, results) in _REPORTS.items():
        pdf = canvas.Canvas(str(root / name))
        pdf.drawString(72, 720, title)
        pdf.drawString(72, 700, "Overview of the company, its people and its products.")
        pdf.showPage()
        pdf.drawString(72, 720, results)
        pdf.showPage()
        pdf.save()
    return root


def _pass_at_1(index: DocumentIndex, embedder: StubEmbedder) -> float:
    hits = 0
    for query, expected in _EVAL:
        results = index.search(embedder, query, k=3)
        hits += bool(results) and (results[0].path, results[0].locator) == expected
    return hits / len(_EVAL)


def test_contextual_retrieval_improves_ranking_on_a_known_eval(tmp_path: Path) -> None:
    root = _report_workspace(tmp_path)
    embedder = StubEmbedder()

    plain = DocumentIndex(root, MemoryStore())
    plain.index(embedder)
    baseline = _pass_at_1(plain, embedder)

    chat = FakeChat()
    contextual = DocumentIndex(root, MemoryStore())
    report = contextual.index(
        embedder, enrichment=Enrichment(contextualizer=Contextualizer(chat))
    )
    improved = _pass_at_1(contextual, embedder)

    assert report.contextualized == 6 and len(chat.calls) == 3  # one call per document
    assert improved == 1.0 and improved > baseline
    # The hit shows the chunk's own text, not the generated context.
    (hit,) = contextual.search(embedder, "How much did ACME revenue grow in 2023?", k=1)
    assert hit.text == "Revenue grew 12 percent and margins widened."
    assert contextual.store.documents()["doc_a.pdf"].contextualized == 2


# ---------------------------------------------------------------------------
# Visual pages
# ---------------------------------------------------------------------------


def _page(number, text="", images=0, refs=(), full=False, content=0) -> PdfPage:
    return PdfPage(number, text, images, tuple(refs), full, content)


def test_visual_page_heuristic() -> None:
    long_text = "x" * 400
    pages = [
        _page(1, long_text, content=900),  # text only
        _page(2, long_text, images=1, refs=(50,)),  # text + a figure
        _page(3, long_text, images=1, refs=(9,)),  # letterhead logo...
        _page(4, long_text, images=1, refs=(9,)),
        _page(5, long_text, images=1, refs=(9,)),  # ...on 3 pages: ignored
        _page(6, long_text, images=1, refs=(60,), full=True),  # OCR'd scan
        _page(7, "", images=1, refs=(70,), full=True),  # scan, no text layer
        _page(8, "Chart", content=6_000),  # vector chart
        _page(9, "Chapter 2", content=120),  # title page
        _page(10, "", content=0),  # blank
    ]
    assert [page.number for page in visual_candidates(pages)] == [2, 7, 8]


def test_pdf_analysis_finds_image_pages(tmp_path: Path) -> None:
    from core.rag.extract import _read_pdf_pages

    pages = _read_pdf_pages(make_mixed_pdf(tmp_path / "mixed.pdf"))
    assert [p.image_count for p in pages] == [0, 1]
    assert [p.number for p in visual_candidates(pages)] == [2]
    assert [p.number for p in visual_candidates(_read_pdf_pages(make_pdf(tmp_path / "t.pdf")))] == []


def test_vision_reads_pages_with_cache_and_limits() -> None:
    pages = [_page(n, "", images=1, refs=(n,)) for n in range(1, 6)]
    store = MemoryStore()
    chat = FakeChat(vision_answer)
    reader = VisualReader(chat, renderers=[FakeRenderer()], max_pages=3)
    result = reader.read_pages(Path("x.pdf"), pages, cache=store)
    assert sorted(result.texts) == [1, 2, 3]
    assert result.skipped == 2 and result.failed == 0
    assert "peak 42 tonnes" in result.texts[2]
    first = chat.calls[0]
    assert first[1]["type"] == "image_url"
    assert first[1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert "Transcribe all visible text" in first[0]["text"]

    again = FakeChat(vision_answer)
    cached = VisualReader(again, renderers=[FakeRenderer()], max_pages=3).read_pages(
        Path("x.pdf"), pages, cache=store
    )
    assert again.calls == [] and cached.texts == result.texts

    # Oversized images are counted as failures, never sent.
    big = VisualReader(
        FakeChat(vision_answer), renderers=[FakeRenderer(data=b"x" * 50)], max_image_bytes=10
    ).read_pages(Path("x.pdf"), pages[:2])
    assert big.failed == 2 and big.texts == {}


def test_one_failing_page_does_not_sink_the_others() -> None:
    def flaky(content):
        if "page 2 " in content[0]["text"]:
            raise EnrichmentError("HTTP 500")
        return vision_answer(content)

    pages = [_page(n, "", images=1, refs=(n,)) for n in (1, 2, 3)]
    result = VisualReader(FakeChat(flaky), renderers=[FakeRenderer()]).read_pages(Path("x.pdf"), pages)
    assert sorted(result.texts) == [1, 3] and result.failed == 1
    # A page the model calls empty adds nothing.
    empty = VisualReader(FakeChat(lambda _c: "NONE"), renderers=[FakeRenderer()]).read_pages(
        Path("x.pdf"), pages[:1]
    )
    assert empty.texts == {} and empty.failed == 0


def test_renderer_fallback_chain(monkeypatch, tmp_path: Path) -> None:
    pages = [_page(1, "", images=1, refs=(1,))]
    broken, working = FakeRenderer("a", raise_all=True), FakeRenderer("b")
    result = VisualReader(FakeChat(vision_answer), renderers=[broken, working]).read_pages(
        Path("x.pdf"), pages
    )
    assert result.texts and working.rendered == [1]

    # No renderer at all: pages are skipped, the model is never asked.
    chat = FakeChat(vision_answer)
    none = VisualReader(chat, renderers=[]).read_pages(Path("x.pdf"), pages)
    assert none.texts == {} and none.skipped == 1 and chat.calls == []

    # pypdfium2 is optional; GenOffice is used only when its binary resolves.
    import core.rag.visual as visual_module

    monkeypatch.setattr(visual_module.PdfiumRenderer, "available", staticmethod(lambda: False))
    assert default_renderers() == []  # GENOFFICE_BIN="" in tests
    fake = tmp_path / "genoffice"
    png = tmp_path / "rendered.png"
    png.write_bytes(png_bytes(size=(600, 800)))
    fake.write_text(
        "#!/bin/sh\n"
        'while [ "$1" != "--out" ]; do shift; done\n'
        f'cp "{png}" "$2/page-01.png"\n'
        'printf \'{"status":"ok","detail":{"files":[{"page":1,"path":"%s/page-01.png"}]}}\' "$2"\n'
    )
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("GENOFFICE_BIN", str(fake))
    (renderer,) = default_renderers()
    image = renderer.render(tmp_path / "doc.pdf", _page(1), 512)
    assert isinstance(renderer, GenOfficeRenderer)
    assert image.mime == "image/jpeg"  # downscaled and re-encoded with Pillow
    from PIL import Image

    assert max(Image.open(io.BytesIO(image.data)).size) <= 512


def test_scanned_pdf_is_read_through_vision(tmp_path: Path) -> None:
    scanned = make_mixed_pdf(tmp_path / "scan.pdf", scanned=True)
    with pytest.raises(ExtractionError, match="no text"):
        extract_document(scanned)  # no vision: unchanged behaviour

    reader = VisualReader(FakeChat(vision_answer), renderers=[FakeRenderer()])
    stats = ExtractStats()
    sections = extract_document(
        scanned, visual=lambda path, pages: reader.read_pages(path, pages), stats=stats
    )
    assert [(s.locator, s.heading, s.visual) for s in sections] == [
        ("page 1", VISUAL_HEADING, True)
    ]
    assert stats.visual_pages == 1 and stats.visual_candidates == 1

    failing = VisualReader(FakeChat(lambda _c: (_ for _ in ()).throw(EnrichmentError("x"))), renderers=[FakeRenderer()])
    with pytest.raises(ExtractionError, match="could not be read from their images"):
        extract_document(scanned, visual=lambda path, pages: failing.read_pages(path, pages))


def test_index_mixed_pdf_with_vision_and_context(tmp_path: Path) -> None:
    from core.harness.tools.documents import render_search_result
    from core.rag.service import SearchOutcome

    root = tmp_path / "ws"
    root.mkdir()
    make_mixed_pdf(root / "mixed.pdf")
    store = MemoryStore()
    index = DocumentIndex(root, store)
    vision = FakeChat(vision_answer)
    enrichment = Enrichment(
        contextualizer=Contextualizer(FakeChat()),
        visual=VisualReader(vision, renderers=[FakeRenderer()]),
    )
    report = index.index(StubEmbedder(), enrichment=enrichment)
    assert report.indexed == ["mixed.pdf"] and report.visual_pages == 1
    record = store.documents()["mixed.pdf"]
    assert (record.visual_pages, record.visual_failed) == (1, 0)
    assert record.contextualized == record.chunk_count == 3
    # The figure prompt carries the page's text layer and asks not to repeat it.
    assert "do not repeat it" in vision.calls[0][0]["text"]

    hits = index.search(StubEmbedder(), "orchard yield per hectare chart", k=2)
    assert hits[0].locator == "page 2" and hits[0].visual and hits[0].heading == VISUAL_HEADING
    result = render_search_result("q", SearchOutcome(hits[:1], 1, 0, 0, False))
    assert "visual (transcribed from the page image)" in result
    assert result.metadata["sources"][0]["visual"] is True

    # Unchanged content: a forced re-index pays for nothing.
    vision_again, context_again = FakeChat(vision_answer), FakeChat()
    index.index(
        StubEmbedder(),
        force=True,
        enrichment=Enrichment(
            contextualizer=Contextualizer(context_again),
            visual=VisualReader(vision_again, renderers=[FakeRenderer()]),
        ),
    )
    assert vision_again.calls == [] and context_again.calls == []


def test_vision_failure_keeps_the_text_pages(tmp_path: Path) -> None:
    root = tmp_path / "ws"
    root.mkdir()
    make_mixed_pdf(root / "mixed.pdf")
    index = DocumentIndex(root, MemoryStore())

    def down(_content):
        raise EnrichmentError("HTTP 503")

    report = index.index(
        StubEmbedder(),
        enrichment=Enrichment(
            contextualizer=Contextualizer(FakeChat(down)),
            visual=VisualReader(FakeChat(down), renderers=[FakeRenderer()]),
        ),
    )
    assert report.indexed == ["mixed.pdf"] and report.failed == {}
    record = index.store.documents()["mixed.pdf"]
    assert (record.visual_pages, record.visual_failed, record.contextualized) == (0, 1, 0)
    assert index.search(StubEmbedder(), "soil acidity", k=1)[0].locator == "page 1"


def test_service_builds_enrichment_per_run(tmp_path: Path) -> None:
    root = tmp_path / "ws"
    root.mkdir()
    make_mixed_pdf(root / "mixed.pdf")
    seen: list[object] = []
    vision = FakeChat(vision_answer)

    def factory(embedder):
        seen.append(embedder)
        return Enrichment(visual=VisualReader(vision, renderers=[FakeRenderer()]))

    service = RagService(store_factory=lambda _key: MemoryStore(), enrichment_factory=factory)
    try:
        assert service.start(root, StubEmbedder) and service.wait(root, 30)
        assert len(seen) == 1 and len(vision.calls) == 1
        assert service.index_for(root).store.documents()["mixed.pdf"].visual_pages == 1
    finally:
        service.close()

    def broken(_embedder):
        raise RuntimeError("bad config")

    service = RagService(store_factory=lambda _key: MemoryStore(), enrichment_factory=broken)
    try:
        assert service.start(root, StubEmbedder) and service.wait(root, 30)
        assert service.index_for(root).store.documents()["mixed.pdf"].status == "indexed"
    finally:
        service.close()


def test_search_tool_still_works_without_enrichment(tmp_path: Path) -> None:
    from core.harness.tools.documents import SearchDocumentsTool

    root = tmp_path / "ws"
    root.mkdir()
    make_mixed_pdf(root / "mixed.pdf")
    service = RagService(store_factory=lambda _key: MemoryStore())
    try:
        result = asyncio.run(
            SearchDocumentsTool(root, StubEmbedder, service=service).execute(query="soil acidity")
        )
        assert "mixed.pdf · page 1" in result and "visual" not in result
    finally:
        service.close()
