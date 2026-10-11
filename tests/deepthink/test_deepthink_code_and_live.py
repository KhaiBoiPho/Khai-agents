"""DeepThink over the workspace's code, and its live feed."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from core.deepthink.graph import (
    JsonFindings,
    _parse_plan,
    link_citations,
    sources_block,
)
from core.deepthink.progress import DeepThinkProgress
from core.deepthink.search import (
    CodeSearchBackend,
    CombinedSearchBackend,
    SearchHit,
    SearchUnavailable,
    ToolGate,
    is_code_url,
)
from core.harness.tools import default_coding_tools


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "server.ts").write_text(
        "import x from 'y';\n\nexport function startServer(port: number) {\n"
        "  return listen(port);\n}\n" + "// filler\n" * 40 + "startServer(3000);\n"
    )
    (tmp_path / "README.md").write_text("# Demo\nCall startServer to begin.\n")
    return tmp_path


def _code(workspace: Path) -> CodeSearchBackend:
    registry = default_coding_tools(workspace, skills=())
    return CodeSearchBackend(registry, gate=ToolGate(None, None), timeout_s=10)


def test_code_search_finds_regions_and_reads_them(workspace: Path) -> None:
    backend = _code(workspace)
    hits = asyncio.run(backend.search("code: startServer", 5))
    assert [hit.url for hit in hits][0].startswith("src/server.ts:")
    first = hits[0]
    assert is_code_url(first.url) and "startServer" in first.snippet
    excerpt = asyncio.run(backend.fetch(first.url, 4000))
    assert excerpt is not None and "export function startServer" in excerpt


def test_combined_backend_routes_code_and_web_queries(workspace: Path) -> None:
    class Web:
        name = "web"

        async def search(self, query: str, limit: int) -> list[SearchHit]:
            return [SearchHit(url="https://example.com", title=query, snippet="")]

        async def fetch(self, url: str, max_chars: int) -> str | None:
            return "page"

    combined = CombinedSearchBackend(Web(), _code(workspace))
    assert asyncio.run(combined.search("node listen", 3))[0].url == "https://example.com"
    assert asyncio.run(combined.search("code: startServer", 3))[0].url.startswith("src/")
    assert asyncio.run(combined.fetch("https://example.com", 100)) == "page"
    # Without a web backend, web queries are unavailable but code still works.
    code_only = CombinedSearchBackend(None, _code(workspace))
    with pytest.raises(SearchUnavailable):
        asyncio.run(code_only.search("node listen", 3))
    assert asyncio.run(code_only.search("code: startServer", 3))


def test_planner_marks_code_sub_questions() -> None:
    _subs, queries, needs = _parse_plan(
        {
            "needs_search": True,
            "sub_questions": [
                {"question": "How does the server start?", "query": "startServer", "source": "code"},
                {"question": "What is Node's listen?", "query": "node http listen", "source": "web"},
            ],
        },
        "q",
        4,
    )
    assert queries == ["code: startServer", "node http listen"] and needs


def test_code_sources_cite_as_links_to_their_lines() -> None:
    urls = {1: "src/server.ts:1-20", 2: "https://example.com/a"}
    text = link_citations("Starts in [1], see [2].", urls)
    assert "【src/server.ts:1-20】" in text
    assert "[\\[2\\]](https://example.com/a)" in text
    block = sources_block(
        [
            {"id": 1, "url": "src/server.ts:1-20", "title": "src/server.ts:1-20"},
            {"id": 2, "url": "https://example.com/a", "title": "A"},
        ]
    )
    assert "【src/server.ts:1-20】 — workspace" in block


def test_json_findings_pick_out_values_as_they_stream() -> None:
    findings = JsonFindings()
    chunks = [
        '{"needs_search": true, "deliverable": "none", "sub_questions": [{"quest',
        'ion": "How does the server sta',
        'rt?", "query": "startServer", "source": "code"}, {"question": "Why?"',
        # A string counts once what follows shows it is a value, not a key.
        "}]}",
    ]
    seen: list[str] = []
    for chunk in chunks:
        seen.extend(findings.feed(chunk))
    assert seen == ["How does the server start?", "startServer", "Why?"]


def test_live_feed_is_throttled_and_cleared_between_steps(monkeypatch) -> None:
    snapshots: list[dict] = []
    clock = [100.0]
    monkeypatch.setattr("core.deepthink.progress.time.monotonic", lambda: clock[0])
    progress = DeepThinkProgress(snapshots.append)
    progress.start("plan", "Breaking the question down")
    published = len(snapshots)
    progress.stream("plan", "thinking ")
    progress.stream("plan", "more")
    assert len(snapshots) == published  # held back by the throttle
    clock[0] += 1
    progress.stream("plan", "!")
    assert snapshots[-1]["live"] == {"step": "plan", "text": "thinking more!"}
    progress.start("search", "Searching")
    assert snapshots[-1]["live"] == {"step": "search", "text": ""}
    progress.finish("completed")
    assert snapshots[-1]["live"] == {"step": None, "text": ""}


def test_a_run_researches_the_code_streams_into_the_card_and_cites_lines(
    workspace: Path,
) -> None:
    from tests.deepthink.test_deepthink_graph import StubProvider, _collect, _final, _last_progress

    from core.deepthink.limits import DeepThinkLimits
    from core.deepthink.runner import DeepThinkRunner
    from core.events.protocol import DeepThinkProgress as ProgressEvent

    provider = StubProvider(
        plan={
            "needs_search": True,
            "sub_questions": [
                {"question": "How does the server start?", "query": "startServer", "source": "code"}
            ],
        },
        answer="It starts in startServer [1].",
    )
    code = _code(workspace)

    async def resolve():
        return CombinedSearchBackend(None, code)

    runner = DeepThinkRunner(
        provider=provider,
        model="stub-model",
        reasoning_effort="medium",
        resolve_backend=resolve,
        limits=DeepThinkLimits(),
        code_search=True,
    )
    events = asyncio.run(_collect(runner, "How does this server start?"))
    # The planner was told it may search the code.
    plan_system = next(call for call in provider.calls if call["kind"] == "plan")["messages"][0]
    assert "search its source code" in plan_system["content"]
    # The card streamed the plan's sub-question and the search's finding.
    lives = [
        event.msg.payload["live"]["text"]
        for event in events
        if isinstance(event.msg, ProgressEvent) and event.msg.payload["live"]["text"]
    ]
    assert any("How does the server start?" in text for text in lives)
    assert any("code: startServer" in text and "src/server.ts" in text for text in lives)
    # The answer cites the code region as a link to its lines.
    final = _final(events)
    assert "【src/server.ts:" in final
    assert _last_progress(events)["sources"][0]["url"].startswith("src/server.ts:")
