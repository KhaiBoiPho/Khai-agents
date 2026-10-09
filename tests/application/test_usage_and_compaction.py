"""Token usage ledger, `usage/summary`, and `/compact` through the product stack.

Drives real ``AgentSession`` runtimes against a stub provider so the whole
path is exercised: provider-reported usage → ledger → summary, and
`thread/context/compact` → background summarization → durable Thread events →
the next Turn's request carrying the compacted history.
"""

from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from app_server.connection import ConnectionState
from app_server.dispatcher import Dispatcher
from core.agent_runtime.compaction import SUMMARIZATION_PROMPT, SUMMARY_PREFIX
from core.agent_runtime.tools.registry import ToolRegistry
from core.application import DeepCodeApplication
from core.application.errors import ConflictError
from core.application.usage_service import UsageService, model_prices
from core.domain import TrustState
from core.domain.turn import TurnStatus
from core.events import AgentSession
from core.persistence.usage_repository import UsageRepository, UsageTokens
from core.providers.base import LLMResponse

SUMMARY = "We discussed apples and pears; next: compare prices."


class StubProvider:
    """Answers chat turns and compaction requests with fixed usage."""

    def __init__(self) -> None:
        self.requests: list[list[dict[str, Any]]] = []
        self.turns = 0

    def get_default_model(self) -> str:
        return "fake-model"

    async def chat_with_retry(self, **kwargs: Any) -> LLMResponse:
        messages = list(kwargs.get("messages") or [])
        self.requests.append(messages)
        last = str(messages[-1].get("content", "")) if messages else ""
        if last.startswith(SUMMARIZATION_PROMPT[:40]):
            return LLMResponse(
                content=SUMMARY,
                finish_reason="stop",
                usage={"prompt_tokens": 900, "completion_tokens": 40},
            )
        self.turns += 1
        return LLMResponse(
            content=f"answer {self.turns} " + "z" * 400,
            finish_reason="stop",
            usage={
                "prompt_tokens": 1000 * self.turns,
                "completion_tokens": 100,
                # Thinking billed as output but outside completion_tokens.
                "total_tokens": 1000 * self.turns + 150,
                "cached_tokens": 10,
            },
        )

    async def chat_stream_with_retry(self, **kwargs: Any) -> LLMResponse:
        response = await self.chat_with_retry(**kwargs)
        callback = kwargs.get("on_content_delta")
        if callback is not None and response.content:
            await callback(response.content)
        return response


class StubFactory:
    def __init__(self, provider: StubProvider) -> None:
        self.provider = provider
        self.created = 0

    def create(self, *, workspace, model, approval_callback):
        self.created += 1
        return AgentSession(
            self.provider, ToolRegistry(), model="fake-model", workspace=workspace
        )


def _application(tmp_path: Path, provider: StubProvider):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    factory = StubFactory(provider)
    application = DeepCodeApplication.open(
        tmp_path / "state.sqlite3", session_factory=factory
    )
    project = application.projects.add(str(workspace), trust_state=TrustState.TRUSTED)
    thread = application.threads.start(project.id, title="Usage thread")
    return application, thread.id, factory


def _run_turn(application: DeepCodeApplication, thread_id: str, prompt: str) -> None:
    turn = application.turns.start(thread_id, prompt=prompt).turn
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        current = application.turns.read(turn.id).turn
        if current.status.is_terminal:
            assert current.status is TurnStatus.COMPLETED, current
            return
        time.sleep(0.01)
    raise AssertionError("turn did not finish")


def _wait_for_event(
    application: DeepCodeApplication, thread_id: str, types: set[str]
) -> Any:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        for event in application.events.replay(thread_id, limit=1000):
            if event.type in types:
                return event
        time.sleep(0.02)
    raise AssertionError(f"no {types} event")


def _close(application: DeepCodeApplication) -> None:
    application.close()


def test_usage_tokens_normalize_provider_vocabularies() -> None:
    gemini = UsageTokens.from_usage(
        {"prompt_tokens": 100, "completion_tokens": 10, "total_tokens": 150}
    )
    assert (gemini.input_tokens, gemini.output_tokens) == (100, 50)
    anthropic = UsageTokens.from_usage(
        {"input_tokens": 7, "output_tokens": 3, "cache_read_input_tokens": 5}
    )
    assert (anthropic.input_tokens, anthropic.output_tokens) == (7, 3)
    assert anthropic.cached_input_tokens == 5
    assert UsageTokens.from_usage({"total_tokens": 0}).empty


