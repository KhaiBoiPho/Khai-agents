"""Comments: list, create (threads and replies), update, resolve, delete, info.

client-compatible shapes (see the client's comment types). Comment marks in
the page document are the editor's business (collab); the server only keeps
the comment rows and tells the user's other tabs through Socket.IO.
Mentions of the account and agent-written comments become notifications
(core.khaidocs.notifications) and ring the bell live.
"""

from __future__ import annotations

from app_server.khaidocs.api import ApiError, Call, KhaiUser, Router, camelize, page_of, to_json
from app_server.khaidocs.notifications import bind, creator_json
from core.khaidocs.comments import CommentStore, content_doc
from core.khaidocs.notifications import NotificationStore

router = Router()


def comment_json(row: dict, user: KhaiUser) -> dict:
    out = camelize(row, drop=("author",))
    # The client's editor reads the body as a ProseMirror document, not as text
    # (a string would be taken for HTML and rendered as literal JSON).
    doc = content_doc(row["content"])
    if isinstance(doc, dict):
        out["content"] = doc
    out["creatorId"] = user.id if row["author"] == "user" else "agent"
    out["creator"] = creator_json(row["author"], user)
    out["workspaceId"] = user.id
    out["author"] = row["author"]
    out["resolvedById"] = user.id if row["resolved_at"] else None
    out["resolvedBy"] = creator_json("user", user) if row["resolved_at"] else None
    return to_json(out)  # ISO times: the dict is also published over Socket.IO


def _stores(call: Call) -> tuple[CommentStore, NotificationStore]:
    bind(call.ctx)
    return CommentStore(call.store.database), NotificationStore(call.store.database)


@router.post("comments")
async def list_comments(call: Call):
    comments, _ = _stores(call)
    limit = call.body.get("limit")
    items, nxt = await call.run(
        comments.list, str(call.need("pageId")), cursor=call.body.get("cursor"), limit=limit
    )
    return page_of([comment_json(r, call.user) for r in items], limit or 100, nxt)


@router.post("comments/info")
async def info(call: Call):
    comments, _ = _stores(call)
    return comment_json(await call.run(comments.get, str(call.need("commentId"))), call.user)


@router.post("comments/create")
async def create(call: Call):
    comments, notifications = _stores(call)
    body = call.body
    content = body.get("content")
    if not isinstance(content, str):
        raise ApiError(400, "content is required")
    yjs = body.get("yjsSelection")
    row = await call.run(
        comments.create, str(call.need("pageId")), content,
        parent_comment_id=body.get("parentCommentId") or None,
        selection=body.get("selection"), kind=body.get("type"),
        yjs_selection=yjs if isinstance(yjs, dict) else None,
    )
    await call.run(notifications.on_comment, row)
    out = comment_json(row, call.user)
    call.publish({"operation": "commentCreated", "pageId": row["page_id"], "comment": out})
    return out


@router.post("comments/update")
async def update(call: Call):
    comments, _ = _stores(call)
    content = call.body.get("content")
    if not isinstance(content, str):
        raise ApiError(400, "content is required")
    row = await call.run(comments.update, str(call.need("commentId")), content)
    out = comment_json(row, call.user)
    call.publish({"operation": "commentUpdated", "pageId": row["page_id"], "comment": out})
    return out


@router.post("comments/resolve")
async def resolve(call: Call):
    comments, _ = _stores(call)
    resolved = call.body.get("resolved")
    if not isinstance(resolved, bool):
        raise ApiError(400, "resolved is required")
    row = await call.run(comments.resolve, str(call.need("commentId")), resolved)
    out = comment_json(row, call.user)
    call.publish({"operation": "commentResolved", "pageId": row["page_id"], "comment": out})
    return out


@router.post("comments/delete")
async def delete(call: Call):
    comments, _ = _stores(call)
    row = await call.run(comments.delete, str(call.need("commentId")))
    call.publish({"operation": "commentDeleted", "pageId": row["page_id"], "commentId": row["id"]})
    return None
