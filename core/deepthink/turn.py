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

import asyncio
from collections.abc import AsyncIterator
from dataclasses import replace
from pathlib import Path
from typing import Any

from loguru import logger

from core.attachments.prepare import PreparedAttachments
from core.deepthink.limits import DeepThinkLimits
from core.deepthink.runner import DeepThinkRunner
from core.deepthink.search import (
    CodeSearchBackend,
    CombinedSearchBackend,
    ToolGate,
    discover_search_backend,
)
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
    attachments: PreparedAttachments | None = None,
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
    prepared = attachments or PreparedAttachments.unchanged(prompt)
    if prepared.attachments:
        # The answer step reads the attached text on top of its usual input.
        active_limits = replace(
            active_limits,
            max_input_tokens=active_limits.max_input_tokens
            + prepared.attachment_tokens
            + active_limits.document_passage_char_budget // 4,
        )
    # A Session with a project can research its code with its own grep/read.
    tool_names = set(getattr(registry, "tool_names", ()) or ())
    code_backend = (
        CodeSearchBackend(registry, gate=gate, timeout_s=active_limits.tool_timeout_s)
        if _session_attr(session, "workspace", "_workspace") is not None
        and {"grep", "read"} <= tool_names
        else None
    )

    async def resolve_backend():
        web = await discover_search_backend(
            registry=registry,
            mcp_runtime=mcp_runtime,
            gate=gate,
            tool_timeout_s=active_limits.tool_timeout_s,
            discovery_timeout_s=active_limits.tool_discovery_timeout_s,
        )
        if web is None and code_backend is None:
            return None
        return CombinedSearchBackend(web, code_backend)

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
        deliver=agent_handoff(session, prepared.full),
        code_search=code_backend is not None,
        attachments=prepared.attachments,
        document_passages=_document_passages(
            registry,
            gate,
            prepared,
            workspace=_session_attr(session, "workspace", "_workspace"),
            limits=active_limits,
        ),
    )
    # Plan and check read the brief (attached files as summaries and
    # openings); the answer step reads the files themselves.
    return runner.events(prepared.brief, history=getattr(session, "history", None))


def _document_passages(
    registry: Any,
    gate: ToolGate,
    prepared: PreparedAttachments,
    *,
    workspace: Path | None,
    limits: DeepThinkLimits,
):
    """Passages of attached files that are not included whole, found with
    the Session's ``search_documents`` per sub-question; None without them."""

    partial = [item for item in prepared.files if item.mode != "inline"]
    if not partial or registry is None:
        return None
    if "search_documents" not in set(getattr(registry, "tool_names", ()) or ()):
        return None
    paths = [
        item.path.relative_to(workspace).as_posix()
        for item in partial
        if workspace is not None and item.path.is_relative_to(workspace)
    ]

    async def passages(queries: list[str]) -> str:
        found: list[str] = []
        used = 0
        for query in queries[: limits.max_sub_questions]:
            arguments: dict[str, Any] = {"query": query, "k": 4}
            if paths:
                arguments["paths"] = paths
            if not await gate.allows("search_documents", arguments):
                break
            try:
                result = await asyncio.wait_for(
                    registry.execute("search_documents", arguments),
                    timeout=limits.tool_timeout_s,
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - passages are optional
                logger.warning("DeepThink document search failed: {}", exc)
                continue
            text = str(result or "").strip()
            if not text or getattr(result, "is_error", False):
                continue
            room = limits.document_passage_char_budget - used
            if room <= 0:
                break
            block = f"Search: {query}\n{text[:room]}"
            found.append(block)
            used += len(block)
        return "\n\n".join(found)

    return passages


__all__ = [
    "DeepThinkUnavailable",
    "agent_handoff",
    "deepthink_event_stream",
    "handoff_text",
    "restore_user_message",
]
