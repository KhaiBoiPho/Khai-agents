"""DeepThink search plumbing over Session tools (no network)."""

from __future__ import annotations

import asyncio
import json
from typing import Any, ClassVar

from core.agent_runtime.tools.base import ToolResult
from core.deepthink.search import (
    ToolGate,
    ToolRegistrySearchBackend,
    clean_page_text,
    discover_search_backend,
    parse_search_results,
    select_search_tools,
)


def test_parse_firecrawl_json_results() -> None:
    payload = {
        "web": [
            {"url": "https://a.example/x", "title": "A", "description": "about a"},
            {"url": "https://b.example/y", "title": "B", "description": "about b"},
            {"url": "https://a.example/x", "title": "dup"},
        ]
    }
    hits = parse_search_results(json.dumps(payload), 5)
    assert [(hit.url, hit.title, hit.snippet) for hit in hits] == [
        ("https://a.example/x", "A", "about a"),
        ("https://b.example/y", "B", "about b"),
    ]
    assert len(parse_search_results(json.dumps(payload), 1)) == 1


def test_parse_markdown_results() -> None:
    text = "1. [Title one](https://one.example/a) - first\n2. [Two](https://two.example/b)\n"
    hits = parse_search_results(text, 5)
    assert [hit.url for hit in hits] == ["https://one.example/a", "https://two.example/b"]
    assert hits[0].snippet == "first"


def test_clean_page_text_trims_and_reads_scrape_json() -> None:
    raw = json.dumps({"markdown": "# Title\n\n![img](x.png)\n\n" + "word " * 2_000})
    text = clean_page_text(raw, 500)
    assert text.startswith("# Title")
    assert "![img]" not in text
    assert len(text) <= 502


def test_select_prefers_firecrawl_search_with_its_scrape() -> None:
    names = [
        "read_file",
        "web_fetch",
        "mcp__tavily__tavily_search",
        "mcp__firecrawl__firecrawl_map",
        "mcp__firecrawl__firecrawl_search",
        "mcp__firecrawl__firecrawl_scrape",
        "mcp__github__search_code",
    ]
    assert select_search_tools(names) == (
        "mcp__firecrawl__firecrawl_search",
        "mcp__firecrawl__firecrawl_scrape",
    )
    assert select_search_tools(["web_fetch", "mcp__tavily__tavily_search"]) == (
        "mcp__tavily__tavily_search",
        "web_fetch",
    )
    # A code search or web_fetch alone is not web search.
    assert select_search_tools(["web_fetch", "mcp__github__search_code"]) == (None, None)


class FakeRegistry:
    def __init__(self, names: list[str]) -> None:
        self.tool_names = list(names)
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def execute(self, name: str, params: dict[str, Any]) -> Any:
        self.calls.append((name, params))
        if name.endswith("search"):
            return ToolResult(json.dumps({"web": [{"url": "https://r.example", "title": "R"}]}))
        return ToolResult(json.dumps({"markdown": "page text"}))


def test_gate_runs_allowed_tools_and_asks_once_for_refused() -> None:
    asked: list[str] = []

    def checker(name: str, arguments: dict[str, Any]):
        return ("ask", "needs confirmation")

    async def approve(name: str, arguments: dict[str, Any], reason: str | None) -> bool:
        asked.append(name)
        return False

    registry = FakeRegistry(["mcp__firecrawl__firecrawl_search"])
    backend = ToolRegistrySearchBackend(
        registry,
        search_tool="mcp__firecrawl__firecrawl_search",
        fetch_tool=None,
        gate=ToolGate(checker, approve),
        timeout_s=1,
    )

    async def scenario() -> list[str]:
        errors = []
        for query in ("one", "two", "three"):
            try:
                await backend.search(query, 5)
            except Exception as exc:  # noqa: BLE001
                errors.append(type(exc).__name__)
        return errors

    assert asyncio.run(scenario()) == ["SearchUnavailable"] * 3
    assert asked == ["mcp__firecrawl__firecrawl_search"]
    assert registry.calls == []


def test_backend_calls_search_and_scrape_with_bounded_arguments() -> None:
    registry = FakeRegistry(
        ["mcp__firecrawl__firecrawl_search", "mcp__firecrawl__firecrawl_scrape"]
    )
    backend = ToolRegistrySearchBackend(
        registry,
        search_tool="mcp__firecrawl__firecrawl_search",
        fetch_tool="mcp__firecrawl__firecrawl_scrape",
        gate=ToolGate(lambda name, args: ("allow", ""), None),
        timeout_s=1,
    )

    async def scenario():
        hits = await backend.search("q", 5)
        page = await backend.fetch(hits[0].url, 100)
        return hits, page

    hits, page = asyncio.run(scenario())
    assert hits[0].url == "https://r.example"
    assert page == "page text"
    assert registry.calls[0] == ("mcp__firecrawl__firecrawl_search", {"query": "q", "limit": 5})
    assert registry.calls[1][1]["formats"] == ["markdown"]


def test_discovery_activates_a_deferred_search_server() -> None:
    registry = FakeRegistry(["web_fetch"])

    class Server:
        server_id = "firecrawl"

    class Plan:
        servers = (Server(),)

    class Runtime:
        plan = Plan()
        started = 0
        activated: ClassVar[list[str]] = []

        async def ensure_started(self) -> None:
            self.started += 1

        async def activate_server(self, server_id: str) -> bool:
            self.activated.append(server_id)
            registry.tool_names.append("mcp__firecrawl__firecrawl_search")
            return True

    runtime = Runtime()
    backend = asyncio.run(
        discover_search_backend(
            registry=registry,
            mcp_runtime=runtime,
            gate=ToolGate(None, None),
            tool_timeout_s=1,
            discovery_timeout_s=1,
        )
    )
    assert backend is not None
    assert backend.search_tool == "mcp__firecrawl__firecrawl_search"
    assert backend.fetch_tool == "web_fetch"
    assert runtime.activated == ["firecrawl"]


def test_discovery_without_search_tools_returns_none() -> None:
    backend = asyncio.run(
        discover_search_backend(
            registry=FakeRegistry(["web_fetch", "read_file"]),
            mcp_runtime=None,
            gate=ToolGate(None, None),
            tool_timeout_s=1,
            discovery_timeout_s=1,
        )
    )
    assert backend is None
