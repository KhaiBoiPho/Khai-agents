"""Notifications (the bell), page and space watching.

Live updates: every notification written through
:class:`core.khaidocs.notifications.NotificationStore` (by these routes, the
comment routes or the agent) reaches the user's open tabs as a Socket.IO
``message`` ``{"operation": "invalidate", "entity": ["notifications"]}``,
which makes the client refetch the list and the unread counter. The
listener is bound to the running gateway on the first KhaiDocs request
(:func:`bind`).
"""

from __future__ import annotations

import asyncio

from app_server.khaidocs.api import ApiError, Call, KhaiUser, Router, page_of
from app_server.khaidocs.serialize import person
from core.khaidocs import notifications as core_notifications
from core.khaidocs.notifications import NotificationStore

router = Router()
AGENT_NAME = "Khai"
BELL_EVENT = {"operation": "invalidate", "entity": ["notifications"]}
_bound: dict[int, object] = {}


def bind(ctx) -> None:
    """Register (once per context) the listener that pushes the bell event."""

    if id(ctx) in _bound:
        return
    loop = asyncio.get_running_loop()

    def listener(user_id: str, _row: dict) -> None:
        try:
            loop.call_soon_threadsafe(ctx.sockets.publish, user_id, BELL_EVENT)
        except RuntimeError:  # the loop is closed (shutdown)
            pass

    _bound[id(ctx)] = listener
    core_notifications.add_listener(listener)


def creator_json(author: str, user: KhaiUser) -> dict:
    if author == "agent":
        return {"id": "agent", "name": AGENT_NAME, "avatarUrl": None}
    return person(user)


def notification_json(row: dict, user: KhaiUser) -> dict:
    actor = row["actor"] or "user"
    return {
        "id": row["id"],
        "userId": user.id,
        "workspaceId": user.id,
        "type": row["type"],
        "actorId": user.id if actor == "user" else "agent",
        "pageId": row["page_id"],
        "spaceId": row["space_id"],
        "commentId": row["comment_id"],
        "data": row["data"],
        "readAt": row["read_at"],
        "emailedAt": None,
        "archivedAt": row["archived_at"],
        "createdAt": row["created_at"],
        "actor": creator_json(actor, user),
        "page": (
            {"id": row["page"]["id"], "title": row["page"]["title"], "slugId": row["page"]["slug_id"],
             "icon": row["page"]["icon"]}
            if row["page"] else None
        ),
        "space": row["space"],
    }


def _store(call: Call) -> NotificationStore:
    bind(call.ctx)
    return NotificationStore(call.store.database)


@router.post("notifications")
async def list_notifications(call: Call):
    store = _store(call)
    body = call.body
    limit = body.get("limit")
    items, nxt = await call.run(
        store.list, tab=body.get("type"), cursor=body.get("cursor"), limit=limit
    )
    return page_of([notification_json(r, call.user) for r in items], limit or 30, nxt)


@router.post("notifications/unread-count")
async def unread_count(call: Call):
    return {"count": await call.run(_store(call).unread_count)}


@router.post("notifications/mark-read")
async def mark_read(call: Call):
    ids = call.body.get("notificationIds")
    if not isinstance(ids, list):
        raise ApiError(400, "notificationIds is required")
    await call.run(_store(call).mark_read, [str(i) for i in ids])
    return None


@router.post("notifications/mark-all-read")
async def mark_all_read(call: Call):
    await call.run(_store(call).mark_all_read)
    return None


# -- watching ------------------------------------------------------------------


@router.post("pages/watch")
async def watch_page(call: Call):
    await call.run(_store(call).watch_page, str(call.need("pageId")))
    return {"watching": True}


@router.post("pages/unwatch")
async def unwatch_page(call: Call):
    await call.run(_store(call).unwatch_page, str(call.need("pageId")))
    return {"watching": False}


@router.post("pages/watch-status")
async def page_watch_status(call: Call):
    return {"watching": await call.run(_store(call).is_watching_page, str(call.need("pageId")))}


@router.post("spaces/watch")
async def watch_space(call: Call):
    ref = await call.run(call.store.get_space, str(call.need("spaceId")))
    await call.run(_store(call).watch_space, ref["id"])
    return {"watching": True}


@router.post("spaces/unwatch")
async def unwatch_space(call: Call):
    ref = await call.run(call.store.get_space, str(call.need("spaceId")))
    await call.run(_store(call).unwatch_space, ref["id"])
    return {"watching": False}


@router.post("spaces/watch-status")
async def space_watch_status(call: Call):
    ref = await call.run(call.store.get_space, str(call.need("spaceId")))
    return {"watching": await call.run(_store(call).is_watching_space, ref["id"])}


@router.post("spaces/watched-ids")
async def watched_space_ids(call: Call):
    ids = await call.run(_store(call).watched_space_ids)
    return page_of(ids, max(len(ids), 1))
