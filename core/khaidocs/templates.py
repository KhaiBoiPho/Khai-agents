"""Server-side page templates (kd_templates) and file tasks (kd_file_tasks)."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

from psycopg.types.json import Jsonb

from core.khaidocs.errors import Invalid, NotFound
from core.khaidocs.store import _limit, _uuid, decode_cursor, encode_cursor
from core.persistence.database import Database

MAX_TEMPLATES = 500
MAX_TEMPLATE_BYTES = 2 * 1024 * 1024
_FIELDS = "id, title, description, icon, content, markdown, created_at, updated_at"


def _row(row) -> dict:
    out = {key: row[key] for key in row.keys()}
    out["id"] = str(out["id"])
    return out


def fill_placeholders(value: Any, now: datetime | None = None) -> Any:
    """``{{date}}`` -> today's date (YYYY-MM-DD), in strings of a JSON tree."""

    today = (now or datetime.now(UTC)).strftime("%Y-%m-%d")
    if isinstance(value, str):
        return re.sub(r"\{\{\s*date\s*\}\}", today, value)
    if isinstance(value, list):
        return [fill_placeholders(v, now) for v in value]
    if isinstance(value, dict):
        return {k: fill_placeholders(v, now) for k, v in value.items()}
    return value


class TemplateStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    def list(self, *, cursor: str | None = None, limit: int | None = None) -> tuple[list[dict], str | None]:
        size = _limit(limit, 100)
        after = decode_cursor(cursor)
        where, args = ["true"], []
        if after:
            where.append("(created_at, id::text) < (?, ?)")
            args += [datetime.fromisoformat(after[0]), after[1]]
        with self.database.read() as c:
            rows = c.execute(
                "SELECT id, title, description, icon, created_at, updated_at FROM kd_templates "
                f"WHERE {' AND '.join(where)} ORDER BY created_at DESC, id::text DESC LIMIT {size + 1}",
                args,
            ).fetchall()
        items = [_row(r) for r in rows]
        more = len(items) > size
        items = items[:size]
        return items, encode_cursor(items[-1]["created_at"], items[-1]["id"]) if more else None

    def get(self, template_id: str) -> dict:
        with self.database.read() as c:
            row = c.execute(
                f"SELECT {_FIELDS} FROM kd_templates WHERE id = ?", (_uuid(template_id, "templateId"),)
            ).fetchone()
        if row is None:
            raise NotFound("Template not found")
        return _row(row)

    def create(self, *, title: str, description: str | None = None, icon: str | None = None,
               content: dict | None = None, markdown: str | None = None) -> dict:
        if content is None and markdown is None:
            raise Invalid("content or markdown is required")
        if content is not None and not isinstance(content, dict):
            raise Invalid("content must be a ProseMirror document")
        if len(markdown or "") > MAX_TEMPLATE_BYTES:
            raise Invalid("template is too large")
        with self.database.transaction() as c:
            if int(c.execute("SELECT count(*) AS n FROM kd_templates").fetchone()["n"]) >= MAX_TEMPLATES:
                raise Invalid("Too many templates")
            row = c.execute(
                "INSERT INTO kd_templates (title, description, icon, content, markdown) "
                f"VALUES (?, ?, ?, ?, ?) RETURNING {_FIELDS}",
                ((title or "").strip()[:500] or "Untitled", description, icon,
                 Jsonb(content) if content is not None else None, markdown),
            ).fetchone()
        return _row(row)

    def update(self, template_id: str, **fields: Any) -> dict:
        sets, args = [], []
        for key in ("title", "description", "icon", "markdown"):
            if key in fields:
                sets.append(f"{key} = ?")
                args.append(fields[key])
        if "content" in fields:
            sets.append("content = ?")
            args.append(Jsonb(fields["content"]) if fields["content"] is not None else None)
        if not sets:
            return self.get(template_id)
        tid = _uuid(template_id, "templateId")
        with self.database.transaction() as c:
            row = c.execute(
                f"UPDATE kd_templates SET {', '.join(sets)}, updated_at = now() WHERE id = ? "
                f"RETURNING {_FIELDS}",
                (*args, tid),
            ).fetchone()
        if row is None:
            raise NotFound("Template not found")
        return _row(row)

    def delete(self, template_id: str) -> None:
        with self.database.transaction() as c:
            if c.execute("DELETE FROM kd_templates WHERE id = ?", (_uuid(template_id, "templateId"),)).rowcount == 0:
                raise NotFound("Template not found")


# ------------------------------------------------------------------ file tasks