def test_turn_usage_lands_in_the_ledger_and_summary(tmp_path: Path) -> None:
    provider = StubProvider()
    application, thread_id, _ = _application(tmp_path, provider)
    try:
        _run_turn(application, thread_id, "first question")
        _run_turn(application, thread_id, "second question")

        with application.database.read() as connection:
            records = UsageRepository(connection).list_since(None)
        assert [r.tokens.input_tokens for r in records] == [1000, 2000]
        assert all(r.tokens.output_tokens == 150 for r in records)
        assert all(r.source == "turn" and r.turn_id for r in records)

        summary = UsageService(application.database).summary(days=30)
        assert len(summary["days"]) == 30
        assert summary["days"][-1]["inputTokens"] == 3000
        assert summary["today"]["requests"] == 2
        assert summary["today"]["outputTokens"] == 300
        assert summary["week"] == summary["today"]
        assert summary["allTime"]["inputTokens"] == 3000
        assert summary["allTime"]["cachedInputTokens"] == 20
        assert len(summary["models"]) == 1
    finally:
        _close(application)


def test_ledger_survives_thread_deletion(tmp_path: Path) -> None:
    provider = StubProvider()
    application, thread_id, _ = _application(tmp_path, provider)
    try:
        _run_turn(application, thread_id, "hello")
        application.deletions.delete(thread_id)
        summary = UsageService(application.database).summary()
        assert summary["allTime"]["inputTokens"] == 1000
    finally:
        _close(application)


def test_summary_buckets_follow_the_viewer_offset(tmp_path: Path) -> None:
    application = DeepCodeApplication.open(tmp_path / "state.sqlite3")
    try:
        with application.database.transaction() as connection:
            UsageRepository(connection).record(
                thread_id="thr_x",
                usage={"prompt_tokens": 10, "completion_tokens": 5},
                model_id="gpt-4o",
                recorded_at=datetime(2026, 10, 5, 20, 0, tzinfo=UTC),
            )
        service = UsageService(application.database)
        now = datetime(2026, 10, 6, 1, 0, tzinfo=UTC)
        utc = service.summary(days=2, now=now)
        assert [d["inputTokens"] for d in utc["days"]] == [10, 0]
        # 20:00 UTC on the 5th is already the 6th at UTC+7.
        ict = service.summary(days=2, utc_offset_minutes=420, now=now)
        assert [d["inputTokens"] for d in ict["days"]] == [0, 10]
        prices = model_prices("gpt-4o")
        assert prices is not None
        expected = (10 * prices[0] + 5 * prices[1]) / 1_000_000
        assert ict["today"]["costUsd"] == pytest.approx(expected)
        assert ict["today"]["unpricedRequests"] == 0
    finally:
        _close(application)


def test_family_matched_models_are_not_priced() -> None:
    # A family rule borrows another model's numbers; that is not a price.
    assert model_prices("models/gemini-3.5-flash") is None
    assert model_prices(None) is None


def test_compact_rpc_summarizes_and_the_next_turn_uses_it(tmp_path: Path) -> None:
    provider = StubProvider()
    application, thread_id, factory = _application(tmp_path, provider)
    dispatcher = Dispatcher(application, ConnectionState(application.broker))
    try:
        for index in range(3):
            _run_turn(application, thread_id, f"question {index} " + "q" * 300)
        # A fresh process has no resident runtime; `/compact` must still work.
        asyncio.run(application.turns.session_runtimes.discard(thread_id))
        created_before = factory.created

        result = dispatcher._handlers["thread/context/compact"](
            _params({"threadId": thread_id, "instructions": "keep the prices"})
        )
        assert result["status"] == "started"
        event = _wait_for_event(
            application,
            thread_id,
            {"thread.context.compacted", "thread.context.compaction_failed"},
        )
        assert event.type == "thread.context.compacted", event.payload
        payload = event.payload
        assert payload["compactionId"] == result["compactionId"]
        assert payload["summary"] == SUMMARY
        assert payload["instructions"] == "keep the prices"
        assert payload["tokensAfter"] < payload["tokensBefore"]
        assert payload["messagesAfter"] < payload["messagesBefore"]
        assert payload["usage"] == {"prompt_tokens": 900, "completion_tokens": 40}
        assert payload["afterTurnId"]
        assert factory.created == created_before + 1

        compaction_request = provider.requests[-1]
        assert "keep the prices" in compaction_request[-1]["content"]
        started = [
            e for e in application.events.replay(thread_id, limit=1000)
            if e.type == "thread.context.compacting"
        ]
        assert started and started[0].payload["compactionId"] == result["compactionId"]

        # The summarization call is billed to the ledger as compaction.
        with application.database.read() as connection:
            sources = [
                r.source for r in UsageRepository(connection).list_since(None)
            ]
        assert sources.count("compaction") == 1

        # The next Turn's request carries the compacted history.
        _run_turn(application, thread_id, "follow up")
        follow_up = provider.requests[-1]
        contents = [str(m.get("content", "")) for m in follow_up]
        assert any(SUMMARY in c and c.startswith(SUMMARY_PREFIX) for c in contents)
        assert not any("question 0" in c for c in contents)

        # So does a resume in a fresh runtime (compaction is persisted).
        asyncio.run(application.turns.session_runtimes.discard(thread_id))
        _run_turn(application, thread_id, "after restart")
        contents = [str(m.get("content", "")) for m in provider.requests[-1]]
        assert any(SUMMARY in c for c in contents)
        assert not any("question 0" in c for c in contents)
    finally:
        _close(application)


