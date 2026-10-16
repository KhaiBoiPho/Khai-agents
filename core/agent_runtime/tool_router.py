"""Pick the tool groups a turn needs before the model sees any schema.

Every tool schema rides in every model request, so a large toolset costs the
same prompt tokens whether the user asks to refactor a module or says hello.
This router asks a small decision model (TypeSafe's Jev on OpenRouter, through
its Decisions API) one yes/no question per tool group about the latest request
and shows the model only the groups that clear a threshold.

Safety rails, so a wrong guess never leaves the agent stuck:

* No key, the router switched off, a timeout or any error: every tool is shown
  (``selection`` stays ``None``), exactly as before the router existed.
* Groups whose tools the conversation used recently stay selected.
* ``request_tools`` (always shown, ~100 tokens) lets the model add a group in
  the middle of a turn; the filter is re-read on every model call.
* A tool that matches no group is always shown.
* Within a session the selection only grows. Tool schemas head the prompt, so
  dropping a group would change the prefix and lose the provider's prompt
  cache for everything after it (system prompt and history), which costs more
  than the schemas saved. Once every group is selected, Jev is not asked again.

Configuration: ``KHAI_TOOL_ROUTER`` = ``jev`` (default when OPENROUTER_API_KEY
is set) or ``off``; ``KHAI_TOOL_ROUTER_MODEL`` (default ``typesafe/jev-1.14``);
``KHAI_TOOL_ROUTER_THRESHOLD`` (default 0.35, recall over precision).
"""

from __future__ import annotations

import os
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

import httpx
from loguru import logger

from core.agent_runtime.tools.base import Tool, tool_parameters

DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions"
DEFAULT_MODEL = "typesafe/jev-1.14"
DEFAULT_THRESHOLD = 0.35
TIMEOUT_SECONDS = 4.0
STATE_CHARS = 6_000
STICKY_MESSAGES = 24
REQUEST_TOOL = "request_tools"


@dataclass(frozen=True, slots=True)
class ToolGroup:
    id: str
    need: str  # what a request needs for this group to be useful
    pattern: str  # regex over tool names

    def matches(self, name: str) -> bool:
        return re.fullmatch(self.pattern, name) is not None


GROUPS: tuple[ToolGroup, ...] = (
    ToolGroup("files", "reading, searching, creating or editing files and code in the workspace",
              r"read|write|edit|apply_patch|glob|grep|list_dir|ls|repo_map|code|codex|ruff|py_compile|diagnostics?|replace"),
    ToolGroup("shell", "running terminal commands: tests, builds, installs, git, scripts",
              r"bash|shell|terminal.*|run_command|exec.*"),
    ToolGroup("web", "looking up current information on the internet or opening a URL",
              r"web_.*"),
    ToolGroup("documents", "making or exporting Word, PDF, PowerPoint, Excel or HTML documents, or searching uploaded documents",
              r"document_.*|search_documents|genoffice.*|slides.*"),
    ToolGroup("khaidocs", "the user's KhaiDocs wiki: reading, writing or organizing its pages",
              r"khaidocs_.*"),
    ToolGroup("planner", "the user's tasks/to-dos, calendar events, reminders, notes or work schedule",
              r"planner_.*"),
    ToolGroup("agents", "splitting work across parallel sub-agents",
              r"spawn_agent|wait_agent|send_message|interrupt_agent|list_agents|close_agent"),
    ToolGroup("skills", "a packaged skill (a specialised workflow such as a design or report recipe)",
              r"skill"),
    ToolGroup("memory", "remembering or recalling facts about the user across conversations",
              r"memory"),
    ToolGroup("connectors", "external services connected through MCP (mail, drives, chat apps, databases)",
              r"mcp_.*"),
)

# Small control tools that make a turn work at all; never routed away.
ALWAYS = frozenset({REQUEST_TOOL, "update_plan", "request_user_input", "get_goal", "update_goal"})


def group_of(name: str) -> str | None:
    for group in GROUPS:
        if group.matches(name):
            return group.id
    return None


def _setting(name: str, default: str) -> str:
    return os.environ.get(name, "").strip() or default


def router_enabled() -> bool:
    mode = _setting("KHAI_TOOL_ROUTER", "jev" if os.environ.get("OPENROUTER_API_KEY") else "off").lower()
    return mode == "jev" and bool(os.environ.get("OPENROUTER_API_KEY"))


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(part.get("text", "") for part in content if isinstance(part, dict))
    return ""


def recent_tool_groups(history: Iterable[dict[str, Any]]) -> set[str]:
    """Groups of the tools the last messages called (kept selected)."""

    groups: set[str] = set()
    for message in list(history)[-STICKY_MESSAGES:]:
        for call in message.get("tool_calls") or ():
            function = call.get("function") if isinstance(call, dict) else None
            name = function.get("name") if isinstance(function, dict) else None
            group = group_of(name) if isinstance(name, str) else None
            if group:
                groups.add(group)
    return groups


