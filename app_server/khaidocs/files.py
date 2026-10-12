"""Attachment upload and download.

Bytes live in Postgres (kd_attachment_blobs), so they are covered by the
tenant's row-level security and the database backup, and need no per-user
directory in the gateway. The size limit (KHAIDOCS_MAX_UPLOAD_MB, default 50)
is enforced while streaming, before anything is stored.

Downloads are authenticated by the Khai session like every other call. What
a browser may render inline is a short allow-list of media types; anything
else is forced to ``application/octet-stream`` with ``Content-Disposition:
attachment`` so an uploaded HTML page can never run under the app's origin.
SVG (scriptable) is served inline only inside a locked-down CSP sandbox.
"""

from __future__ import annotations

import mimetypes
import re
from urllib.parse import quote

from aiohttp import web

from app_server.khaidocs.api import ApiError, Call, Raw, Router, camelize, to_json
from core.khaidocs import store as store_module

router = Router()

INLINE_TYPES = frozenset(
    {
        "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp",
        "image/x-icon", "image/vnd.microsoft.icon", "application/pdf",
        "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm", "audio/x-wav",
        "audio/aac", "audio/flac", "video/mp4", "video/webm", "video/ogg", "video/quicktime",
    }
)
MAX_FIELD = 4096
ICON_LIMIT = 10 * 1024 * 1024
_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


def _attachment_json(item: dict, call: Call) -> dict:
    row = camelize(item)
    row["workspaceId"] = call.user.id
    row["creatorId"] = call.user.id
    return row


def guess_type(file_name: str, declared: str | None) -> str:
    guessed, _ = mimetypes.guess_type(file_name)
    declared = (declared or "").split(";")[0].strip().lower()
    return guessed or (declared if re.fullmatch(r"[a-z0-9.+-]+/[a-z0-9.+-]+", declared) else "") \
        or "application/octet-stream"


async def read_upload(call: Call, file_field: str, *, limit: int) -> tuple[dict[str, str], str, bytes, str]:
    """(fields, file name, bytes, declared type) of a multipart upload, read
    with a hard size limit."""

    request = call.request
    if request.content_type != "multipart/form-data":
        raise ApiError(415, "multipart/form-data required")
    if request.content_length is not None and request.content_length > limit + 64 * 1024:
        raise ApiError(413, f"File exceeds the {limit // (1024 * 1024)} MB limit")
    reader = await request.multipart()
    fields: dict[str, str] = {}
    name, data, declared = "", b"", ""
    async for part in reader:
        if part.name == file_field and part.filename is not None:
            name = part.filename
            declared = part.headers.get("Content-Type", "")
            buffer = bytearray()
            while chunk := await part.read_chunk(256 * 1024):
                buffer += chunk
                if len(buffer) > limit:
                    raise ApiError(413, f"File exceeds the {limit // (1024 * 1024)} MB limit")
            data = bytes(buffer)
        elif part.name:
            fields[part.name] = (await part.read(decode=True))[:MAX_FIELD].decode("utf-8", "replace")
    if not name:
        raise ApiError(400, "No file was uploaded")
    return fields, name, data, declared


@router.post("files/upload")
async def upload(call: Call):
    limit = store_module.MAX_ATTACHMENT_BYTES
    fields, name, data, declared = await read_upload(call, "file", limit=limit)
    if not fields.get("pageId"):
        raise ApiError(400, "pageId is required")
    saved = await call.run(
        call.store.save_attachment,
        file_name=name, data=data, mime_type=guess_type(name, declared),
        page_id=fields["pageId"], attachment_id=fields.get("attachmentId") or None,
    )
    return Raw(_json(_attachment_json(saved, call)))


