"""The signed-in Khai user and the one workspace the UI shows.

Identity is read-only here: the account (name, role) is Khai's, edited in
Khai's own settings; KhaiDocs only stores its preferences (page width,
editing mode, toolbar, notification toggles).
"""

from __future__ import annotations

from aiohttp import web

from app_server.khaidocs.api import ApiError, Call, Router, page_of
from app_server.khaidocs.serialize import person, user_json, version_json, workspace_json

router = Router()


def avatar_ref(prefs: dict) -> str | None:
    return (prefs.get("settings") or {}).get("avatar")


async def _me(call: Call) -> tuple[dict, dict]:
    default = await call.run(call.store.ensure_default_space)
    prefs = await call.run(call.store.get_settings)
    user = user_json(call.user, prefs, avatar_ref(prefs))
    workspace = workspace_json(call.user, default["id"], prefs)
    workspace["logo"] = (prefs.get("workspace") or {}).get("logo")
    return user, workspace


@router.get("health")
async def health(call: Call):
    return web.json_response({"status": "ok"})


@router.post("users/me")
async def me(call: Call):
    user, workspace = await _me(call)
    return {"user": user, "workspace": workspace}


@router.post("users/update")
async def update_me(call: Call):
    body = call.body
    preferences = {k: body[k] for k in ("fullPageWidth", "pageEditMode", "editorToolbar") if k in body}
    toggles = {
        "page.updated": "notificationPageUpdates",
        "page.userMention": "notificationPageUserMention",
        "comment.userMention": "notificationCommentUserMention",
        "comment.created": "notificationCommentCreated",
        "comment.resolved": "notificationCommentResolved",
    }
    notifications = {key: bool(body[field]) for key, field in toggles.items() if field in body}
    patch: dict = {}
    if preferences:
        patch["preferences"] = preferences
    if notifications:
        patch["notifications"] = notifications
    locale = body.get("locale") if isinstance(body.get("locale"), str) else None
    timezone = body.get("timezone") if isinstance(body.get("timezone"), str) else None
    prefs = await call.run(
        call.store.update_settings, settings=patch or None, locale=locale, timezone=timezone
    )
    return user_json(call.user, prefs, avatar_ref(prefs))


@router.post("workspace/info")
async def workspace_info(call: Call):
    return (await _me(call))[1]


@router.post("workspace/public")
async def workspace_public(call: Call):
    workspace = (await _me(call))[1]
    return {
        "id": workspace["id"], "name": workspace["name"], "logo": workspace["logo"],
        "hostname": "", "enforceSso": False, "authProviders": [],
    }


@router.post("workspace/update")
async def workspace_update(call: Call):
    body = call.body
    patch = {k: body[k] for k in ("name", "description") if isinstance(body.get(k), str)}
    if patch:
        await call.run(call.store.update_settings, workspace=patch)
    return (await _me(call))[1]


@router.post("workspace/members")
async def workspace_members(call: Call):
    me = {
        **person(call.user), "email": f"{call.user.username}@khai", "role": "owner",
        "createdAt": None, "lastActiveAt": None, "deactivatedAt": None,
    }
    return page_of([me], 100)


@router.post("version")
async def version(call: Call):
    return version_json()


@router.post("workspace/check-hostname")
async def check_hostname(call: Call):
    return {"hostname": ""}


@router.post("workspace/members/delete")
@router.post("workspace/members/deactivate")
@router.post("workspace/members/activate")
@router.post("workspace/members/change-role")
@router.post("workspace/invites/create")
@router.post("workspace/invites/resend")
@router.post("workspace/invites/revoke")
@router.post("workspace/invites/link")
@router.post("workspace/create")
async def single_user(call: Call):
    raise ApiError(400, "KhaiDocs belongs to your Khai account; it has no other members")


@router.post("workspace/invites")
@router.post("groups")
@router.post("groups/members")
@router.post("shares")
@router.post("public-spaces")
async def empty_list(call: Call):
    return page_of([], 100)


@router.post("public-spaces/for-space")
async def no_public_space(call: Call):
    return None
