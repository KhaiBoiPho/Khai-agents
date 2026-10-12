"""Attached files: whole text, summary tree, cost approval, and both Turn modes."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from core.attachments.content import read_attached, split_attached
from core.attachments.digest import DigestBudget, DigestCache, build_digest, document_chunks, estimate
from core.attachments.prepare import (
    PreparedAttachments,
    ProviderDigestLLM,
    prepare_attachments,
    stream_with_attachments,
)
from core.deepthink.limits import DeepThinkLimits
from core.deepthink.runner import DeepThinkRunner
from core.events import AgentMessage, Event, ModelUsageRecorded, ToolCompleted, ToolStarted
from core.providers.base import LLMResponse

UPLOAD = "deepcode-upload-326c095def3228af886a7c62-"


def _prompt(question: str, *paths: Path) -> str:
    return question + "\n\nAttached workspace context:\n" + "\n".join(f"- {p}" for p in paths)


def _long_markdown(sections: int, words: int = 400) -> str:
    return "\n\n".join(
        f"# Part {n}\n" + " ".join(f"word{n}_{i}" for i in range(words)) for n in range(1, sections + 1)
    )


class SummaryProvider:
    """Summarizes by echoing which prompt kind it saw; counts calls."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def chat_with_retry(self, **kwargs: Any) -> LLMResponse:
        self.calls.append(kwargs)
        system = kwargs["messages"][0]["content"]
        kind = "root" if "whole document" in system else "merge" if "merge" in system else "part"
        return LLMResponse(
            content=f"{kind} summary {len(self.calls)}",
            usage={"prompt_tokens": 1000, "completion_tokens": 50},
        )


async def _prepare(prompt: str, *, provider=None, model="vendor/model:free", approve=None,
                   workspace=None, cache_root: Path, context_window=16_000):
    events: list[Any] = []
    llm = (
        ProviderDigestLLM(provider, model=model, reasoning_effort=None, emit=events.append)
        if provider is not None
        else None
    )
    prepared = await prepare_attachments(
        prompt,
        workspace=workspace,
        context_window=context_window,
        max_output_tokens=None,
        llm=llm,
        approve=approve,
        emit=events.append,
        cache=DigestCache(cache_root),
    )
    return prepared, events


def test_split_attached_reads_the_composer_list(tmp_path: Path) -> None:
    question, paths = split_attached(_prompt("Hi", tmp_path / "a.md", tmp_path / "b.md"))
    assert question == "Hi"
    assert paths == [str(tmp_path / "a.md"), str(tmp_path / "b.md")]
    assert split_attached("no list") == ("no list", [])


def test_small_file_goes_in_whole_under_its_original_name(tmp_path: Path) -> None:
    upload = tmp_path / f"{UPLOAD}lo-trinh.md"
    upload.write_text("# Lộ trình\nGiai đoạn 0", encoding="utf-8")

    prepared, events = asyncio.run(
        _prepare(_prompt("Tóm tắt", upload), cache_root=tmp_path / "cache")
    )

    assert events == []
    assert [f.mode for f in prepared.files] == ["inline"]
    assert prepared.full.startswith("Tóm tắt\n\n")
    assert '<attached_file name="lo-trinh.md"' in prepared.full
    assert "Giai đoạn 0" in prepared.full and "Giai đoạn 0" in prepared.attachments
    assert "Attached workspace context" not in prepared.full


def test_spreadsheets_and_outside_files_stay_listed(tmp_path: Path) -> None:
    sheet = tmp_path / f"{UPLOAD}data.csv"
    sheet.write_text("a,b\n1,2\n", encoding="utf-8")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    outside = tmp_path / "secret.txt"
    outside.write_text("do not leak", encoding="utf-8")

    prepared, _ = asyncio.run(
        _prepare(_prompt("q", sheet, outside), workspace=workspace, cache_root=tmp_path / "c")
    )

    assert prepared.full == _prompt("q", sheet, outside)
    assert "do not leak" not in prepared.full


