"""Spaces, favorites, and the single member of a space."""

from __future__ import annotations

from app_server.khaidocs.api import ApiError, Call, Router, page_of
from app_server.khaidocs.serialize import page_json, person, space_json
from core.khaidocs.store import _UNSET

router = Router()


@router.post("spaces")
async def list_spaces(call: Call):
    spaces = await call.run(call.store.list_spaces, query=call.body.get("query") or None)
    return page_of([space_json(s, call.user) for s in spaces], int(call.body.get("limit") or 100))


@router.post("spaces/info")
async def info(call: Call):
    space = await call.run(call.store.get_space, str(call.need("spaceId")))
    return space_json(space, call.user)


@router.post("spaces/create")
async def create(call: Call):
    body = call.body
    space = await call.run(
        call.store.create_space, str(body.get("name") or ""), slug=body.get("slug"),
        description=body.get("description"),
    )
    return space_json(space, call.user)


@router.post("spaces/update")
async def update(call: Call):
    body = call.body
    space = await call.run(
        call.store.update_space,
        str(call.need("spaceId")),
        name=body["name"] if "name" in body else _UNSET,
        slug=body["slug"] if "slug" in body else _UNSET,
        description=body["description"] if "description" in body else _UNSET,
    )
    return space_json(space, call.user)


@router.post("spaces/delete")
async def delete(call: Call):
    await call.run(call.store.delete_space, str(call.need("spaceId")))
    return None


# A space belongs to its owner alone: the member list is the owner, read-only.


@router.post("spaces/members")
async def members(call: Call):
    await call.run(call.store.get_space, str(call.need("spaceId")))
    me = {**person(call.user), "email": f"{call.user.username}@khai", "type": "user", "role": "admin"}
    return page_of([me], 100)


@router.post("spaces/members/add")
@router.post("spaces/members/remove")
@router.post("spaces/members/change-role")
async def members_change(call: Call):
    raise ApiError(400, "A space is private to its owner; it has no other members")


# -- favorites ---------------------------------------------------------------------


def _target(call: Call) -> tuple[str, str]:
    kind = str(call.need("type"))
    key = {"page": "pageId", "space": "spaceId", "template": "templateId"}.get(kind)
    if key is None:
        raise ApiError(400, "invalid favorite type")
    return kind, str(call.need(key))


@router.post("favorites/add")
async def favorites_add(call: Call):
    kind, target = _target(call)
    await call.run(call.store.add_favorite, kind, target)
    return None


@router.post("favorites/remove")
async def favorites_remove(call: Call):
    kind, target = _target(call)
    await call.run(call.store.remove_favorite, kind, target)
    return None


@router.post("favorites/ids")
async def favorites_ids(call: Call):
    ids = await call.run(
        call.store.favorite_ids, str(call.need("type")), space_id=call.body.get("spaceId")
    )
    return page_of(ids, max(len(ids), 1))


@router.post("favorites")
async def favorites(call: Call):
    limit = int(call.body.get("limit") or 50)
    items, cursor = await call.run(
        call.store.list_favorites, kind=call.body.get("type"), space_id=call.body.get("spaceId"),
        cursor=call.body.get("cursor"), limit=limit,
    )
    out = []
    for f in items:
        row = {
            "id": f["id"], "userId": call.user.id, "pageId": f["page_id"],
            "spaceId": f["space_id"], "templateId": f["template_id"], "type": f["type"],
            "workspaceId": call.user.id, "createdAt": f["created_at"],
        }
        if f["page"]:
            row["page"] = {
                "id": f["page"]["id"], "slugId": f["page"]["slug_id"], "title": f["page"]["title"],
                "icon": f["page"]["icon"], "isBase": False, "spaceId": f["page"]["space_id"],
            }
        if f["space"]:
            row["space"] = {
                "id": f["space"]["id"], "name": f["space"]["name"], "slug": f["space"]["slug"],
                "logo": f["space"]["icon"],
            }
        out.append(row)
    return page_of(out, limit, cursor)


__all__ = ["router", "page_json"]
