"""Pages: create, read, rename, trash, restore, move, duplicate, tree, recent,
history, attachments list. client-compatible shapes (see api.py)."""

from __future__ import annotations

from app_server.khaidocs.api import ApiError, Call, Router, camelize, page_of, to_json
from app_server.khaidocs.serialize import page_json, person, space_ref
from core.khaidocs.store import _UNSET

router = Router()


async def _spaces(call: Call) -> dict[str, dict]:
    return {s["id"]: s for s in await call.run(call.store.list_spaces)}


def _optional(body: dict, key: str):
    return body[key] if key in body else _UNSET


@router.post("pages/create")
async def create(call: Call):
    body = call.body
    content = body.get("content")
    page = await call.run(
        call.store.create_page,
        space_id=body.get("spaceId"),
        title=body.get("title"),
        parent_page_id=body.get("parentPageId"),
        icon=body.get("icon"),
        cover_photo=body.get("coverPhoto"),
        position=body.get("position"),
        content=content if isinstance(content, dict) else None,
        with_content=True,
    )
    spaces = await _spaces(call)
    return page_json(page, call.user, space=spaces.get(page["space_id"]), full=True)


@router.post("pages/info")
async def info(call: Call):
    page = await call.run(call.store.get_page, str(call.need("pageId")), include_deleted=True)
    spaces = await _spaces(call)
    out = page_json(page, call.user, space=spaces.get(page["space_id"]), full=True)
    if page["deleted_at"] is not None:
        out["canEdit"] = False
        out["permissions"] = {"canEdit": False, "hasRestriction": False}
        out["deletedBy"] = person(call.user)
    return out


@router.post("pages/update")
async def update(call: Call):
    body = call.body
    ref = str(call.need("pageId"))
    page = await call.run(
        call.store.update_page,
        ref,
        title=_optional(body, "title"),
        icon=_optional(body, "icon"),
        cover_photo=_optional(body, "coverPhoto"),
        is_locked=_optional(body, "isLocked"),
    )
    if "parentPageId" in body or "position" in body:
        kwargs = {}
        if "parentPageId" in body:
            kwargs["parent_page_id"] = body["parentPageId"]
        page = await call.run(call.store.move_page, ref, position=body.get("position"), **kwargs)
    spaces = await _spaces(call)
    return page_json(page, call.user, space=spaces.get(page["space_id"]), content=False, full=True)


@router.post("pages/delete")
async def delete(call: Call):
    ref = str(call.need("pageId"))
    if call.body.get("permanentlyDelete"):
        await call.run(call.store.delete_page, ref)
    else:
        await call.run(call.store.trash_page, ref)
    return None


@router.post("pages/restore")
async def restore(call: Call):
    page = await call.run(call.store.restore_page, str(call.need("pageId")))
    return page_json(page, call.user, content=False)


@router.post("pages/remove")
async def remove(call: Call):
    await call.run(call.store.delete_page, str(call.need("pageId")))
    return None


@router.post("pages/move")
async def move(call: Call):
    body = call.body
    kwargs = {}
    if "parentPageId" in body:
        kwargs["parent_page_id"] = body["parentPageId"]
    await call.run(
        call.store.move_page, str(call.need("pageId")), position=body.get("position"),
        after=body.get("after"), before=body.get("before"), **kwargs,
    )
    return None


@router.post("pages/move-to-space")
async def move_to_space(call: Call):
    await call.run(call.store.move_to_space, str(call.need("pageId")), str(call.need("spaceId")))
    return None


@router.post("pages/duplicate")
async def duplicate(call: Call):
    page = await call.run(
        call.store.duplicate_page, str(call.need("pageId")), space_id=call.body.get("spaceId")
    )
    spaces = await _spaces(call)
    return page_json(page, call.user, space=spaces.get(page["space_id"]), content=False)


@router.post("pages/breadcrumbs")
async def breadcrumbs(call: Call):
    pages = await call.run(call.store.breadcrumbs, str(call.need("pageId")))
    return [page_json(p, call.user, content=False) for p in pages]


@router.post("pages/sidebar-pages")
async def sidebar(call: Call):
    body = call.body
    if not body.get("spaceId") and not body.get("pageId"):
        raise ApiError(400, "spaceId or pageId is required")
    limit = int(body.get("limit") or 100)
    parent = body.get("pageId")
    items, cursor = await call.run(
        call.store.children,
        space_id=body.get("spaceId"),
        parent_page_id=parent,
        cursor=body.get("cursor"),
        limit=limit,
    )
    return page_of([page_json(p, call.user, content=False) for p in items], limit, cursor)


async def _listing(call: Call, fetch, **extra):
    limit = int(call.body.get("limit") or 15)
    items, cursor = await call.run(
        fetch, space_id=call.body.get("spaceId"), cursor=call.body.get("cursor"), limit=limit, **extra
    )
    spaces = await _spaces(call)
    return page_of(
        [page_json(p, call.user, space=spaces.get(p["space_id"]), content=False) for p in items],
        limit,
        cursor,
    )


@router.post("pages/recent")
async def recent(call: Call):
    return await _listing(call, call.store.recent)


@router.post("pages/created-by-user")
async def created_by(call: Call):
    return await _listing(call, call.store.recent)


@router.post("pages/trash")
async def trash(call: Call):
    limit = int(call.body.get("limit") or 50)
    items, cursor = await call.run(
        call.store.trash, space_id=call.body.get("spaceId"), cursor=call.body.get("cursor"), limit=limit
    )
    query = str(call.body.get("query") or "").strip().lower()
    out = []
    for p in items:
        if query and query not in (p["title"] or "").lower():
            continue
        row = page_json(p, call.user, content=False, full=True)
        row["deletedBy"] = person(call.user)
        out.append(row)
    return page_of(out, limit, cursor)


@router.post("pages/history")
async def history(call: Call):
    limit = 30
    items, cursor = await call.run(
        call.store.history, str(call.need("pageId")), cursor=call.body.get("cursor"), limit=limit
    )
    return page_of([_history_json(h, call.user) for h in items], limit, cursor)


@router.post("pages/history/info")
async def history_info(call: Call):
    entry = await call.run(call.store.history_entry, str(call.need("historyId")))
    return _history_json(entry, call.user)


def _history_json(h: dict, user) -> dict:
    out = {
        "id": h["id"],
        "pageId": h["page_id"],
        "title": h["title"],
        "icon": h["icon"],
        "coverPhoto": h["cover_photo"],
        "version": h["version"],
        "lastUpdatedById": user.id,
        "workspaceId": user.id,
        "createdAt": h["created_at"],
        "updatedAt": h["created_at"],
        "lastUpdatedBy": person(user),
        "contributors": [person(user)],
    }
    if "content" in h:
        out["content"] = h["content"]
    return out


@router.post("pages/attachments")
async def page_attachments(call: Call):
    limit = int(call.body.get("limit") or 50)
    items, cursor = await call.run(
        call.store.page_attachments, str(call.need("pageId")), cursor=call.body.get("cursor"), limit=limit
    )
    out = []
    for a in items:
        row = camelize(a)
        row["workspaceId"] = call.user.id
        row["creatorId"] = call.user.id
        row["url"] = f"/api/files/{a['id']}/{a['file_name']}"
        row["creator"] = person(call.user)
        out.append(row)
    return page_of(out, limit, cursor)


@router.post("pages/backlinks-count")
async def backlinks_count(call: Call):
    return {"incoming": 0, "outgoing": 0}


@router.post("pages/backlinks")
async def backlinks(call: Call):
    return page_of([], 50)


__all__ = ["router", "to_json", "space_ref"]