def test_estimate_matches_the_calls_a_build_makes(tmp_path: Path) -> None:
    path = tmp_path / f"{UPLOAD}long.md"
    path.write_text(_long_markdown(60), encoding="utf-8")
    document = read_attached(str(path), None)
    assert document is not None
    budget = DigestBudget(group_tokens=4_000, output_tokens=300)
    chunks = document_chunks(document)
    planned = estimate([max(1, len(c.text) // 4) for c in chunks], budget, 500)
    provider = SummaryProvider()
    llm = ProviderDigestLLM(provider, model="m", reasoning_effort=None, emit=None)

    digest = asyncio.run(build_digest(document, llm, budget, root_output=500, chunks=chunks))

    # An upper bound: summaries shorter than their allowance merge into fewer calls.
    assert 1 < len(provider.calls) <= planned.calls
    assert digest.root.startswith("root summary")
    assert {node.level for node in digest.nodes} >= {1}
    first_level = [node for node in digest.nodes if node.level == 1]
    assert first_level[0].first == 0 and first_level[-1].last == len(chunks) - 1
    assert "Part 1" in first_level[0].locator


def test_long_file_is_summarized_once_and_reused(tmp_path: Path) -> None:
    path = tmp_path / f"{UPLOAD}book.md"
    path.write_text(_long_markdown(80), encoding="utf-8")
    provider = SummaryProvider()

    prepared, events = asyncio.run(
        _prepare(_prompt("Summarize", path), provider=provider, cache_root=tmp_path / "cache")
    )

    assert [f.mode for f in prepared.files] == ["summary"]
    assert "## Summary\nroot summary" in prepared.full
    assert "## Outline" in prepared.full and "Part 1" in prepared.full
    # The chat's own model wrote it, and every call is Turn usage.
    assert {call["model"] for call in provider.calls} == {"vendor/model:free"}
    started = [e for e in events if isinstance(e, ToolStarted)]
    completed = [e for e in events if isinstance(e, ToolCompleted)]
    usage = [e for e in events if isinstance(e, ModelUsageRecorded)]
    assert len(started) == len(completed) == 1 and not completed[0].is_error
    assert len(usage) == len(provider.calls)
    assert min(e.response_ordinal for e in usage) > 1_000_000

    calls = len(provider.calls)
    again, events = asyncio.run(
        _prepare(_prompt("Again", path), provider=provider, cache_root=tmp_path / "cache")
    )
    assert len(provider.calls) == calls
    assert events == []
    assert "root summary" in again.full


def test_costly_summary_asks_first_and_falls_back_to_an_excerpt(tmp_path: Path) -> None:
    path = tmp_path / f"{UPLOAD}book.md"
    path.write_text(_long_markdown(80), encoding="utf-8")
    provider = SummaryProvider()
    asked: list[tuple[str, dict, str]] = []

    async def deny(tool: str, arguments: dict, reason: str | None) -> bool:
        asked.append((tool, arguments, reason or ""))
        return False

    prepared, events = asyncio.run(
        _prepare(
            _prompt("Summarize", path),
            provider=provider,
            model="unpriced/model",
            approve=deny,
            cache_root=tmp_path / "cache",
        )
    )

    assert provider.calls == []
    assert len(asked) == 1
    tool, arguments, reason = asked[0]
    assert tool == "summarize_document"
    assert arguments["file"] == "book.md" and arguments["calls"] > 1
    assert "unknown cost" in reason
    assert [f.mode for f in prepared.files] == ["excerpt"]
    assert 'mode="excerpt"' in prepared.full and "word1_0" in prepared.full
    assert events == []


def test_approved_costly_summary_is_built(tmp_path: Path) -> None:
    path = tmp_path / f"{UPLOAD}book.md"
    path.write_text(_long_markdown(80), encoding="utf-8")
    provider = SummaryProvider()

    async def allow(*_args: Any) -> bool:
        return True

    prepared, _ = asyncio.run(
        _prepare(_prompt("q", path), provider=provider, model="unpriced/model",
                 approve=allow, cache_root=tmp_path / "cache")
    )

    assert [f.mode for f in prepared.files] == ["summary"]


def test_stream_forwards_preparation_events_then_runs_the_turn() -> None:
    async def prepare(emit):
        emit(ToolStarted(call_id="c", name="summarize_document"))
        await asyncio.sleep(0)
        emit(ToolCompleted(call_id="c", name="summarize_document", is_error=False))
        return PreparedAttachments(prompt="p", full="FULL", brief="BRIEF")

    seen: list[str] = []

    async def run(prepared: PreparedAttachments):
        seen.append(prepared.full)
        yield Event(id="x", msg=AgentMessage(text="done"))

    async def collect():
        return [event.msg async for event in stream_with_attachments(prepare, run, prompt="p")]

    messages = asyncio.run(collect())
    assert [type(m).__name__ for m in messages] == ["ToolStarted", "ToolCompleted", "AgentMessage"]
    assert seen == ["FULL"]


def test_a_failed_preparation_runs_the_turn_on_the_plain_prompt() -> None:
    async def prepare(_emit):
        raise RuntimeError("boom")

    seen: list[str] = []

    async def run(prepared: PreparedAttachments):
        seen.append(prepared.full)
        yield Event(id="x", msg=AgentMessage(text="done"))

    async def collect():
        return [event async for event in stream_with_attachments(prepare, run, prompt="plain")]

    asyncio.run(collect())
    assert seen == ["plain"]


class DeepThinkProvider:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def chat_with_retry(self, **kwargs: Any) -> LLMResponse:
        self.calls.append(kwargs)
        system = kwargs["messages"][0]["content"]
        if "plan research" in system:
            return LLMResponse(
                content=json.dumps({"needs_search": False, "sub_questions": ["What are the stages?"]})
            )
        return LLMResponse(content="Stage 0 then stage 1.")

    async def chat_stream_with_retry(self, *, on_content_delta=None, **kwargs: Any):
        response = await self.chat_with_retry(**kwargs)
        if on_content_delta:
            await on_content_delta(response.content)
        return response


def test_deepthink_plans_from_the_brief_and_answers_from_the_files() -> None:
    provider = DeepThinkProvider()
    searched: list[list[str]] = []

    async def passages(queries: list[str]) -> str:
        searched.append(queries)
        return "[page 9] Stage 1 detail"

    attachments = '<attached_file name="plan.md">FULL FILE TEXT</attached_file>'
    runner = DeepThinkRunner(
        provider=provider,
        model="m",
        reasoning_effort=None,
        resolve_backend=None,
        limits=DeepThinkLimits(),
        attachments=attachments,
        document_passages=passages,
    )

    async def collect():
        return [event async for event in runner.events("Explain the plan\n\nBRIEF ONLY")]

    asyncio.run(collect())
    plan_call, answer_call = provider.calls
    assert "FULL FILE TEXT" not in plan_call["messages"][1]["content"]
    answer = answer_call["messages"][1]["content"]
    assert "FULL FILE TEXT" in answer
    assert "Stage 1 detail" in answer
    assert searched == [["What are the stages?"]]
    assert "never write a tool or function call" in answer_call["messages"][0]["content"]


@pytest.mark.parametrize("window", [8_000, 200_000, 1_000_000])
def test_budget_scales_with_the_context_window(window: int) -> None:
    budget = DigestBudget.for_context(window)
    assert 4_000 <= budget.group_tokens <= 24_000
    assert 300 <= budget.output_tokens <= 1_200
