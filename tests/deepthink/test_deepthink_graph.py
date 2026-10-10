"""DeepThink graph routing, budgets, degradation and cancellation (stubs only)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from core.deepthink.limits import DeepThinkLimits
from core.deepthink.runner import DeepThinkRunner, compact_history
from core.deepthink.search import SearchHit, SearchUnavailable
from core.events import (
    AgentMessage,
    AgentMessageDelta,
    DeepThinkProgress,
    ErrorEvent,
    ModelUsageRecorded,
    TaskComplete,
    TurnStarted,
)
from core.providers.base import LLMResponse


class StubProvider:
    """Answers by prompt kind; records every request."""

    def __init__(
        self,
        *,
        plan: Any = None,
        checks: list[Any] | None = None,
        answer: str = "The answer cites [1] and [2].",
        fail: set[str] | None = None,
        hang: set[str] | None = None,
    ) -> None:
        self.plan = plan if plan is not None else {
            "needs_search": True,
            "sub_questions": [
                {"question": "What is A?", "query": "a facts"},
                {"question": "What is B?", "query": "b facts"},
            ],
        }
        self.checks = list(checks or [{"sufficient": True, "follow_up_queries": []}])
        self.answer = answer
        self.fail = fail or set()
        self.hang = hang or set()
        self.calls: list[dict[str, Any]] = []

    @staticmethod
    def _kind(messages: list[dict[str, Any]]) -> str:
        system = messages[0]["content"]
        if "plan research" in system:
            return "plan"
        if "review research coverage" in system:
            return "check"
        return "summarize"

    async def _respond(self, kind: str) -> LLMResponse:
        if kind in self.hang:
            await asyncio.Event().wait()
        if kind in self.fail:
            return LLMResponse(content="Error calling LLM: boom", finish_reason="error")
        usage = {"prompt_tokens": 100, "completion_tokens": 10, "cost_nano_usd": 5}
        if kind == "plan":
            return LLMResponse(content=json.dumps(self.plan), usage=usage)
        if kind == "check":
            verdict = self.checks.pop(0) if self.checks else {"sufficient": True}
            return LLMResponse(content=json.dumps(verdict), usage=usage)
        return LLMResponse(content=self.answer, usage=usage)

    async def chat_with_retry(self, **kwargs: Any) -> LLMResponse:
        kind = self._kind(kwargs["messages"])
        self.calls.append({"kind": kind, **kwargs})
        return await self._respond(kind)

    async def chat_stream_with_retry(self, *, on_content_delta=None, **kwargs: Any):
        kind = self._kind(kwargs["messages"])
        self.calls.append({"kind": kind, "stream": True, **kwargs})
        response = await self._respond(kind)
        if response.finish_reason != "error" and on_content_delta and response.content:
            half = len(response.content) // 2
            await on_content_delta(response.content[:half])
            await on_content_delta(response.content[half:])
        return response

    def kinds(self) -> list[str]:
        return [call["kind"] for call in self.calls]


class StubBackend:
    name = "stub_search"

    def __init__(self, *, fail: bool = False, refuse: bool = False, hang: bool = False) -> None:
        self.fail = fail
        self.refuse = refuse
        self.hang = hang
        self.searches: list[str] = []
        self.fetches: list[str] = []

    async def search(self, query: str, limit: int) -> list[SearchHit]:
        self.searches.append(query)
        if self.hang:
            await asyncio.Event().wait()
        if self.refuse:
            raise SearchUnavailable("not permitted")
        if self.fail:
            raise RuntimeError("search exploded")
        slug = query.replace(" ", "-")
        return [
            SearchHit(f"https://example.com/{slug}/{index}", f"{query} #{index}", "snippet " * 20)
            for index in range(limit + 3)
        ]

    async def fetch(self, url: str, max_chars: int) -> str | None:
        self.fetches.append(url)
        return ("page body " * 2_000)[:max_chars]


async def _collect(runner: DeepThinkRunner, question: str = "Compare A and B", **kwargs):
    return [event async for event in runner.events(question, **kwargs)]


def _runner(provider: StubProvider, backend: StubBackend | None, **limit_overrides) -> DeepThinkRunner:
    async def resolve():
        return backend

    return DeepThinkRunner(
        provider=provider,
        model="stub-model",
        reasoning_effort="medium",
        resolve_backend=resolve,
        limits=DeepThinkLimits(**limit_overrides),
    )


def _final(events) -> str:
    finals = [event.msg for event in events if isinstance(event.msg, AgentMessage)]
    assert len(finals) == 1
    return finals[0].text


def _last_progress(events) -> dict[str, Any]:
    snapshots = [event.msg.payload for event in events if isinstance(event.msg, DeepThinkProgress)]
    assert snapshots
    return snapshots[-1]


def _steps(progress: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {step["id"]: step for step in progress["steps"]}


def test_full_run_plans_searches_checks_and_cites_sources() -> None:
    provider = StubProvider()
    backend = StubBackend()
    events = asyncio.run(_collect(_runner(provider, backend)))

    assert isinstance(events[0].msg, TurnStarted)
    assert isinstance(events[-1].msg, TaskComplete)
    assert events[-1].msg.stop_reason == "completed"
    assert provider.kinds() == ["plan", "check", "summarize"]
    # Plan and check never carry tool schemas; neither does the answer.
    assert all(call["tools"] is None for call in provider.calls)
    # Plan/check run with light effort, the answer with the Turn's effort.
    assert [call["reasoning_effort"] for call in provider.calls] == ["low", "low", "medium"]
    # Max 5 results and at most 2 page fetches per sub-question.
    assert backend.searches == ["a facts", "b facts"]
    assert len(backend.fetches) == 4

    text = _final(events)
    assert "[\\[1\\]](https://example.com/a-facts/0)" in text
    assert "**Sources**" in text
    # Only cited sources are listed.
    assert "a-facts/1" in text and "a-facts/2" not in text.split("**Sources**")[1]
    streamed = "".join(
        event.msg.delta for event in events if isinstance(event.msg, AgentMessageDelta)
    )
    assert "The answer cites" in streamed and "**Sources**" in streamed

    progress = _last_progress(events)
    steps = _steps(progress)
    assert progress["status"] == "completed"
    assert [steps[key]["status"] for key in ("plan", "search", "check", "summarize")] == [
        "completed",
        "completed",
        "completed",
        "completed",
    ]
    assert steps["plan"]["detail"] == "2 sub-questions"
    assert steps["search"]["detail"] == "10 sources"
    assert len(progress["sources"]) == 10
    usage = [event.msg for event in events if isinstance(event.msg, ModelUsageRecorded)]
    assert [entry.response_ordinal for entry in usage] == [1, 2, 3]
    assert usage[0].usage["cost_nano_usd"] == 5


def test_reasoning_question_skips_search_and_check() -> None:
    provider = StubProvider(
        plan={"needs_search": False, "sub_questions": ["Why does the loop terminate?"]},
        answer="Because the invariant shrinks.",
    )
    backend = StubBackend()
    events = asyncio.run(_collect(_runner(provider, backend)))

    assert provider.kinds() == ["plan", "summarize"]
    assert backend.searches == []
    steps = _steps(_last_progress(events))
    assert steps["search"]["status"] == "skipped"
    assert steps["check"]["status"] == "skipped"
    assert steps["plan"]["detail"] == "1 sub-question · no web search needed"
    text = _final(events)
    assert text == "Because the invariant shrinks."
    assert "Sources" not in text


def test_check_loop_is_bounded_by_max_search_rounds() -> None:
    always_more = [
        {"sufficient": False, "follow_up_queries": [f"follow {n}"], "gaps": ["g"]}
        for n in range(10)
    ]
    provider = StubProvider(checks=list(always_more))
    backend = StubBackend()
    events = asyncio.run(_collect(_runner(provider, backend)))
    # Default: one follow-up round, so exactly one check.
    assert provider.kinds() == ["plan", "check", "summarize"]
    assert backend.searches == ["a facts", "b facts", "follow 0"]
    assert _last_progress(events)["round"] == 2

    provider = StubProvider(checks=list(always_more))
    backend = StubBackend()
    asyncio.run(_collect(_runner(provider, backend, max_search_rounds=99)))
    # Ceiling of three rounds: two checks at most, never more than 6 calls.
    assert provider.kinds() == ["plan", "check", "check", "summarize"]
    assert len(provider.calls) <= DeepThinkLimits().max_llm_calls


def test_identical_queries_are_searched_once() -> None:
    provider = StubProvider(
        plan={
            "needs_search": True,
            "sub_questions": [
                {"question": "A?", "query": "same query"},
                {"question": "A again?", "query": "Same Query"},
            ],
        },
        checks=[{"sufficient": False, "follow_up_queries": ["same query", "new query"]}],
    )
    backend = StubBackend()
    asyncio.run(_collect(_runner(provider, backend)))
    assert backend.searches == ["same query", "new query"]


def test_call_budget_reserves_the_answer() -> None:
    provider = StubProvider(checks=[{"sufficient": False, "follow_up_queries": ["x"]}])
    backend = StubBackend()
    events = asyncio.run(_collect(_runner(provider, backend, max_llm_calls=2)))
    assert provider.kinds() == ["plan", "summarize"]
    assert _steps(_last_progress(events))["check"]["status"] == "skipped"


def test_input_token_budget_shrinks_evidence_instead_of_failing() -> None:
    provider = StubProvider()
    backend = StubBackend()
    events = asyncio.run(
        _collect(_runner(provider, backend, max_input_tokens=1_500, max_search_rounds=1))
    )
    summarize = [call for call in provider.calls if call["kind"] == "summarize"]
    assert len(summarize) == 1
    prompt_chars = sum(len(message["content"]) for message in summarize[0]["messages"])
    assert prompt_chars < 1_500 * 4
    assert isinstance(events[-1].msg, TaskComplete)
    assert events[-1].msg.stop_reason == "completed"


def test_missing_search_tool_answers_from_model_knowledge_with_a_note() -> None:
    provider = StubProvider(answer="From memory.")
    events = asyncio.run(_collect(_runner(provider, None)))
    assert provider.kinds() == ["plan", "summarize"]
    text = _final(events)
    assert text.startswith("> Web search was unavailable")
    assert text.endswith("From memory.")
    steps = _steps(_last_progress(events))
    assert steps["search"]["status"] == "skipped"
    assert steps["search"]["detail"] == "No web search tool is connected"


@pytest.mark.parametrize(
    ("backend", "detail"),
    [
        (StubBackend(fail=True), "Search failed"),
        (StubBackend(refuse=True), "Web search was not permitted"),
    ],
)
def test_search_failure_degrades_to_an_answer(backend: StubBackend, detail: str) -> None:
    provider = StubProvider(answer="Best effort.")
    events = asyncio.run(_collect(_runner(provider, backend)))
    assert provider.kinds() == ["plan", "summarize"]
    assert events[-1].msg.stop_reason == "completed"
    assert "Best effort." in _final(events)
    assert _final(events).startswith("> Web search")
    steps = _steps(_last_progress(events))
    assert steps["search"] == {**steps["search"], "status": "failed", "detail": detail}
    assert steps["check"]["status"] == "skipped"


def test_plan_failure_falls_back_to_the_question() -> None:
    provider = StubProvider(fail={"plan"}, answer="Still answered [1].")
    backend = StubBackend()
    events = asyncio.run(_collect(_runner(provider, backend), question="What is new in X?"))
    assert backend.searches == ["What is new in X?"]
    assert _steps(_last_progress(events))["plan"]["status"] == "failed"
    assert events[-1].msg.stop_reason == "completed"


def test_summarize_failure_never_fails_the_turn() -> None:
    provider = StubProvider(fail={"summarize"})
    backend = StubBackend()
    events = asyncio.run(_collect(_runner(provider, backend)))
    assert events[-1].msg.stop_reason == "completed"
    text = _final(events)
    assert text.startswith("DeepThink could not produce an answer")
    assert "**Sources**" in text
    assert _steps(_last_progress(events))["summarize"]["status"] == "failed"


def test_check_failure_answers_with_what_was_found() -> None:
    provider = StubProvider(fail={"check"})
    backend = StubBackend()
    events = asyncio.run(_collect(_runner(provider, backend)))
    assert provider.kinds() == ["plan", "check", "summarize"]
    assert _steps(_last_progress(events))["check"]["status"] == "failed"
    assert events[-1].msg.stop_reason == "completed"


def test_search_timeout_keeps_the_run_moving() -> None:
    provider = StubProvider(answer="Answered anyway.")
    backend = StubBackend(hang=True)
    events = asyncio.run(_collect(_runner(provider, backend, search_timeout_s=0.05)))
    assert events[-1].msg.stop_reason == "completed"
    assert "Answered anyway." in _final(events)


def test_cancellation_stops_the_graph_mid_search() -> None:
    provider = StubProvider()
    backend = StubBackend(hang=True)

    async def scenario() -> list[Any]:
        seen: list[Any] = []

        async def consume() -> None:
            async for event in _runner(provider, backend).events("Q"):
                seen.append(event)

        task = asyncio.create_task(consume())
        for _ in range(200):
            await asyncio.sleep(0.005)
            if backend.searches:
                break
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        # Nothing keeps running after the consumer is gone.
        await asyncio.sleep(0.05)
        return seen

    seen = asyncio.run(scenario())
    assert provider.kinds() == ["plan"]
    assert not any(isinstance(event.msg, TaskComplete) for event in seen)


def test_unexpected_graph_error_surfaces_as_failed_turn() -> None:
    class Broken(StubProvider):
        async def chat_with_retry(self, **kwargs: Any) -> LLMResponse:
            raise AssertionError("bug")

    provider = Broken()
    # Plan swallows provider exceptions; break progress publishing instead.
    runner = _runner(provider, StubBackend())

    async def scenario():
        from core.deepthink import graph as graph_module

        original = graph_module.build_evidence

        def explode(*args, **kwargs):
            raise KeyError("boom")

        graph_module.build_evidence = explode
        try:
            return await _collect(runner)
        finally:
            graph_module.build_evidence = original

    events = asyncio.run(scenario())
    assert any(isinstance(event.msg, ErrorEvent) for event in events)
    assert events[-1].msg == TaskComplete(final_text=None, stop_reason="error")
    assert _last_progress(events)["status"] == "failed"


def test_history_context_is_compact() -> None:
    history = [
        {"role": "system", "content": "huge system prompt " * 1000},
        {"role": "user", "content": "old question " * 500},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "x"}]},
        {"role": "tool", "content": "tool output " * 1000},
        {"role": "assistant", "content": "old answer " * 500},
        {"role": "user", "content": "latest"},
    ]
    context = compact_history(history, DeepThinkLimits())
    assert "system prompt" not in context and "tool output" not in context
    assert context.endswith("user: latest")
    assert len(context) <= DeepThinkLimits().history_char_budget + 2
