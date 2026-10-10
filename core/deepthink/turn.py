"""Bridge a live AgentSession to a DeepThink run for one Turn.

DeepThink reuses the Session's already-resolved provider (the same
connection, model and credentials the agent loop would use for this Turn),
its tool registry and MCP runtime (for search), and its permission checker
and approval callback (so search tools obey the same policy as model tool
calls). Nothing here builds a second provider or tool stack.

For deliverables DeepThink hands off to the Session's own agent loop
(``run_stream``) in the same Turn, with the research brief appended to the
user's request. Afterwards the kernel history keeps the user's request as
typed (not the brief), so the transcript holds one user record followed by
the agent's tool calls and outputs, and follow-ups work as usual.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from core.deepthink.limits import DeepThinkLimits
from core.deepthink.runner import DeepThinkRunner
from core.deepthink.search import ToolGate, discover_search_backend
from core.events.protocol import Event, UserInput


def _session_attr(session: Any, *names: str) -> Any:
    for name in names:
        value = getattr(session, name, None)
        if value is not None:
            return value
    return None


class DeepThinkUnavailable(RuntimeError):
    """The Session exposes no provider DeepThink can call."""


def handoff_text(prompt: str, brief: str) -> str:
    return f"{prompt}\n\n{brief}"


def restore_user_message(session: Any, sent: str, prompt: str) -> None:
    """Replace the brief-carrying user message with the request as typed."""

    history = list(getattr(session, "history", None) or ())
    for index in range(len(history) - 1, -1, -1):
        message = history[index]
        if message.get("role") == "user" and message.get("content") == sent:
            history[index] = {**message, "content": prompt}
            session.load_history(history)
            return


def agent_handoff(session: Any, prompt: str):
    """A ``deliver`` callback running the Session's agent loop."""

    run_stream = getattr(session, "run_stream", None)
    if run_stream is None or not hasattr(session, "load_history"):
        return None

    async def deliver(brief: str) -> AsyncIterator[Event]:
        sent = handoff_text(prompt, brief)
        try:
            async for event in run_stream(UserInput(text=sent)):
                yield event
        finally:
            restore_user_message(session, sent, prompt)

    return deliver


def deepthink_event_stream(
    session: Any,
    *,
    prompt: str,
    execution_profile: Any | None,
    limits: DeepThinkLimits | None = None,
) -> AsyncIterator[Event]:
    provider = _session_attr(session, "provider", "_provider")
    if provider is None:
        raise DeepThinkUnavailable("this Session has no LLM provider for DeepThink")
    registry = _session_attr(session, "tool_registry", "_tools")
    mcp_runtime = _session_attr(session, "mcp_runtime", "_mcp_runtime")
    gate = ToolGate(
        _session_attr(session, "permission_checker", "_permission_checker"),
        _session_attr(session, "approval_callback", "_approval_callback"),
    )
    active_limits = limits or DeepThinkLimits()

    async def resolve_backend():
        return await discover_search_backend(
            registry=registry,
            mcp_runtime=mcp_runtime,
            gate=gate,
            tool_timeout_s=active_limits.tool_timeout_s,
            discovery_timeout_s=active_limits.tool_discovery_timeout_s,
        )

    # The Session's resolved wire model first: it is exactly what the agent
    # loop would send for this Turn.
    model = _session_attr(session, "_model") or getattr(
        execution_profile, "model_id", None
    )
    runner = DeepThinkRunner(
        provider=provider,
        model=model,
        reasoning_effort=getattr(execution_profile, "reasoning_effort", None),
        resolve_backend=resolve_backend if registry is not None else None,
        limits=active_limits,
        max_output_tokens=getattr(execution_profile, "max_output_tokens", None),
        deliver=agent_handoff(session, prompt),
    )
    return runner.events(prompt, history=getattr(session, "history", None))


__all__ = [
    "DeepThinkUnavailable",
    "agent_handoff",
    "deepthink_event_stream",
    "handoff_text",
    "restore_user_message",
]
