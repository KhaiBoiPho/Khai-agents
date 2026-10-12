"""Endpoints the UI may call that KhaiDocs does not serve (yet).

Registered after every real module, so a module that implements one of these
paths wins automatically. Three kinds:

* disabled   : sharing, public spaces, groups, extra members. Always 404/400
               with a plain message (the UI hides those screens; they are
               only reachable by typing a URL).
* empty      : lists and counters for features phase 2 fills in (labels,
               notifications, watchers, comments, file tasks, transclusions).
* not ready  : import / export (501 until the import-export module exists).
"""

from __future__ import annotations

from app_server.khaidocs.api import ApiError, Call, Router, page_of

router = Router()

NOT_AVAILABLE = "Not available in KhaiDocs"
NOT_READY = "Not available yet"


def _disabled(path: str, message: str = NOT_AVAILABLE, status: int = 404) -> None:
    async def handler(call: Call):
        raise ApiError(status, message)

    router.post(path)(handler)


def _constant(path: str, value) -> None:
    async def handler(call: Call):
        return value() if callable(value) else value

    router.post(path)(handler)


for _path in (
    "shares/info", "shares/for-page", "shares/page-info", "shares/tree",
    "shares/create", "shares/update", "shares/delete", "shares/transclusion/lookup",
    "public-spaces/info", "public-spaces/tree", "public-spaces/page", "public-spaces/directory",
    "public-spaces/publish", "public-spaces/transclusion/lookup", "search/share-search",
    "search/public-space-search", "groups/info", "groups/create", "groups/update",
    "groups/delete", "groups/members/add", "groups/members/remove",
    "workspace/invites/info", "workspace/invites/accept", "bases/create", "bases/export-csv",
):
    _disabled(_path)

for _path in (
    "pages/export", "spaces/export", "docx-export", "pages/import", "pages/import-zip",
):
    _disabled(_path, NOT_READY, 501)

_empty = lambda: page_of([], 50)  # noqa: E731
for _path in (
    "pages/labels", "labels", "labels/pages", "notifications", "comments",
    "file-tasks", "spaces/watched-ids",
):
    _constant(_path, _empty)

_constant("notifications/unread-count", {"count": 0})
_constant("notifications/mark-read", None)
_constant("notifications/mark-all-read", None)
_constant("pages/watch-status", {"watching": False})
_constant("spaces/watch-status", {"watching": False})
_constant("pages/watch", {"watching": False})
_constant("pages/unwatch", {"watching": False})
_constant("spaces/watch", {"watching": False})
_constant("spaces/unwatch", {"watching": False})
_constant("labels/info", {"name": "", "usageCount": 0})
_constant("pages/transclusion/lookup", {"items": []})
_constant("pages/transclusion/references", {"pages": []})


@router.post("pages/labels/add")
@router.post("pages/labels/remove")
@router.post("comments/create")
@router.post("comments/update")
@router.post("comments/resolve")
@router.post("comments/delete")
@router.post("comments/info")
@router.post("file-tasks/info")
@router.post("pages/transclusion/unsync-reference")
async def not_ready(call: Call):
    raise ApiError(501, NOT_READY)
