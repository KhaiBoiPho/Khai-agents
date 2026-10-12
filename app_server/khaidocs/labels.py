"""Page labels and backlinks.

labels, labels/info, labels/pages, pages/labels, pages/labels/add|remove, and
(page metadata that lives in kd_backlinks) pages/backlinks-count and
pages/backlinks. See core.khaidocs.labels / core.khaidocs.backlinks.
"""

from __future__ import annotations

from app_server.khaidocs.api import ApiError, Call, Router, camelize, page_of
from app_server.khaidocs.serialize import person
from core.khaidocs.backlinks import BacklinkStore
from core.khaidocs.labels import LabelStore

router = Router()


def label_json(row: dict, call: Call) -> dict:
    out = camelize(row)
    out["workspaceId"] = call.user.id
    return out


@router.post("pages/labels")
async def page_labels(call: Call):
    rows = await call.run(LabelStore(call.store.database).page_labels, str(call.need("pageId")))
    return page_of([label_json(r, call) for r in rows], max(len(rows), 1))


@router.post("pages/labels/add")
async def add(call: Call):
    names = call.body.get("names")
    if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
        raise ApiError(400, "names is required")
    rows = await call.run(LabelStore(call.store.database).add_to_page, str(call.need("pageId")), names)
    return [label_json(r, call) for r in rows]


@router.post("pages/labels/remove")
async def remove(call: Call):
    await call.run(
        LabelStore(call.store.database).remove_from_page,
        str(call.need("pageId")), str(call.need("labelId")),
    )
    return None


@router.post("labels")
async def labels(call: Call):
    limit = call.body.get("limit")
    rows, nxt = await call.run(
        LabelStore(call.store.database).search, call.body.get("type") or "page",
        query=call.body.get("query"), cursor=call.body.get("cursor"), limit=limit,
    )
    return page_of([label_json(r, call) for r in rows], limit or 50, nxt)


@router.post("labels/info")
async def info(call: Call):
    row = await call.run(
        LabelStore(call.store.database).info, str(call.need("name")),
        call.body.get("type") or "page", space_id=call.body.get("spaceId"),
    )
    return camelize(row)


@router.post("labels/pages")
async def pages(call: Call):
    limit = call.body.get("limit")
    rows, nxt = await call.run(
        LabelStore(call.store.database).pages, label_id=call.body.get("labelId"),
        name=call.body.get("name"), space_id=call.body.get("spaceId"),
        cursor=call.body.get("cursor"), limit=limit,
    )
    creator = person(call.user)
    items = [{**camelize(r), "creator": {**creator}} for r in rows]
    return page_of(items, limit or 50, nxt)


@router.post("pages/backlinks-count")
async def backlinks_count(call: Call):
    return await call.run(BacklinkStore(call.store.database).counts, str(call.need("pageId")))


@router.post("pages/backlinks")
async def backlinks(call: Call):
    limit = call.body.get("limit")
    rows, nxt = await call.run(
        BacklinkStore(call.store.database).list, str(call.need("pageId")),
        call.body.get("direction") or "incoming", cursor=call.body.get("cursor"), limit=limit,
    )
    return page_of([camelize(r) for r in rows], limit or 50, nxt)
