"""Agent writes reach open tabs: Postgres NOTIFY from the worker -> Socket.IO.

A user's agent runs in a separate worker process with no route to the gateway
(and no Redis). Its KhaiDocs tools therefore announce each change with
``pg_notify('khaidocs_agent', {...})`` (core/harness/tools/khaidocs.py); this
module LISTENs in the gateway and turns the announcement into the client's own
``invalidate`` events for that user's sockets (sidebar tree, page, recent
changes, trash) and an immediate merge of the new content into the open
editors (instead of waiting for the 3 s version poll).

The payload names the user, so a worker could address another user's tabs. The
only effect is a refetch of data those tabs are allowed to read anyway.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import uuid

import psycopg
from aiohttp import web

from core.harness.tools.khaidocs import NOTIFY_CHANNEL

logger = logging.getLogger(__name__)

RECONNECT_SECONDS = 5.0
TASK_KEY = web.AppKey("khaidocs_agent_events", asyncio.Future)


def events_for(body: dict) -> list[dict]:
    """The client events for one announcement."""

    space, page, slug, op = body.get("s"), body.get("p"), body.get("g"), body.get("op")
    out: list[dict] = []

    def invalidate(*entity: str, id: str | None = None) -> None:
        event = {"operation": "invalidate", "spaceId": space, "entity": list(entity)}
        if id:
            event["id"] = id
        out.append(event)

    if op in ("create", "move", "trash", "restore", "rename"):
        invalidate("root-sidebar-pages", id=space)
        invalidate("sidebar-pages")
        invalidate("recent-changes")
    if op in ("trash", "restore"):
        invalidate("trash-list")
    for ref in {page, slug} - {None}:
        invalidate("pages", id=str(ref))
    if op == "content":
        invalidate("recent-changes")
    return out


async def _listen(app: web.Application, ctx) -> None:  # noqa: ANN001
    while True:
        try:
            conn = await psycopg.AsyncConnection.connect(ctx.database.url, autocommit=True)
            async with conn:
                await conn.execute(f"LISTEN {NOTIFY_CHANNEL}")
                async for note in conn.notifies():
                    await _handle(ctx, note.payload)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - reconnect
            logger.warning("khaidocs agent events: %s; retrying", exc)
        await asyncio.sleep(RECONNECT_SECONDS)


async def _handle(ctx, payload: str) -> None:  # noqa: ANN001
    try:
        body = json.loads(payload)
        user = str(uuid.UUID(str(body["u"])))
    except (ValueError, KeyError, TypeError):
        return
    if ctx.sockets.count(user):
        for event in events_for(body):
            ctx.sockets.publish(user, event)
    if body.get("op") == "content" and body.get("p") and ctx.collab is not None:
        with contextlib.suppress(Exception):
            await ctx.collab.refresh(user, str(body["p"]))


def install(app: web.Application, ctx) -> None:  # noqa: ANN001
    if os.environ.get("KHAIDOCS_AGENT_EVENTS", "1").strip() in {"0", "false"}:
        return

    async def start(app: web.Application) -> None:
        app[TASK_KEY] = asyncio.ensure_future(_listen(app, ctx))

    async def stop(app: web.Application) -> None:
        task = app.get(TASK_KEY)
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

    app.on_startup.append(start)
    app.on_cleanup.append(stop)

