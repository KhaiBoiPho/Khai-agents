"""Export (markdown, html, docx; page or space), import (md, html, txt, docx,
zip) and the file tasks that track zip imports.

* ``pages/export`` {pageId, format, includeChildren, includeAttachments},
  ``spaces/export`` {spaceId, format, includeAttachments}, ``docx-export``
  {pageId}: a download (single file, or a zip with the page tree and the
  attachments). The response is streamed from a temporary file; the file
  name travels percent-encoded in ``Content-Disposition: attachment;
  filename="..."`` as the client expects.
* ``pages/import`` (multipart: spaceId, file, optional parentPageId): one page.
* ``pages/import-zip`` (multipart: spaceId, source, file): the archive is
  stored in a file task and imported in the background (at most 2 imports
  run at once, 2 per user); ``file-tasks`` / ``file-tasks/info`` report
  ``pending -> processing -> success | failed`` with ``progress``.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import weakref
from urllib.parse import quote

from aiohttp import web

from app_server.khaidocs.api import ApiError, Call, Router, camelize, page_of
from app_server.khaidocs.files import read_upload
from app_server.khaidocs.serialize import page_json
from core.khaidocs.errors import KhaiDocsError
from core.khaidocs.exporter import Export, export_docx, export_pages
from core.khaidocs.importer import Importer
from core.khaidocs.templates import FileTaskStore

logger = logging.getLogger(__name__)
router = Router()

MAX_IMPORT_BYTES = int(float(os.environ.get("KHAIDOCS_MAX_IMPORT_MB", "200")) * 1024 * 1024)
MAX_FILE_BYTES = int(float(os.environ.get("KHAIDOCS_MAX_UPLOAD_MB", "50")) * 1024 * 1024)
MAX_TASKS_PER_USER = 2
CHUNK = 256 * 1024

_slots: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, dict[str, asyncio.Semaphore]]" = (
    weakref.WeakKeyDictionary()
)


def _slot(name: str, size: int) -> asyncio.Semaphore:
    """A concurrency limit per event loop (a semaphore binds to its loop)."""

    per_loop = _slots.setdefault(asyncio.get_running_loop(), {})
    return per_loop.setdefault(name, asyncio.Semaphore(size))


_active: dict[str, int] = {}
_background: set[asyncio.Task] = set()
_stale_checked: set[str] = set()


def content_disposition(file_name: str) -> str:
    return f'attachment; filename="{quote(file_name, safe="")}"'


async def stream_export(call: Call, export: Export) -> web.StreamResponse:
    response = web.StreamResponse(headers={
        "Content-Type": export.content_type,
        "Content-Length": str(export.size),
        "Content-Disposition": content_disposition(export.file_name),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    })
    try:
        await response.prepare(call.request)
        while chunk := await asyncio.to_thread(export.file.read, CHUNK):
            await response.write(chunk)
        await response.write_eof()
    finally:
        export.close()
    return response


def _format(call: Call) -> str:
    fmt = str(call.body.get("format") or "markdown").lower()
    if fmt not in ("markdown", "html"):
        raise ApiError(400, "format must be markdown or html")
    return fmt


async def _export(call: Call, function, *args, **kwargs) -> web.StreamResponse:
    async with _slot("export", 3):
        export = await call.run(function, *args, **kwargs)
    return await stream_export(call, export)


@router.post("pages/export")
async def export_page(call: Call):
    return await _export(
        call, export_pages, call.store, page_id=str(call.need("pageId")), fmt=_format(call),
        include_children=bool(call.body.get("includeChildren")),
        include_attachments=bool(call.body.get("includeAttachments")),
    )


@router.post("spaces/export")
async def export_space(call: Call):
    return await _export(
        call, export_pages, call.store, space_id=str(call.need("spaceId")), fmt=_format(call),
        include_attachments=bool(call.body.get("includeAttachments")),
    )


@router.post("docx-export")
async def docx_export(call: Call):
    return await _export(call, export_docx, call.store, str(call.need("pageId")))


# -- import -----------------------------------------------------------------------


@router.post("pages/import")
async def import_page(call: Call):
    fields, name, data, _ = await read_upload(call, "file", limit=MAX_FILE_BYTES)
    space_id = fields.get("spaceId") or None
    space = await call.run(call.store.get_space, space_id) if space_id else \
        await call.run(call.store.ensure_default_space)
    importer = Importer(call.store, space["id"], fields.get("parentPageId") or None)
    page = await call.run(importer.import_file, name, data)
    page = await call.run(call.store.get_page, page["id"], with_content=True)
    return page_json(page, call.user, space=space, full=True)


def _task_json(row: dict, call: Call) -> dict:
    out = camelize(row, drop=("options",))
    options = row.get("options") or {}
    out.update({
        "filePath": "", "creatorId": call.user.id, "workspaceId": call.user.id,
        "progress": options.get("progress"), "result": options.get("result"),
    })
    return out


async def _fail_stale(call: Call, tasks: FileTaskStore) -> None:
    """Tasks a previous process left running can never finish (once per user)."""

    if call.user.id not in _stale_checked and not _active.get(call.user.id):
        _stale_checked.add(call.user.id)
        await call.run(tasks.fail_stale)


@router.post("pages/import-zip")
async def import_zip(call: Call):
    tasks = FileTaskStore(call.store.database)
    await _fail_stale(call, tasks)
    if _active.get(call.user.id, 0) >= MAX_TASKS_PER_USER:
        raise ApiError(429, "Too many imports are running; try again when one has finished")
    fields, name, data, _ = await read_upload(call, "file", limit=MAX_IMPORT_BYTES)
    space_id = fields.get("spaceId") or None
    space = await call.run(call.store.get_space, space_id) if space_id else \
        await call.run(call.store.ensure_default_space)
    task = await call.run(
        tasks.create, kind="import", source=fields.get("source") or "generic", file_name=name,
        file_size=len(data), space_id=space["id"], data=data,
        options={"parentPageId": fields.get("parentPageId") or None},
    )
    _active[call.user.id] = _active.get(call.user.id, 0) + 1
    job = asyncio.create_task(_run_import(call, tasks, task, space["id"]))
    _background.add(job)
    job.add_done_callback(_background.discard)
    return _task_json(task, call)


async def _run_import(call: Call, tasks: FileTaskStore, task: dict, space_id: str) -> None:
    user_id = call.user.id
    try:
        async with _slot("import", 2):
            await call.run(tasks.update, task["id"], status="processing")
            last = [0.0]

            def progress(done: int, total: int) -> None:
                now = time.monotonic()
                if done >= total or now - last[0] > 0.5:
                    last[0] = now
                    tasks.update(task["id"], progress={"done": done, "total": total})

            def work() -> dict:
                data = tasks.load_data(task["id"])
                importer = Importer(call.store, space_id, (task["options"] or {}).get("parentPageId"))
                return importer.import_zip(data, source=task["source"], progress=progress)

            result = await asyncio.to_thread(work)
            await call.run(tasks.update, task["id"], status="success", result=result, drop_data=True)
            call.publish({"operation": "refetchRootTreeNodeEvent", "spaceId": space_id})
    except KhaiDocsError as exc:
        await _mark_failed(call, tasks, task["id"], str(exc))
    except Exception:
        logger.exception("KhaiDocs import task %s failed", task["id"])
        await _mark_failed(call, tasks, task["id"], "The archive could not be imported")
    finally:
        _active[user_id] = max(_active.get(user_id, 1) - 1, 0)


async def _mark_failed(call: Call, tasks: FileTaskStore, task_id: str, message: str) -> None:
    try:
        await call.run(tasks.update, task_id, status="failed", error=message, drop_data=True)
    except Exception:
        logger.exception("KhaiDocs could not record the failure of task %s", task_id)


@router.post("file-tasks")
async def list_tasks(call: Call):
    tasks = FileTaskStore(call.store.database)
    await _fail_stale(call, tasks)
    limit = call.body.get("limit")
    rows, nxt = await call.run(tasks.list, cursor=call.body.get("cursor"), limit=limit)
    return page_of([_task_json(r, call) for r in rows], limit or 50, nxt)


@router.post("file-tasks/info")
async def task_info(call: Call):
    tasks = FileTaskStore(call.store.database)
    await _fail_stale(call, tasks)
    return _task_json(await call.run(tasks.get, str(call.need("fileTaskId"))), call)