TASK_TTL = timedelta(days=7)
_TASK_FIELDS = (
    "id, type, source, status, file_name, file_ext, file_size, options, error_message, space_id, "
    "created_at, updated_at, deleted_at"
)


def _task(row) -> dict:
    out = {key: row[key] for key in row.keys()}
    out["id"] = str(out["id"])
    if out.get("space_id") is not None:
        out["space_id"] = str(out["space_id"])
    return out


class FileTaskStore:
    """Import/export jobs. status: pending -> processing -> success | failed.
    ``options`` carries ``progress`` ({done, total}) and the import result."""

    def __init__(self, database: Database) -> None:
        self.database = database

    def create(self, *, kind: str, source: str | None, file_name: str, file_size: int,
               space_id: str | None, data: bytes | None, options: dict | None = None) -> dict:
        if kind not in ("import", "export"):
            raise Invalid("invalid task type")
        ext = re.sub(r"[^a-z0-9]", "", file_name.rsplit(".", 1)[-1].lower())[:10] if "." in file_name else ""
        with self.database.transaction() as c:
            c.execute(
                "DELETE FROM kd_file_tasks WHERE created_at < now() - ?::interval",
                (f"{int(TASK_TTL.total_seconds())} seconds",),
            )
            row = c.execute(
                "INSERT INTO kd_file_tasks (type, source, file_name, file_ext, file_size, options, "
                f"space_id, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING {_TASK_FIELDS}",
                (kind, source, file_name[:255], ext, file_size, Jsonb(options or {}),
                 _uuid(space_id, "spaceId"), data),
            ).fetchone()
        return _task(row)

    def get(self, task_id: str) -> dict:
        with self.database.read() as c:
            row = c.execute(
                f"SELECT {_TASK_FIELDS} FROM kd_file_tasks WHERE id = ? AND deleted_at IS NULL",
                (_uuid(task_id, "fileTaskId"),),
            ).fetchone()
        if row is None:
            raise NotFound("File task not found")
        return _task(row)

    def load_data(self, task_id: str) -> bytes:
        with self.database.read() as c:
            row = c.execute("SELECT data FROM kd_file_tasks WHERE id = ?", (_uuid(task_id),)).fetchone()
        if row is None or row["data"] is None:
            raise NotFound("File task has no data")
        return bytes(row["data"])

    def list(self, *, cursor: str | None = None, limit: int | None = None) -> tuple[list[dict], str | None]:
        size = _limit(limit, 50)
        after = decode_cursor(cursor)
        where, args = ["deleted_at IS NULL"], []
        if after:
            where.append("(created_at, id::text) < (?, ?)")
            args += [datetime.fromisoformat(after[0]), after[1]]
        with self.database.read() as c:
            rows = c.execute(
                f"SELECT {_TASK_FIELDS} FROM kd_file_tasks WHERE {' AND '.join(where)} "
                f"ORDER BY created_at DESC, id::text DESC LIMIT {size + 1}",
                args,
            ).fetchall()
        items = [_task(r) for r in rows]
        more = len(items) > size
        items = items[:size]
        return items, encode_cursor(items[-1]["created_at"], items[-1]["id"]) if more else None

    def update(self, task_id: str, *, status: str | None = None, error: str | None = None,
               progress: dict | None = None, result: dict | None = None,
               drop_data: bool = False) -> None:
        sets, args = ["updated_at = now()"], []
        if status:
            sets.append("status = ?")
            args.append(status)
        if error is not None:
            sets.append("error_message = ?")
            args.append(error[:2000])
        patch = {}
        if progress is not None:
            patch["progress"] = progress
        if result is not None:
            patch["result"] = result
        if patch:
            sets.append("options = options || ?")
            args.append(Jsonb(patch))
        if drop_data:
            sets.append("data = NULL")
        with self.database.transaction() as c:
            c.execute(f"UPDATE kd_file_tasks SET {', '.join(sets)} WHERE id = ?", (*args, _uuid(task_id)))

    def fail_stale(self) -> int:
        """Tasks left running by a previous process cannot finish: fail them."""

        with self.database.transaction() as c:
            return c.execute(
                "UPDATE kd_file_tasks SET status = 'failed', data = NULL, updated_at = now(), "
                "error_message = 'Interrupted by a restart' WHERE status IN ('pending', 'processing')"
            ).rowcount

    def delete(self, task_id: str) -> None:
        with self.database.transaction() as c:
            c.execute(
                "UPDATE kd_file_tasks SET deleted_at = now(), data = NULL WHERE id = ?", (_uuid(task_id),)
            )
