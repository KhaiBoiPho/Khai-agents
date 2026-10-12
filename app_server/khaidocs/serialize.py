"""Store rows -> the JSON the KhaiDocs client reads (camelCase, the client's shapes)."""

from __future__ import annotations

from typing import Any

from app_server.khaidocs.api import KhaiUser, camelize
from core.version import __version__

WORKSPACE_NAME = "Khai"
# What the space's single member may do (CASL rules the client evaluates).
SPACE_PERMISSIONS = [
    {"action": "manage", "subject": "settings"},
    {"action": "manage", "subject": "page"},
]
DEFAULT_PREFERENCES = {"fullPageWidth": False, "pageEditMode": "edit", "editorToolbar": True}


def person(user: KhaiUser, avatar: str | None = None) -> dict:
    return {"id": user.id, "name": user.display_name, "avatarUrl": avatar}


def user_json(user: KhaiUser, prefs: dict, avatar: str | None = None) -> dict:
    settings = prefs.get("settings") or {}
    preferences = {**DEFAULT_PREFERENCES, **(settings.get("preferences") or {})}
    notifications = settings.get("notifications") or {}
    created = user.created_at.isoformat().replace("+00:00", "Z") if user.created_at else None
    return {
        "id": user.id,
        "name": user.display_name,
        "email": f"{user.username}@khai",
        "emailVerifiedAt": created,
        "avatarUrl": avatar,
        "timezone": prefs.get("timezone") or "",
        "settings": {"preferences": preferences, "notifications": notifications},
        "invitedById": None,
        "lastLoginAt": None,
        "lastActiveAt": None,
        "locale": prefs.get("locale") or "en-US",
        "createdAt": created,
        "updatedAt": created,
        "role": "owner",
        "workspaceId": user.id,
        "deactivatedAt": None,
        "deletedAt": None,
        "fullPageWidth": preferences["fullPageWidth"],
        "pageEditMode": preferences["pageEditMode"],
        "editorToolbar": preferences["editorToolbar"],
        "notificationPageUpdates": notifications.get("page.updated", True),
        "notificationPageUserMention": notifications.get("page.userMention", True),
        "notificationCommentUserMention": notifications.get("comment.userMention", True),
        "notificationCommentCreated": notifications.get("comment.created", True),
        "notificationCommentResolved": notifications.get("comment.resolved", True),
        "hasGeneratedPassword": False,
    }


def workspace_json(user: KhaiUser, default_space_id: str | None, prefs: dict | None = None) -> dict:
    created = user.created_at.isoformat().replace("+00:00", "Z") if user.created_at else None
    stored = (prefs or {}).get("workspace") or {}
    return {
        "id": user.id,
        "name": stored.get("name") or WORKSPACE_NAME,
        "description": stored.get("description") or "",
        "logo": None,
        "hostname": "",
        "defaultSpaceId": default_space_id,
        "customDomain": None,
        "enableInvite": False,
        "settings": {
            "sharing": {"disabled": True},
            "publicSpaces": {"enabled": False, "directory": False},
            "spaces": {"allowPersonal": False},
            "defaultPageEditMode": "edit",
        },
        "status": None,
        "enforceSso": False,
        "createdAt": created,
        "updatedAt": created,
        "emailDomains": [],
        "memberCount": 1,
        "plan": "standard",
        "disablePublicSharing": True,
        "allowPublicSpaces": False,
        "publicSpacesDirectory": False,
        "defaultPageEditMode": "edit",
    }


def space_json(space: dict, user: KhaiUser, *, membership: bool = True) -> dict:
    out = {
        "id": space["id"],
        "name": space["name"],
        "description": space.get("description"),
        "logo": space.get("icon"),
        "slug": space["slug"],
        "isPersonal": False,
        "hostname": "",
        "creatorId": user.id,
        "createdAt": space["created_at"],
        "updatedAt": space["updated_at"],
        "memberCount": 1,
        "isPublished": False,
        "visibility": space.get("visibility", "private"),
        "defaultRole": space.get("default_role", "writer"),
        "workspaceId": user.id,
        "settings": space.get("settings")
        or {"sharing": {"disabled": True}, "comments": {"allowViewerComments": False}},
    }
    if membership:
        out["membership"] = {
            "userId": user.id,
            "role": "admin",
            "permissions": SPACE_PERMISSIONS,
        }
    return out


def space_ref(space: dict | None) -> dict | None:
    if space is None:
        return None
    return {
        "id": space["id"],
        "name": space["name"],
        "slug": space["slug"],
        "logo": space.get("icon"),
        "icon": space.get("icon"),
    }


def page_json(
    page: dict, user: KhaiUser, *, space: dict | None = None, content: bool = True,
    full: bool = False,
) -> dict:
    out: dict[str, Any] = {
        "id": page["id"],
        "slugId": page["slug_id"],
        "title": page["title"],
        "icon": page["icon"],
        "coverPhoto": page["cover_photo"],
        "position": page["position"],
        "parentPageId": page["parent_page_id"],
        "spaceId": page["space_id"],
        "creatorId": user.id,
        "lastUpdatedById": user.id,
        "workspaceId": user.id,
        "createdAt": page["created_at"],
        "updatedAt": page["updated_at"],
        "deletedAt": page["deleted_at"],
        "isLocked": page["is_locked"],
        "isBase": False,
        "hasChildren": bool(page.get("has_children")),
        "canEdit": True,
    }
    if content and "content" in page:
        out["content"] = page["content"]
    if "text_content" in page and full:
        out["textContent"] = page["text_content"]
    if full:
        out["creator"] = person(user)
        out["lastUpdatedBy"] = person(user)
        out["permissions"] = {"canEdit": True, "hasRestriction": False}
    if space is not None:
        out["space"] = space_ref(space)
    return out


def version_json() -> dict:
    return {"currentVersion": __version__, "latestVersion": __version__, "releaseUrl": ""}


__all__ = [
    "camelize", "page_json", "person", "space_json", "space_ref", "user_json",
    "version_json", "workspace_json",
]
