"""Comments on pages (kd_comments): threads, anchors, resolve state.

Rows are dicts with snake_case keys; ``content`` is the text the client sends
(a ProseMirror document serialised as JSON). Top-level comments are threads;
replies hang off them (a reply to a reply is attached to the thread's root).
Comment marks inside the page document are owned by the editor (collab); this
store never touches them.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from psycopg.types.json import Jsonb

from core.khaidocs.errors import Invalid, NotFound
from core.khaidocs.store import _limit, _uuid, decode_cursor, encode_cursor
from core.persistence.database import Connection, Database

MAX_CONTENT = 200_000
MAX_SELECTION = 5_000
FIELDS = (
    "id, page_id, parent_comment_id, content, selection, type, yjs_selection, author, "
    "resolved_at, edited_at, deleted_at, created_at"
)


def _row(row) -> dict:
    out = {key: row[key] for key in row.keys()}
    for key in ("id", "page_id", "parent_comment_id"):
        if out.get(key) is not None:
            out[key] = str(out[key])
    return out


def content_doc(content: str) -> Any:
    """The parsed JSON of a comment body (or None when it is not JSON)."""

    try:
        return json.loads(content)
    except (TypeError, ValueError):
        return None


def mentioned_user_ids(content: str) -> list[str]:
    """User ids mentioned (``mention`` nodes of type user) in a comment body."""

    found: list[str] = []
    stack = [content_doc(content)]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
        elif isinstance(node, dict):
            attrs = node.get("attrs") or {}
            if node.get("type") == "mention" and attrs.get("entityType") == "user":
                entity = attrs.get("entityId")
                if isinstance(entity, str) and entity not in found:
                    found.append(entity)
            if node.get("content"):
                stack.append(node["content"])
    return found


class CommentStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    @staticmethod
    def _fetch(c: Connection, comment_id: str) -> dict:
        row = c.execute(
            f"SELECT {FIELDS} FROM kd_comments WHERE id = ? AND deleted_at IS NULL",
            (_uuid(comment_id, "commentId"),),
        ).fetchone()
        if row is None:
            raise NotFound("Comment not found")
        return _row(row)

    def get(self, comment_id: str) -> dict:
        with self.database.read() as c:
            return self._fetch(c, comment_id)

    def list(self, page_id: str, *, cursor: str | None = None,
             limit: int | None = None) -> tuple[list[dict], str | None]:
        """A page's comments, oldest first (threads and replies together)."""

        size = _limit(limit, 100)
        after = decode_cursor(cursor)
        where, args = ["page_id = ?", "deleted_at IS NULL"], [_uuid(page_id, "pageId")]
        if after:
            where.append("(created_at, id::text) > (?, ?)")
            args += [datetime.fromisoformat(after[0]), after[1]]
        with self.database.read() as c:
            if c.execute("SELECT 1 FROM kd_pages WHERE id = ?", (args[0],)).fetchone() is None:
                raise NotFound("Page not found")
            rows = c.execute(
                f"SELECT {FIELDS} FROM kd_comments WHERE {' AND '.join(where)} "
                f"ORDER BY created_at, id::text LIMIT {size + 1}",
                args,
            ).fetchall()
        items = [_row(r) for r in rows]
        more = len(items) > size
        items = items[:size]
        return items, encode_cursor(items[-1]["created_at"], items[-1]["id"]) if more else None

    def create(
        self, page_id: str, content: str, *, parent_comment_id: str | None = None,
        selection: str | None = None, kind: str | None = None, yjs_selection: dict | None = None,
        author: str = "user", comment_id: str | None = None,
    ) -> dict:
        if not isinstance(content, str) or not content.strip():
            raise Invalid("content is required")
        if len(content) > MAX_CONTENT:
            raise Invalid("comment is too long")
        if author not in ("user", "agent"):
            raise Invalid("invalid author")
        pid = _uuid(page_id, "pageId")
        with self.database.transaction() as c:
            page = c.execute(
                "SELECT id FROM kd_pages WHERE id = ? AND deleted_at IS NULL", (pid,)
            ).fetchone()
            if page is None:
                raise NotFound("Page not found")
            parent = None
            if parent_comment_id:
                found = c.execute(
                    "SELECT id, parent_comment_id, page_id FROM kd_comments "
                    "WHERE id = ? AND deleted_at IS NULL",
                    (_uuid(parent_comment_id, "parentCommentId"),),
                ).fetchone()
                if found is None or str(found["page_id"]) != pid:
                    raise NotFound("Parent comment not found")
                parent = str(found["parent_comment_id"] or found["id"])
            row = c.execute(
                "INSERT INTO kd_comments (id, page_id, parent_comment_id, content, selection, type, "
                "yjs_selection, author) VALUES (coalesce(?::uuid, gen_random_uuid()), ?, ?, ?, ?, ?, ?, ?) "
                "RETURNING id",
                (
                    _uuid(comment_id, "commentId"), pid, parent, content,
                    (selection or None) and selection[:MAX_SELECTION], kind,
                    Jsonb(yjs_selection) if isinstance(yjs_selection, dict) else None, author,
                ),
            ).fetchone()
            return self._fetch(c, str(row["id"]))

    def update(self, comment_id: str, content: str) -> dict:
        if not isinstance(content, str) or not content.strip():
            raise Invalid("content is required")
        if len(content) > MAX_CONTENT:
            raise Invalid("comment is too long")
        with self.database.transaction() as c:
            self._fetch(c, comment_id)
            c.execute(
                "UPDATE kd_comments SET content = ?, edited_at = now() WHERE id = ?",
                (content, _uuid(comment_id)),
            )
            return self._fetch(c, comment_id)

    def resolve(self, comment_id: str, resolved: bool) -> dict:
        with self.database.transaction() as c:
            row = self._fetch(c, comment_id)
            if row["parent_comment_id"]:
                raise Invalid("Only a comment thread can be resolved")
            c.execute(
                "UPDATE kd_comments SET resolved_at = ? WHERE id = ?",
                (datetime.now(UTC) if resolved else None, row["id"]),
            )
            return self._fetch(c, comment_id)

    def delete(self, comment_id: str) -> dict:
        """Delete a comment (a thread takes its replies with it); returns the row."""

        with self.database.transaction() as c:
            row = self._fetch(c, comment_id)
            c.execute("DELETE FROM kd_comments WHERE id = ?", (row["id"],))
            return row
