"""``/api/planner/*``: the planner documents of the signed-in user.

Mounted next to KhaiDocs and through the same plumbing (app_server.khaidocs.api):
the caller is whoever the browser session says, never a field of the body.

* ``planner/read``     ``{keys?: [...]}`` -> ``{documents: {key: {value, version,
  updatedBy, updatedAt}}}``
* ``planner/versions`` ``{}`` -> ``{versions: {key: n}}`` (what open tabs poll)
* ``planner/write``    ``{key, value, baseVersion}`` -> the stored document;
  409 with ``current`` when the document moved on since ``baseVersion``.
"""

from __future__ import annotations

from typing import Any

from aiohttp import web

from app_server.khaidocs.api import ApiError, Call, Raw, Router, mount, to_json
from core.planner import PLANNER_KEYS, PlannerConflict, PlannerError, PlannerStore

router = Router()


def _store(call: Call) -> PlannerStore:
    return PlannerStore(call.ctx.database.for_user(call.user.id))


async def _guard(call: Call, function, *args: Any, **kwargs: Any) -> Any:
    try:
        return await call.run(function, *args, **kwargs)
    except PlannerConflict as exc:
        return Raw(
            web.json_response(
                {"message": str(exc), "error": "Conflict", "statusCode": 409,
                 "current": to_json(exc.current)},
                status=409,
            )
        )
    except PlannerError as exc:
        raise ApiError(400, str(exc)) from None


@router.post("planner/read")
async def read(call: Call) -> Any:
    keys = call.body.get("keys") or list(PLANNER_KEYS)
    if not isinstance(keys, list) or not all(isinstance(key, str) for key in keys):
        raise ApiError(400, "keys must be a list of names")
    documents = await _guard(call, _store(call).read, keys)
    return documents if isinstance(documents, Raw) else {"documents": documents}


@router.post("planner/versions")
async def versions(call: Call) -> Any:
    return {"versions": await call.run(_store(call).versions)}


@router.post("planner/write")
async def write(call: Call) -> Any:
    key = call.body.get("key")
    if not isinstance(key, str):
        raise ApiError(400, "key is required")
    if "value" not in call.body:
        raise ApiError(400, "value is required")
    base = call.body.get("baseVersion")
    if base is not None and not isinstance(base, int):
        raise ApiError(400, "baseVersion must be an integer or null")
    return await _guard(
        call, _store(call).write, key, call.body["value"], base_version=base, by="user"
    )


def install(app: web.Application, ctx: Any) -> None:
    defs: list[web.RouteDef] = []
    mount(defs, router, ctx)
    app.add_routes(defs)
