"""Search and mention/link suggestions."""

from __future__ import annotations

from app_server.khaidocs.api import Call, Router
from app_server.khaidocs.serialize import page_json, space_ref

router = Router()


@router.post("search")
async def search(call: Call):
    body = call.body
    hits = await call.run(
        call.store.search,
        str(body.get("query") or ""),
        space_id=body.get("spaceId"),
        title_only=bool(body.get("titleOnly")),
        limit=int(body.get("limit") or 25),
        offset=int(body.get("offset") or 0),
    )
    spaces = {s["id"]: s for s in await call.run(call.store.list_spaces)}
    items = []
    for h in hits:
        items.append({
            "id": h["id"], "title": h["title"], "icon": h["icon"],
            "parentPageId": h["parent_page_id"], "slugId": h["slug_id"],
            "creatorId": call.user.id, "createdAt": h["created_at"], "updatedAt": h["updated_at"],
            "rank": f"{h['rank']:.6f}", "highlight": h["highlight"], "matchedText": [],
            "wholeWord": False, "space": space_ref(spaces.get(h["space_id"])) or {},
        })
    return {"items": items}


@router.post("search/suggest")
async def suggest(call: Call):
    body = call.body
    out: dict = {"users": [], "groups": [], "pages": []}
    query = str(body.get("query") or "")
    if body.get("includeUsers") and query.strip():
        needle = query.strip().lower()
        if needle in call.user.display_name.lower() or needle in call.user.username.lower():
            out["users"] = [{
                "id": call.user.id, "name": call.user.display_name,
                "email": f"{call.user.username}@khai", "avatarUrl": None,
            }]
    if body.get("includePages", True):
        hits = await call.run(
            call.store.search, query, space_id=body.get("spaceId"), title_only=True,
            limit=int(body.get("limit") or 10),
        ) if query.strip() else (await call.run(
            call.store.recent, space_id=body.get("spaceId"), limit=int(body.get("limit") or 10)
        ))[0]
        out["pages"] = [page_json(h, call.user, content=False) for h in hits]
    return out


@router.post("search-attachments")
async def search_attachments(call: Call):
    body = call.body
    rows = await call.run(
        call.store.search_attachments, str(body.get("query") or ""),
        space_id=body.get("spaceId"), limit=int(body.get("limit") or 25),
    )
    items = [{
        "id": r["id"], "fileName": r["file_name"], "pageId": r["page_id"],
        "creatorId": call.user.id, "createdAt": r["created_at"], "updatedAt": r["updated_at"],
        "rank": "0", "highlight": "", "space": r["space"],
        "page": {"id": r["page"]["id"], "title": r["page"]["title"], "slugId": r["page"]["slug_id"]},
    } for r in rows]
    return {"items": items}
