"""Notifications (kd_notifications) and watches (kd_watches).

KhaiDocs has one human per account, so "who did it" is either the account
itself (``actor="user"``) or the Khai agent (``actor="agent"``). The rules
(see :meth:`NotificationStore.on_comment` / :meth:`on_page_updated`):

* a mention of the account in a comment -> ``comment.user_mention``;
* a comment written by the agent -> ``comment.created`` (the user is the
  only person who could be told); the user's own comments notify nobody;
* the agent resolving a thread -> ``comment.resolved``;
* the agent editing a page the user watches -> ``page.updated``.

Anyone who creates a notification (agent tools included) can call
:meth:`notify`; after the transaction commits, the registered listeners get
``(user_id, row)`` so the HTTP layer can push a live event to the open tabs
(``app_server.khaidocs.notifications`` registers one).
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Callable
from datetime import datetime

from psycopg.types.json import Jsonb

from core.khaidocs.comments import mentioned_user_ids
from core.khaidocs.errors import Invalid
from core.khaidocs.store import _limit, _uuid, decode_cursor, encode_cursor
from core.persistence.database import Database

logger = logging.getLogger(__name__)

TYPES = (
    "comment.user_mention", "comment.created", "comment.resolved", "page.user_mention",
    "page.updated",
)
DIRECT = ("comment.user_mention", "comment.created", "comment.resolved", "page.user_mention")
UPDATES = ("page.updated",)
MAX_PER_USER = 2000

Listener = Callable[[str, dict], None]
_listeners: list[Listener] = []


def add_listener(listener: Listener) -> None:
    if listener not in _listeners:
        _listeners.append(listener)


def remove_listener(listener: Listener) -> None:
    with contextlib.suppress(ValueError):
        _listeners.remove(listener)


def _emit(user_id: str, row: dict) -> None:
    for listener in list(_listeners):
        try:
            listener(user_id, row)
        except Exception:  # a broken listener must never fail the write
            logger.exception("KhaiDocs notification listener failed")


def _row(row) -> dict:
    out = {key: row[key] for key in row.keys()}
    for key in ("id", "page_id", "space_id", "comment_id"):
        if out.get(key) is not None:
            out[key] = str(out[key])
    return out


class NotificationStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    # -- creating ---------------------------------------------------------------

    def notify(
        self, type: str, *, actor: str = "agent", page_id: str | None = None,
        space_id: str | None = None, comment_id: str | None = None, data: dict | None = None,
    ) -> dict:
        if type not in TYPES:
            raise Invalid("unknown notification type")
        if actor not in ("user", "agent"):
            raise Invalid("invalid actor")
        with self.database.transaction() as c:
            if page_id and not space_id:
                page = c.execute("SELECT space_id FROM kd_pages WHERE id = ?", (_uuid(page_id),)).fetchone()
                space_id = str(page["space_id"]) if page else None
            row = c.execute(
                "INSERT INTO kd_notifications (type, actor, page_id, space_id, comment_id, data) "
                "VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
                (type, actor, _uuid(page_id), _uuid(space_id), _uuid(comment_id),
                 Jsonb(data) if data is not None else None),
            ).fetchone()
            # keep the inbox bounded
            c.execute(
                "DELETE FROM kd_notifications WHERE id IN (SELECT id FROM kd_notifications "
                "ORDER BY created_at DESC OFFSET ?)",
                (MAX_PER_USER,),
            )
            made = self._one(c, str(row["id"]))
        _emit(self.database.user_id, made)
        return made

    def on_comment(self, comment: dict, *, thread_author: str | None = None) -> list[dict]:
        """Notifications a new comment causes (see module docstring)."""

        made: list[dict] = []
        user_id = self.database.user_id
        author = comment["author"]
        base = {"page_id": comment["page_id"], "comment_id": comment["id"], "actor": author}
        if user_id in mentioned_user_ids(comment["content"]):
            made.append(self.notify("comment.user_mention", **base))
        elif author == "agent":
            made.append(self.notify(
                "comment.created", **base,
                data={"reply": bool(comment.get("parent_comment_id")), "threadAuthor": thread_author},
            ))
        return made

    def on_comment_resolved(self, comment: dict, *, actor: str, resolved: bool) -> list[dict]:
        if actor == "agent" and resolved:
            return [self.notify("comment.resolved", page_id=comment["page_id"],
                                comment_id=comment["id"], actor="agent")]
        return []

    def on_page_updated(self, page_id: str, *, actor: str = "agent") -> list[dict]:
        """``page.updated`` for a watched page, unless the user did the edit."""

        if actor == "user" or not self.is_watching_page(page_id):
            return []
        return [self.notify("page.updated", page_id=page_id, actor=actor)]

    # -- reading ----------------------------------------------------------------

    @staticmethod
    def _one(c, notification_id: str) -> dict:
        row = c.execute(
            _SELECT + " WHERE n.id = ?", (notification_id,)
        ).fetchone()
        return _joined(row)

    def list(self, *, tab: str | None = None, cursor: str | None = None,
             limit: int | None = None, unread_only: bool = False) -> tuple[list[dict], str | None]:
        size = _limit(limit, 30)
        where, args = ["n.archived_at IS NULL"], []
        types = DIRECT if tab == "direct" else UPDATES if tab == "updates" else None
        if types:
            where.append("n.type = ANY(?)")
            args.append(list(types))
        if unread_only:
            where.append("n.read_at IS NULL")
        after = decode_cursor(cursor)
        if after:
            where.append("(n.created_at, n.id::text) < (?, ?)")
            args += [datetime.fromisoformat(after[0]), after[1]]
        with self.database.read() as c:
            rows = c.execute(
                f"{_SELECT} WHERE {' AND '.join(where)} "
                f"ORDER BY n.created_at DESC, n.id::text DESC LIMIT {size + 1}",
                args,
            ).fetchall()
        items = [_joined(r) for r in rows]
        more = len(items) > size
        items = items[:size]
        return items, encode_cursor(items[-1]["created_at"], items[-1]["id"]) if more else None

    def unread_count(self) -> int:
        with self.database.read() as c:
            row = c.execute(
                "SELECT count(*) AS n FROM kd_notifications WHERE read_at IS NULL AND archived_at IS NULL"
            ).fetchone()
        return int(row["n"])

    def mark_read(self, ids: list[str]) -> int:
        clean = [_uuid(i, "notificationId") for i in ids or []][:500]
        if not clean:
            return 0
        with self.database.transaction() as c:
            cur = c.execute(
                "UPDATE kd_notifications SET read_at = now() WHERE id = ANY(?::uuid[]) AND read_at IS NULL",
                (clean,),
            )
            return cur.rowcount

    def mark_all_read(self) -> int:
        with self.database.transaction() as c:
            return c.execute(
                "UPDATE kd_notifications SET read_at = now() WHERE read_at IS NULL"
            ).rowcount

    # -- watches ----------------------------------------------------------------

    def is_watching_page(self, page_id: str) -> bool:
        with self.database.read() as c:
            return c.execute(
                "SELECT 1 FROM kd_watches WHERE page_id = ?", (_uuid(page_id, "pageId"),)
            ).fetchone() is not None

    def is_watching_space(self, space_id: str) -> bool:
        with self.database.read() as c:
            return c.execute(
                "SELECT 1 FROM kd_watches WHERE space_id = ?", (_uuid(space_id, "spaceId"),)
            ).fetchone() is not None

    def watch_page(self, page_id: str) -> None:
        pid = _uuid(page_id, "pageId")
        with self.database.transaction() as c:
            self._need(c, "kd_pages", pid, "Page not found")
            c.execute(
                "INSERT INTO kd_watches (page_id) VALUES (?) ON CONFLICT DO NOTHING", (pid,)
            )

    def unwatch_page(self, page_id: str) -> None:
        with self.database.transaction() as c:
            c.execute("DELETE FROM kd_watches WHERE page_id = ?", (_uuid(page_id, "pageId"),))

    def watch_space(self, space_id: str) -> None:
        sid = _uuid(space_id, "spaceId")
        with self.database.transaction() as c:
            self._need(c, "kd_spaces", sid, "Space not found")
            c.execute(
                "INSERT INTO kd_watches (space_id) VALUES (?) ON CONFLICT DO NOTHING", (sid,)
            )

    def unwatch_space(self, space_id: str) -> None:
        with self.database.transaction() as c:
            c.execute("DELETE FROM kd_watches WHERE space_id = ?", (_uuid(space_id, "spaceId"),))

    def watched_space_ids(self) -> list[str]:
        with self.database.read() as c:
            rows = c.execute("SELECT space_id FROM kd_watches WHERE space_id IS NOT NULL").fetchall()
        return [str(r["space_id"]) for r in rows]

    @staticmethod
    def _need(c, table: str, row_id: str | None, message: str) -> None:
        from core.khaidocs.errors import NotFound

        extra = " AND deleted_at IS NULL" if table == "kd_pages" else ""
        if row_id is None or c.execute(
            f"SELECT 1 FROM {table} WHERE id = ?{extra}", (row_id,)
        ).fetchone() is None:
            raise NotFound(message)


_SELECT = (
    "SELECT n.id, n.type, n.actor, n.page_id, n.space_id, n.comment_id, n.data, n.read_at, "
    "n.archived_at, n.created_at, p.slug_id AS p_slug, p.title AS p_title, p.icon AS p_icon, "
    "s.name AS s_name, s.slug AS s_slug FROM kd_notifications n "
    "LEFT JOIN kd_pages p ON p.id = n.page_id AND p.deleted_at IS NULL "
    "LEFT JOIN kd_spaces s ON s.id = n.space_id"
)


def _joined(row) -> dict:
    out = _row(row)
    out["page"] = (
        {"id": out["page_id"], "title": out.pop("p_title"), "slug_id": out.pop("p_slug"),
         "icon": out.pop("p_icon")}
        if row["p_slug"] is not None else None
    )
    for key in ("p_title", "p_slug", "p_icon"):
        out.pop(key, None)
    out["space"] = (
        {"id": out["space_id"], "name": out.pop("s_name"), "slug": out.pop("s_slug")}
        if row["s_slug"] is not None else None
    )
    for key in ("s_name", "s_slug"):
        out.pop(key, None)
    return out
