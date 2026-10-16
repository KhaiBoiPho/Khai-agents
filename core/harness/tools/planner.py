"""``planner_read`` / ``planner_write``: the agent's hands on the planner pages.

The web client's Calendar, Tasks, Schedule and Notes pages keep one document
each per user (core.planner). Reading is read-only and auto-allowed; writing
follows the normal approval policy. Results are short lines that name items by
an 8-character id, and lists are filtered and capped, so a large planner never
floods the context: the model asks for a date range, a status or a query.

Registered only where a user-bound database exists (like KhaiDocs). After a
write the gateway is told over ``pg_notify`` so open tabs can refresh.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Callable
from typing import Any

from loguru import logger

from core.agent_runtime.tools.base import Tool, ToolResult, tool_parameters
from core.planner import PlannerError, PlannerStore
from core.planner import operations as ops

NOTIFY_CHANNEL = "planner_agent"
MODULES = ["tasks", "calendar", "notes", "schedule"]

StoreFactory = Callable[[], PlannerStore]


def default_store() -> PlannerStore | None:
    """The planner of the user this process works for, or None."""

    if not os.environ.get("KHAI_DATABASE_URL", "").strip():
        return None
    try:
        from core.persistence.database import Database

        database = Database()
        database.user_id  # noqa: B018 - resolves (and validates) the binding
        return PlannerStore(database)
    except Exception as exc:  # noqa: BLE001 - optional capability
        logger.debug("planner tools unavailable: {}", exc)
        return None


def planner_tools(store: PlannerStore | None) -> tuple[Tool, ...]:
    if store is None:
        return ()
    return (PlannerReadTool(lambda: store), PlannerWriteTool(lambda: store))


def _err(message: str) -> ToolResult:
    return ToolResult(f"Error: {message}", is_error=True)


def _notify(store: PlannerStore, module: str, version: int) -> None:
    try:
        body = {"u": store.database.user_id, "k": module, "v": version}
        with store.database.transaction() as c:
            c.execute("SELECT pg_notify(?, ?)", (NOTIFY_CHANNEL, json.dumps(body)))
    except Exception as exc:  # noqa: BLE001 - freshness is best effort
        logger.debug("planner notify failed: {}", exc)


class _PlannerTool(Tool):
    def __init__(self, factory: StoreFactory) -> None:
        self._factory = factory

    def presentation_detail(self, arguments: dict[str, Any]) -> str | None:
        parts = [arguments.get("module", ""), arguments.get("action", "")]
        subject = arguments.get("title") or arguments.get("query") or arguments.get("id") or arguments.get("date")
        if subject:
            parts.append(str(subject))
        return " ".join(part for part in parts if part)[:160] or None

    async def execute(self, **kwargs: Any) -> Any:
        module = kwargs.get("module")
        if module not in MODULES:
            return _err(f"module must be one of: {', '.join(MODULES)}")
        try:
            store = self._factory()
            return await asyncio.to_thread(self._run, store, module, kwargs)
        except (ops.OperationError, PlannerError) as exc:
            return _err(str(exc))
        except Exception as exc:  # noqa: BLE001 - tool boundary
            logger.exception("planner tool failed")
            return _err(f"planner failed ({type(exc).__name__})")

    def _run(self, store: PlannerStore, module: str, kwargs: dict) -> str:  # pragma: no cover
        raise NotImplementedError


_FILTERS = {
    "from": {"type": "string", "description": "YYYY-MM-DD: calendar/schedule range start"},
    "to": {"type": "string", "description": "YYYY-MM-DD: range end; tasks: due on or before"},
    "query": {"type": "string", "description": "words in title/content"},
}


@tool_parameters(
    {
        "type": "object",
        "properties": {
            "module": {"type": "string", "enum": MODULES},
            **_FILTERS,
            "status": {"type": "string", "enum": list(ops.TASK_STATUSES), "description": "tasks only"},
            "include_archived": {"type": "boolean", "description": "tasks only"},
            "id": {"type": "string", "description": "notes: read one note in full"},
        },
        "required": ["module"],
        "additionalProperties": False,
    }
)
class PlannerReadTool(_PlannerTool):
    @property
    def name(self) -> str:
        return "planner_read"

    @property
    def description(self) -> str:
        return (
            "Read the user's planner: tasks (to-dos), calendar (events), notes, "
            "schedule (work shifts). Returns short filtered lines with item ids; "
            "pass from/to, status or query instead of reading everything."
        )

    @property
    def read_only(self) -> bool:
        return True

    def _run(self, store: PlannerStore, module: str, kwargs: dict) -> str:
        document = store.read([module]).get(module)
        return ops.read(module, document["value"] if document else None, kwargs)


_ACTIONS = sorted({action for _, action in ops.WRITERS})


@tool_parameters(
    {
        "type": "object",
        "properties": {
            "module": {"type": "string", "enum": MODULES},
            "action": {
                "type": "string",
                "enum": _ACTIONS,
                "description": (
                    "tasks: create/update/complete/delete; calendar: create/update/delete; "
                    "notes: create/update/delete; schedule: set_day/add_extra/remove"
                ),
            },
            "id": {"type": "string", "description": "item id from planner_read (not for create)"},
            "title": {"type": "string"},
            "description": {"type": "string", "description": "tasks/calendar"},
            "content": {"type": "string", "description": "notes: Markdown body"},
            "status": {"type": "string", "enum": list(ops.TASK_STATUSES)},
            "priority": {"type": "string", "enum": list(ops.TASK_PRIORITIES)},
            "category": {"type": "string", "enum": list(ops.TASK_CATEGORIES)},
            "tags": {"type": "array", "items": {"type": "string"}},
            "subtasks": {"type": "array", "items": {"type": "string"}, "description": "tasks create"},
            "due_date": {"type": "string", "description": "tasks: YYYY-MM-DD"},
            "due_time": {"type": "string", "description": "tasks: HH:MM"},
            "start_date": {"type": "string", "description": "tasks: YYYY-MM-DD"},
            "start": {"type": "string", "description": "calendar: YYYY-MM-DDTHH:MM, or YYYY-MM-DD if all_day"},
            "end": {"type": "string", "description": "calendar: same shape; default 1 hour / same day"},
            "all_day": {"type": "boolean"},
            "location": {"type": "string"},
            "reminders": {"type": "array", "items": {"type": "integer"}, "description": "minutes before start"},
            "recurrence": {"type": "string", "description": "RRULE body, e.g. FREQ=WEEKLY;BYDAY=MO"},
            "color": {"type": "string"},
            "pinned": {"type": "boolean", "description": "notes"},
            "date": {"type": "string", "description": "schedule: YYYY-MM-DD"},
            "shift": {"type": "string", "description": "schedule: shift type name/code, or 'free'"},
            "note": {"type": "string", "description": "schedule"},
        },
        "required": ["module", "action"],
        "additionalProperties": False,
    }
)
class PlannerWriteTool(_PlannerTool):
    @property
    def name(self) -> str:
        return "planner_write"

    @property
    def description(self) -> str:
        return (
            "Change the user's planner: add, edit, complete or delete tasks; add, "
            "move or delete calendar events; write notes; set schedule days. Times "
            "are the user's local wall clock. Use ids from planner_read."
        )

    @property
    def read_only(self) -> bool:
        return False

    def _run(self, store: PlannerStore, module: str, kwargs: dict) -> str:
        writer = ops.WRITERS.get((module, kwargs.get("action")))
        if writer is None:
            valid = ", ".join(action for key, action in ops.WRITERS if key == module)
            raise ops.OperationError(f"{module} actions: {valid}")
        document, message = store.mutate(module, lambda value: writer(value, kwargs), by="agent")
        _notify(store, module, document["version"])
        return message