def test_compact_failure_is_reported_as_an_event(tmp_path: Path) -> None:
    provider = StubProvider()
    application, thread_id, _ = _application(tmp_path, provider)
    dispatcher = Dispatcher(application, ConnectionState(application.broker))
    try:
        _run_turn(application, thread_id, "only one exchange")
        result = dispatcher._handlers["thread/context/compact"](
            _params({"threadId": thread_id})
        )
        event = _wait_for_event(
            application,
            thread_id,
            {"thread.context.compacted", "thread.context.compaction_failed"},
        )
        assert event.type == "thread.context.compaction_failed"
        assert event.payload["compactionId"] == result["compactionId"]
        assert "No compactable history" in event.payload["message"]
        assert not application.turns.is_compacting(thread_id)
    finally:
        _close(application)


def test_compact_on_an_empty_thread_and_turns_during_compaction(
    tmp_path: Path,
) -> None:
    provider = StubProvider()
    application, thread_id, _ = _application(tmp_path, provider)
    try:
        with pytest.raises(ConflictError, match="No compactable history"):
            asyncio.run(application.turns.compact_live_context(thread_id))
        # While a compaction is admitted, new Turns are refused, not raced.
        with application.turns._compacting_lock:
            application.turns._compacting.add(thread_id)
        with pytest.raises(ConflictError, match="being compacted"):
            application.turns.start(thread_id, prompt="hello")
    finally:
        with application.turns._compacting_lock:
            application.turns._compacting.discard(thread_id)
        _close(application)


def test_usage_summary_rpc_validates_and_returns_the_contract(tmp_path: Path) -> None:
    application = DeepCodeApplication.open(tmp_path / "state.sqlite3")
    dispatcher = Dispatcher(application, ConnectionState(application.broker))
    try:
        result = dispatcher._handlers["usage/summary"](
            _params({"days": 7, "utcOffsetMinutes": -300})
        )
        assert len(result["days"]) == 7
        assert result["allTime"]["requests"] == 0
        assert result["utcOffsetMinutes"] == -300
        from app_server.errors import InvalidParams

        with pytest.raises(InvalidParams):
            dispatcher._handlers["usage/summary"](_params({"utcOffsetMinutes": 5000}))
    finally:
        _close(application)


def _params(values: dict[str, Any]):
    from app_server.dispatcher import Params

    return Params(values)


class VerboseSummaryProvider(StubProvider):
    """A summary longer than the history it replaces (refused, still billed)."""

    async def chat_with_retry(self, **kwargs: Any) -> LLMResponse:
        response = await super().chat_with_retry(**kwargs)
        if response.content == SUMMARY:
            return LLMResponse(
                content="verbose " * 2000,
                finish_reason="stop",
                usage=response.usage,
            )
        return response


def test_refused_summary_is_still_billed(tmp_path: Path) -> None:
    provider = VerboseSummaryProvider()
    application, thread_id, _ = _application(tmp_path, provider)
    try:
        for index in range(2):
            _run_turn(application, thread_id, f"short {index}")
        with pytest.raises(ConflictError, match="would not shrink"):
            asyncio.run(application.turns.compact_live_context(thread_id))
        with application.database.read() as connection:
            sources = [r.source for r in UsageRepository(connection).list_since(None)]
        assert sources.count("compaction") == 1
        assert not application.turns.is_compacting(thread_id)
    finally:
        _close(application)