@router.post("attachments/upload-image")
async def upload_image(call: Call):
    fields, name, data, declared = await read_upload(call, "image", limit=ICON_LIMIT)
    kind = fields.get("type", "")
    mime = guess_type(name, declared)
    if kind not in ("avatar", "space-icon", "workspace-icon"):
        raise ApiError(400, "invalid icon type")
    if mime not in ("image/png", "image/jpeg", "image/gif", "image/webp"):
        raise ApiError(415, "Icons must be PNG, JPEG, GIF or WebP images")
    space_id = fields.get("spaceId") or None
    if kind == "space-icon" and not space_id:
        raise ApiError(400, "spaceId is required")
    await call.run(call.store.remove_icon, kind, space_id=space_id)
    saved = await call.run(
        call.store.save_attachment, file_name=name, data=data, mime_type=mime,
        space_id=space_id, kind=kind,
    )
    ref = f"{saved['id']}{saved['file_ext']}"
    if kind == "space-icon":
        await call.run(call.store.update_space, space_id, icon=ref)
    elif kind == "avatar":
        await call.run(call.store.update_settings, settings={"avatar": ref})
    else:
        await call.run(call.store.update_settings, workspace={"logo": ref})
    return Raw(_json(_attachment_json(saved, call)))


@router.post("attachments/remove-icon")
async def remove_icon(call: Call):
    kind = str(call.need("type"))
    await call.run(call.store.remove_icon, kind, space_id=call.body.get("spaceId"))
    if kind == "avatar":
        await call.run(call.store.update_settings, settings={"avatar": None})
    elif kind == "workspace-icon":
        await call.run(call.store.update_settings, workspace={"logo": None})
    return None


@router.post("files/info")
async def info(call: Call):
    item = await call.run(call.store.get_attachment, str(call.need("attachmentId")))
    return _attachment_json(item, call)


@router.get("files/{id}/{name:.*}")
async def download(call: Call):
    item, data = await call.run(call.store.read_attachment, call.request.match_info["id"])
    return _serve(call.request, item, data, force_download=call.request.query.get("download") == "1")


@router.get("files/{id}")
async def download_by_id(call: Call):
    item, data = await call.run(call.store.read_attachment, call.request.match_info["id"])
    return _serve(call.request, item, data)


@router.get("attachments/img/{type}/{name:.*}")
async def image(call: Call):
    attachment_id = call.request.match_info["name"].split(".")[0]
    item, data = await call.run(call.store.read_attachment, attachment_id)
    if item["type"] not in ("avatar", "space-icon", "workspace-icon"):
        raise ApiError(404, "Attachment not found")
    return _serve(call.request, item, data)


def _json(payload: dict) -> web.Response:
    import json

    return web.json_response(to_json(payload), dumps=lambda o: json.dumps(o, ensure_ascii=False))


def _content_disposition(kind: str, file_name: str) -> str:
    ascii_name = re.sub(r"[^A-Za-z0-9._ -]", "_", file_name)[:100] or "file"
    return f"{kind}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(file_name, safe='')}"


def _serve(request: web.Request, item: dict, data: bytes, *, force_download: bool = False) -> web.StreamResponse:
    mime = item["mime_type"] if item["mime_type"] in INLINE_TYPES else None
    svg = item["mime_type"] == "image/svg+xml"
    headers = {
        "Cache-Control": "private, no-cache",
        "ETag": f'"{item["id"]}-{int(item["updated_at"].timestamp() * 1000)}-{item["file_size"]}"',
        "Accept-Ranges": "bytes",
    }
    if request.headers.get("If-None-Match") == headers["ETag"]:
        return web.Response(status=304, headers={"ETag": headers["ETag"]})
    if (mime or svg) and not force_download:
        headers["Content-Disposition"] = _content_disposition("inline", item["file_name"])
        content_type = "image/svg+xml" if svg else mime
        if svg:
            headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'"
    else:
        headers["Content-Disposition"] = _content_disposition("attachment", item["file_name"])
        content_type = "application/octet-stream"
    total = len(data)
    status, body = 200, data
    match = _RANGE.match(request.headers.get("Range", ""))
    if match and total and (match.group(1) or match.group(2)):
        if match.group(1):
            start = int(match.group(1))
            end = min(int(match.group(2)) if match.group(2) else total - 1, total - 1)
        else:
            start, end = max(0, total - int(match.group(2))), total - 1
        if start > end or start >= total:
            return web.Response(status=416, headers={"Content-Range": f"bytes */{total}"})
        status, body = 206, data[start : end + 1]
        headers["Content-Range"] = f"bytes {start}-{end}/{total}"
    return web.Response(status=status, body=body, content_type=content_type, headers=headers)