def conversation_state(prompt: str, history: Iterable[dict[str, Any]]) -> str:
    """The latest request with a little preceding context, newest last."""

    lines: list[str] = []
    for message in list(history)[-6:]:
        role = message.get("role")
        if role not in ("user", "assistant"):
            continue
        text = " ".join(_text_of(message.get("content")).split())
        if text:
            lines.append(f"{role}: {text[:600]}")
    context = "\n".join(lines)[-(STATE_CHARS // 2):]
    return (f"Earlier conversation:\n{context}\n\n" if context else "") + f"Latest user request:\n{prompt[:STATE_CHARS]}"


def decision_questions(groups: Iterable[ToolGroup]) -> dict[str, Any]:
    return {
        group.id: {
            "type": "noul",
            "instructions": f"Does handling the latest user request need tools for {group.need}?",
            "criteria": {
                "true": f"The request needs {group.need}, now or as a likely next step.",
                "false": "The request can be answered without these tools.",
            },
        }
        for group in groups
    }


def selected_groups(answers: dict[str, Any], threshold: float) -> set[str]:
    chosen: set[str] = set()
    for group_id, answer in answers.items():
        value = answer.get("noul") if isinstance(answer, dict) else None
        if isinstance(value, (int, float)) and value >= threshold:
            chosen.add(group_id)
    return chosen


class ToolRouter:
    """Holds this turn's selection; :meth:`filter` is the session's tool_filter."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        threshold: float | None = None,
        post: Callable[..., Any] | None = None,
    ) -> None:
        self.api_key = api_key if api_key is not None else os.environ.get("OPENROUTER_API_KEY", "")
        self.model = model or _setting("KHAI_TOOL_ROUTER_MODEL", DEFAULT_MODEL)
        try:
            self.threshold = threshold if threshold is not None else float(
                _setting("KHAI_TOOL_ROUTER_THRESHOLD", str(DEFAULT_THRESHOLD))
            )
        except ValueError:
            self.threshold = DEFAULT_THRESHOLD
        self._post = post
        self.selection: set[str] | None = None
        self.last_cost_usd: float = 0.0

    async def route(self, prompt: str, history: list[dict[str, Any]], names: Iterable[str]) -> set[str] | None:
        """Choose groups for a new turn; None (show everything) on any failure."""

        present = {group_of(name) for name in names} - {None}
        previous = self.selection or set()
        candidates = [group for group in GROUPS if group.id in present and group.id not in previous]
        if not self.api_key:
            self.selection = None
            return None
        if not candidates:
            # Everything present is already shown; nothing to decide.
            return self.selection
        body = {
            "model": self.model,
            "state": conversation_state(prompt, history),
            "questions": decision_questions(candidates),
        }
        try:
            data = await self._decide(body)
            answers = data.get("answers") if isinstance(data, dict) else None
            if not isinstance(answers, dict) or not answers:
                raise ValueError("no answers")
            chosen = selected_groups(answers, self.threshold) | recent_tool_groups(history) | previous
            usage = data.get("usage") if isinstance(data, dict) else None
            if isinstance(usage, dict) and isinstance(usage.get("cost"), (int, float)):
                self.last_cost_usd = float(usage["cost"])
            self.selection = chosen
            logger.debug("tool router selected {} of {}", sorted(chosen), sorted(present))
        except Exception as exc:  # noqa: BLE001 - routing is an optimisation
            logger.info("tool router fell back to every tool: {}", exc)
            self.selection = None
        return self.selection

    async def _decide(self, body: dict[str, Any]) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        if self._post is not None:
            return await self._post(DECISIONS_URL, json=body, headers=headers)
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.post(DECISIONS_URL, json=body, headers=headers)
            response.raise_for_status()
            return response.json()

    def add(self, group_ids: Iterable[str]) -> list[str]:
        """Show more groups for the rest of the turn (``request_tools``)."""

        known = {group.id for group in GROUPS}
        added = [group_id for group_id in group_ids if group_id in known]
        if self.selection is not None:
            self.selection |= set(added)
        return added

    def filter(self, names: tuple[str, ...]) -> tuple[str, ...] | None:
        if self.selection is None:
            return None
        kept = []
        for name in names:
            group = group_of(name)
            if name in ALWAYS or group is None or group in self.selection:
                kept.append(name)
        return tuple(kept)


@tool_parameters(
    {
        "type": "object",
        "properties": {
            "groups": {
                "type": "array",
                "items": {"type": "string", "enum": [group.id for group in GROUPS]},
                "description": "tool groups to enable for this turn",
            },
        },
        "required": ["groups"],
        "additionalProperties": False,
    }
)
class RequestToolsTool(Tool):
    """Lets the model add tool groups the router left out."""

    def __init__(self, router: ToolRouter) -> None:
        self._router = router

    @property
    def name(self) -> str:
        return REQUEST_TOOL

    @property
    def description(self) -> str:
        groups = "; ".join(f"{group.id}: {group.need}" for group in GROUPS)
        return (
            "Only some tools are loaded for this turn. If you need another kind, "
            f"enable its group and the tools appear in your next step. Groups: {groups}."
        )

    @property
    def read_only(self) -> bool:
        return True

    async def execute(self, **kwargs: Any) -> str:
        groups = kwargs.get("groups") or []
        if self._router.selection is None:
            return "Every tool is already available."
        added = self._router.add(groups if isinstance(groups, list) else [])
        if not added:
            return "No such group; choose from the listed ones."
        return f"Enabled: {', '.join(added)}. Their tools are available from your next step."
