"""Run the DeepThink graph as a stream of ordinary Session events.

The Turn executor consumes the same ``Event`` protocol the agent loop emits:
``TurnStarted``, progress snapshots (``DeepThinkProgress``), streamed answer
deltas, per-call ``ModelUsageRecorded``, the final ``AgentMessage`` and
``TaskComplete``. Persistence, usage/cost accounting, history and titling
therefore stay on the normal Turn path.

For a deliverable (the plan asked for a file, code change, ...), the run
ends with a research brief instead of an answer and ``deliver`` runs the
normal agent loop over the request plus that brief; its events are forwarded
as-is (usage ordinals shifted past DeepThink's own) and its ``TaskComplete``
ends the Turn.
"""

from __future__ import annotations

import asyncio
import contextlib
import dataclasses
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable
from typing import Any
from uuid import uuid4

from loguru import logger

from core.deepthink.limits import DeepThinkLimits
from core.deepthink.llm import DeepThinkLLM
from core.deepthink.progress import DeepThinkProgress
from core.deepthink.search import SearchBackend, trim
from core.events.protocol import (
    AgentMessage,
    AgentMessageDelta,
    AgentMessagePhase,
    ErrorEvent,
    Event,
    ModelUsageRecorded,
    TaskComplete,
    TurnStarted,
)
from core.events.protocol import (
    DeepThinkProgress as DeepThinkProgressEvent,
)

BackendResolver = Callable[[], Awaitable[SearchBackend | None]]
#: Runs the agent loop for a deliverable; receives the research brief.
DeliverRunner = Callable[[str], AsyncIterator[Event]]

_AGENT_FAILED = {
    "error",
    "empty_final_response",
    "busy",
    "invalid_skill",
    "mcp_startup_failed",
}

_DONE = object()


def compact_history(
    history: Iterable[dict[str, Any]] | None, limits: DeepThinkLimits
) -> str:
    """The last few user/assistant text turns, trimmed hard."""

    if not history:
        return ""
    picked: list[str] = []
    for message in reversed(list(history)):
        role = message.get("role")
        content = message.get("content")
        if role not in {"user", "assistant"} or not isinstance(content, str):
            continue
        if role == "assistant" and message.get("tool_calls"):
            continue
        text = " ".join(content.split())
        if not text:
            continue
        picked.append(f"{role}: {trim(text, 600)}")
        if len(picked) >= limits.history_messages:
            break
    joined = "\n".join(reversed(picked))
    return trim(joined, limits.history_char_budget) if joined else ""


class DeepThinkRunner:
    """One DeepThink run over a provider and an optional search backend."""

    def __init__(
        self,
        *,
        provider: Any,
        model: str | None,
        reasoning_effort: str | None,
        resolve_backend: BackendResolver | None,
        limits: DeepThinkLimits | None = None,
        max_output_tokens: int | None = None,
        deliver: DeliverRunner | None = None,
    ) -> None:
        self.provider = provider
        self.model = model
        self.reasoning_effort = reasoning_effort
        self.resolve_backend = resolve_backend
        self.limits = limits or DeepThinkLimits()
        self.max_output_tokens = max_output_tokens
        self.deliver = deliver
        self.llm: DeepThinkLLM | None = None

    async def events(
        self,
        question: str,
        *,
        history: Iterable[dict[str, Any]] | None = None,
    ) -> AsyncIterator[Event]:
        from core.deepthink.graph import DeepThinkContext, build_graph

        queue: asyncio.Queue[Any] = asyncio.Queue()
        sequence = 0
        message_id = f"deepthink-{uuid4().hex}"
        usage_ordinal = 0

        def put(msg: Any) -> None:
            queue.put_nowait(msg)

        def on_usage(usage: dict[str, int]) -> None:
            nonlocal usage_ordinal
            usage_ordinal += 1
            put(ModelUsageRecorded(response_ordinal=usage_ordinal, usage=dict(usage)))

        async def on_delta(text: str) -> None:
            put(AgentMessageDelta(delta=text, message_id=message_id))

        progress = DeepThinkProgress(lambda doc: put(DeepThinkProgressEvent(payload=doc)))
        llm = DeepThinkLLM(
            self.provider,
            model=self.model,
            reasoning_effort=self.reasoning_effort,
            limits=self.limits,
            on_usage=on_usage,
            max_output_tokens=self.max_output_tokens,
        )
        self.llm = llm
        context = DeepThinkContext(
            llm=llm,
            limits=self.limits,
            progress=progress,
            resolve_backend=self.resolve_backend,
            emit_delta=on_delta,
            can_deliver=self.deliver is not None,
        )
        graph = build_graph(context)

        async def run_agent_phase(brief: str) -> None:
            """Forward the agent loop's events; its TaskComplete ends the Turn."""

            assert self.deliver is not None
            offset = usage_ordinal
            terminal: TaskComplete | None = None
            async for event in self.deliver(brief):
                msg = event.msg
                if isinstance(msg, ModelUsageRecorded):
                    # DeepThink's own calls already used ordinals 1..offset.
                    msg = dataclasses.replace(
                        msg, response_ordinal=msg.response_ordinal + offset
                    )
                    event = dataclasses.replace(event, msg=msg)
                if isinstance(msg, TaskComplete):
                    # Held back so the final progress snapshot precedes it;
                    # keep draining so the agent stream closes cleanly.
                    terminal = msg
                    continue
                put(event)
            reason = terminal.stop_reason if terminal is not None else "error"
            if reason == "interrupted":
                progress.fail("deliver", "Stopped")
                progress.finish("interrupted")
            elif reason in _AGENT_FAILED:
                progress.fail("deliver", "The agent could not finish")
                progress.finish("failed")
            else:
                progress.complete("deliver", "Done")
                progress.finish("completed")
            put(terminal or TaskComplete(final_text=None, stop_reason="error"))

        async def drive() -> None:
            try:
                await graph.ainvoke(
                    {
                        "question": question,
                        "context": compact_history(history, self.limits),
                        "rounds": 0,
                        "sources": [],
                        "searched": [],
                        "notes": [],
                        "search_status": "pending",
                    },
                    config={"recursion_limit": 16},
                )
                if context.brief is not None and self.deliver is not None:
                    await run_agent_phase(context.brief)
                    return
                progress.finish("completed")
                put(
                    AgentMessage(
                        text=context.final_text,
                        message_id=message_id,
                        phase=AgentMessagePhase.FINAL_ANSWER,
                    )
                )
                put(TaskComplete(final_text=context.final_text, stop_reason="completed"))
            except asyncio.CancelledError:
                with contextlib.suppress(Exception):
                    progress.finish("interrupted")
                put(TaskComplete(final_text=None, stop_reason="interrupted"))
                raise
            except Exception as exc:  # noqa: BLE001 - surfaced as a failed Turn
                logger.exception("DeepThink run failed")
                with contextlib.suppress(Exception):
                    progress.finish("failed")
                put(ErrorEvent(message=f"DeepThink failed: {type(exc).__name__}: {exc}"))
                put(TaskComplete(final_text=None, stop_reason="error"))
            finally:
                put(_DONE)

        def wrap(msg: Any) -> Event:
            nonlocal sequence
            sequence += 1
            return Event(id=f"dt-{sequence}", msg=msg)

        yield wrap(TurnStarted())
        task = asyncio.create_task(drive())
        try:
            while True:
                msg = await queue.get()
                if msg is _DONE:
                    break
                # Agent-phase events arrive already enveloped.
                yield msg if isinstance(msg, Event) else wrap(msg)
            await task
        finally:
            if not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task


__all__ = ["DeepThinkRunner", "compact_history"]
