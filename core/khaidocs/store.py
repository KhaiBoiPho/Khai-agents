"""KhaiDocsStore: the data layer of KhaiDocs, over a user-bound Database.

Every method runs in its own transaction on ``database`` (which must be
``Database.for_user(user_id)`` or a worker's own database), so row-level
security scopes it to that user; there is no user parameter anywhere. Rows
come back as plain dicts with snake_case keys (see INTERFACE.md); times are
timezone-aware ``datetime`` objects and ids are ``str``.

The methods are synchronous (psycopg). Async callers wrap them in
``asyncio.to_thread``.
"""

from __future__ import annotations

import base64
import json
import os
import re
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb
from pycrdt import Doc, merge_updates

from core.khaidocs import fractional
from core.khaidocs.errors import Conflict, Invalid, NotFound, TooLarge
from core.khaidocs.pm_yjs import (
    json_to_update,
    json_to_ydoc,
    replace_content,
    update_to_json,
    ydoc_to_json,
)
from core.khaidocs.text import fold, new_slug_id, nfc, plain_text, space_slug
from core.persistence.database import Connection, Database

DEFAULT_SPACE_NAME = "Private"
HISTORY_CAP = 100
HISTORY_INTERVAL_SECONDS = float(os.environ.get("KHAIDOCS_HISTORY_MINUTES", "10")) * 60
MAX_ATTACHMENT_BYTES = int(float(os.environ.get("KHAIDOCS_MAX_UPLOAD_MB", "50")) * 1024 * 1024)
MAX_TITLE = 500
PAGE_LIMIT_MAX = 200
ATTACHMENT_TYPES = ("file", "avatar", "space-icon", "workspace-icon")

_UNSET: Any = object()
_PAGE_FIELDS = (
    "p.id, p.slug_id, p.space_id, p.parent_page_id, p.position, p.title, p.icon, "
    "p.cover_photo, p.version, p.is_locked, p.updated_by, p.created_at, "
    "p.updated_at, p.deleted_at, p.deleted_root_id, "
    "EXISTS (SELECT 1 FROM kd_pages c WHERE c.parent_page_id = p.id "
    "AND c.deleted_at IS NULL) AS has_children"
)
_SPACE_FIELDS = (
    "id, name, slug, description, icon, visibility, default_role, is_default, "
    "settings, created_at, updated_at"
)
_LIKE_ESCAPE = str.maketrans({"\\": "\\\\", "%": "\\%", "_": "\\_"})


def _uuid(value: Any, what: str = "id") -> str | None:
    if value is None or value == "":
        return None
    try:
        return str(UUID(str(value)))
    except ValueError:
        raise Invalid(f"invalid {what}") from None


def _is_uuid(value: str) -> bool:
    try:
        UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return True


def _now() -> datetime:
    return datetime.now(UTC)


def encode_cursor(*parts: Any) -> str:
    raw = json.dumps([p.isoformat() if isinstance(p, datetime) else p for p in parts])
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> list | None:
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        value = json.loads(base64.urlsafe_b64decode(padded.encode()))
    except (ValueError, TypeError):
        raise Invalid("invalid cursor") from None
    if not isinstance(value, list):
        raise Invalid("invalid cursor")
    return value


def _limit(limit: Any, default: int = 50) -> int:
    try:
        value = int(limit) if limit is not None else default
    except (TypeError, ValueError):
        value = default
    return max(1, min(value, PAGE_LIMIT_MAX))


def _sync_backlinks(c: Connection, page_id: str, content: Any) -> None:
    """Phase-2 hook: keep kd_backlinks in step with every content write (called
    inside the writing transaction; see core/khaidocs/backlinks.py)."""

    from core.khaidocs.backlinks import sync

    sync(c, page_id, content)


def _page(row) -> dict:
    page = {key: row[key] for key in row.keys()}
    for key in ("id", "space_id", "parent_page_id", "deleted_root_id"):
        if page.get(key) is not None:
            page[key] = str(page[key])
    return page


def _space(row) -> dict:
    space = {key: row[key] for key in row.keys()}
    space["id"] = str(space["id"])
    return space


def _clean_title(title: Any) -> str:
    text = "" if title is None else nfc(str(title))
    if len(text) > MAX_TITLE:
        raise Invalid(f"title is longer than {MAX_TITLE} characters")
    return text


class KhaiDocsStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    # ------------------------------------------------------------------ spaces

    def ensure_default_space(self) -> dict:
        """The user's own "Private" space, created on first call."""

        with self.database.transaction() as c:
            return self._ensure_default_space(c)

    def _ensure_default_space(self, c: Connection) -> dict:
        row = c.execute(
            f"SELECT {_SPACE_FIELDS} FROM kd_spaces WHERE is_default AND deleted_at IS NULL"
        ).fetchone()
        if row is not None:
            return _space(row)
        slug = self._free_space_slug(c, space_slug(DEFAULT_SPACE_NAME))
        row = c.execute(
            "INSERT INTO kd_spaces (name, slug, is_default, description) VALUES (?, ?, true, ?) "
            f"RETURNING {_SPACE_FIELDS}",
            (DEFAULT_SPACE_NAME, slug, "Your private notes and documents"),
        ).fetchone()
        return _space(row)

    @staticmethod
    def _free_space_slug(c: Connection, base: str) -> str:
        slug, n = base, 1
        while c.execute("SELECT 1 FROM kd_spaces WHERE slug = ?", (slug,)).fetchone():
            n += 1
            slug = f"{base}{n}" if n < 50 else new_slug_id(10)
        return slug

    def list_spaces(self, *, query: str | None = None) -> list[dict]:
        with self.database.transaction() as c:
            self._ensure_default_space(c)
            rows = c.execute(
                f"SELECT {_SPACE_FIELDS} FROM kd_spaces WHERE deleted_at IS NULL "
                "ORDER BY is_default DESC, created_at, id"
            ).fetchall()
        spaces = [_space(r) for r in rows]
        if query:
            needle = fold(query)
            spaces = [s for s in spaces if needle in fold(s["name"])]
        return spaces

    def get_space(self, ref: str) -> dict:
        """A space by id or slug."""

        with self.database.transaction() as c:
            self._ensure_default_space(c)
            return self._get_space(c, ref)

    @staticmethod
    def _get_space(c: Connection, ref: str) -> dict:
        column = "id" if _is_uuid(str(ref)) else "slug"
        row = c.execute(
            f"SELECT {_SPACE_FIELDS} FROM kd_spaces WHERE {column} = ? AND deleted_at IS NULL",
            (str(ref),),
        ).fetchone()
        if row is None:
            raise NotFound("Space not found")
        return _space(row)

    def create_space(
        self, name: str, *, slug: str | None = None, description: str | None = None,
        icon: str | None = None,
    ) -> dict:
        name = (name or "").strip()
        if not name or len(name) > 100:
            raise Invalid("A space needs a name of 1 to 100 characters")
        if slug is not None and not re.fullmatch(r"[a-zA-Z0-9]{2,100}", slug):
            raise Invalid("slug must be 2 to 100 letters or digits")
        with self.database.transaction() as c:
            self._ensure_default_space(c)
            if slug and c.execute("SELECT 1 FROM kd_spaces WHERE slug = ?", (slug,)).fetchone():
                raise Conflict("Space slug exists")
            final = slug or self._free_space_slug(c, space_slug(name))
            row = c.execute(
                "INSERT INTO kd_spaces (name, slug, description, icon) VALUES (?, ?, ?, ?) "
                f"RETURNING {_SPACE_FIELDS}",
                (name, final, description, icon),
            ).fetchone()
            return _space(row)

    def update_space(
        self, space_id: str, *, name: Any = _UNSET, slug: Any = _UNSET,
        description: Any = _UNSET, icon: Any = _UNSET, settings: Any = _UNSET,
    ) -> dict:
        sets: list[str] = []
        args: list[Any] = []
        if name is not _UNSET:
            name = (name or "").strip()
            if not name or len(name) > 100:
                raise Invalid("A space needs a name of 1 to 100 characters")
            sets.append("name = ?")
            args.append(name)
        if slug is not _UNSET:
            if not re.fullmatch(r"[a-zA-Z0-9]{2,100}", slug or ""):
                raise Invalid("slug must be 2 to 100 letters or digits")
            sets.append("slug = ?")
            args.append(slug)
        if description is not _UNSET:
            sets.append("description = ?")
            args.append(description)
        if icon is not _UNSET:
            sets.append("icon = ?")
            args.append(icon)
        if settings is not _UNSET:
            sets.append("settings = ?")
            args.append(Jsonb(settings or {}))
        with self.database.transaction() as c:
            space = self._get_space(c, _uuid(space_id) or "")
            if not sets:
                return space
            if slug is not _UNSET and slug != space["slug"] and c.execute(
                "SELECT 1 FROM kd_spaces WHERE slug = ?", (slug,)
            ).fetchone():
                raise Conflict("Space slug exists")
            row = c.execute(
                f"UPDATE kd_spaces SET {', '.join(sets)}, updated_at = now() "
                f"WHERE id = ? RETURNING {_SPACE_FIELDS}",
                (*args, space["id"]),
            ).fetchone()
            return _space(row)

    def delete_space(self, space_id: str) -> None:
        with self.database.transaction() as c:
            space = self._get_space(c, _uuid(space_id) or "")
            if space["is_default"]:
                raise Invalid("The default space cannot be deleted")
            c.execute("DELETE FROM kd_spaces WHERE id = ?", (space["id"],))

    # ------------------------------------------------------------------- pages

    def create_page(
        self, *, space_id: str | None = None, title: str | None = None,
        parent_page_id: str | None = None, icon: str | None = None,
        cover_photo: str | None = None, content: dict | None = None,
        position: str | None = None, updated_by: str = "user",
        with_content: bool = False,
    ) -> dict:
        """Create a page; ``content`` is ProseMirror JSON (None = empty page).

        With no ``space_id`` the page goes into the parent's space, else into
        the user's default space.
        """

        title = _clean_title(title)
        parent_id = _uuid(parent_page_id, "parentPageId")
        with self.database.transaction() as c:
            default = self._ensure_default_space(c)
            if parent_id:
                parent = c.execute(
                    "SELECT space_id FROM kd_pages WHERE id = ? AND deleted_at IS NULL",
                    (parent_id,),
                ).fetchone()
                if parent is None:
                    raise NotFound("Parent page not found")
                space = str(parent["space_id"])
                if space_id and _uuid(space_id) != space:
                    raise Invalid("The parent page is in another space")
            elif space_id:
                space = self._get_space(c, _uuid(space_id, "spaceId") or "")["id"]
            else:
                space = default["id"]
            if not fractional.valid(position):
                last = c.execute(
                    "SELECT max(position COLLATE \"C\") AS p FROM kd_pages "
                    "WHERE space_id = ? AND parent_page_id IS NOT DISTINCT FROM ? "
                    "AND deleted_at IS NULL",
                    (space, parent_id),
                ).fetchone()
                position = fractional.after(last["p"] if last else None)
            ydoc = None
            text = ""
            if content:
                ydoc = json_to_update(content)
                text = plain_text(content)
            slug_id = self._free_slug_id(c)
            row = c.execute(
                "INSERT INTO kd_pages (slug_id, space_id, parent_page_id, position, title, "
                "icon, cover_photo, content, text_content, ydoc, updated_by, title_norm, "
                "text_norm, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "RETURNING id",
                (
                    slug_id, space, parent_id, position, title, icon, cover_photo,
                    Jsonb(content) if content else None, text, ydoc, updated_by,
                    fold(title), fold(text), 1 if content else 0,
                ),
            ).fetchone()
            if content:
                _sync_backlinks(c, str(row["id"]), content)
            return self._get_page(c, str(row["id"]), with_content=with_content)

    @staticmethod
    def _free_slug_id(c: Connection) -> str:
        while True:
            slug_id = new_slug_id(10)
            if not c.execute("SELECT 1 FROM kd_pages WHERE slug_id = ?", (slug_id,)).fetchone():
                return slug_id

    def get_page(self, ref: str, *, with_content: bool = True, include_deleted: bool = False) -> dict:
        """A page by id or slug_id. ``content`` is ProseMirror JSON."""

        with self.database.read() as c:
            return self._get_page(c, ref, with_content=with_content, include_deleted=include_deleted)

    @staticmethod
    def _get_page(c: Connection, ref: str, *, with_content: bool = True,
                  include_deleted: bool = False) -> dict:
        column = "p.id" if _is_uuid(str(ref)) else "p.slug_id"
        extra = ", p.content, p.text_content" if with_content else ""
        row = c.execute(
            f"SELECT {_PAGE_FIELDS}{extra} FROM kd_pages p WHERE {column} = ?"
            + ("" if include_deleted else " AND p.deleted_at IS NULL"),
            (str(ref),),
        ).fetchone()
        if row is None:
            raise NotFound("Page not found")
        return _page(row)

    def children(
        self, *, space_id: str | None = None, parent_page_id: str | None = None,
        cursor: str | None = None, limit: int | None = None,
    ) -> tuple[list[dict], str | None]:
        """Live pages directly under a parent (or a space's roots), in sibling
        order, with a keyset cursor: (items, next_cursor)."""

        size = _limit(limit, 100)
        after = decode_cursor(cursor)
        where = ["p.deleted_at IS NULL"]
        args: list[Any] = []
        if parent_page_id:
            where.append("p.parent_page_id = ?")
            args.append(_uuid(parent_page_id, "pageId"))
        else:
            where.append("p.parent_page_id IS NULL")
            if space_id:
                where.append("p.space_id = ?")
                args.append(_uuid(space_id, "spaceId"))
        if after:
            where.append('(p.position COLLATE "C", p.id::text) > (?, ?)')
            args.extend([after[0] or "", after[1]])
        with self.database.read() as c:
            rows = c.execute(
                f"SELECT {_PAGE_FIELDS} FROM kd_pages p WHERE {' AND '.join(where)} "
                f'ORDER BY p.position COLLATE "C", p.id::text LIMIT {size + 1}',
                args,
            ).fetchall()
        pages = [_page(r) for r in rows]
        more = len(pages) > size
        pages = pages[:size]
        return pages, encode_cursor(pages[-1]["position"], pages[-1]["id"]) if more else None

    def all_pages(self, *, space_id: str | None = None, include_deleted: bool = False) -> list[dict]:
        """Every page (no content) of a space or of the user, tree order not
        guaranteed. For tools and search; the UI pages through children()."""

        where, args = ["TRUE"], []
        if not include_deleted:
            where.append("p.deleted_at IS NULL")
        if space_id:
            where.append("p.space_id = ?")
            args.append(_uuid(space_id, "spaceId"))
        with self.database.read() as c:
            rows = c.execute(
                f"SELECT {_PAGE_FIELDS} FROM kd_pages p WHERE {' AND '.join(where)} "
                'ORDER BY p.space_id, p.position COLLATE "C", p.id',
                args,
            ).fetchall()
        return [_page(r) for r in rows]

    def update_page(
        self, ref: str, *, title: Any = _UNSET, icon: Any = _UNSET,
        cover_photo: Any = _UNSET, is_locked: Any = _UNSET, updated_by: str = "user",
    ) -> dict:
        """Change page metadata. Content changes go through the editor's Yjs
        document (collab) or :meth:`set_content`."""

        sets: list[str] = []
        args: list[Any] = []
        if title is not _UNSET:
            title = _clean_title(title)
            sets += ["title = ?", "title_norm = ?"]
            args += [title, fold(title)]
        if icon is not _UNSET:
            sets.append("icon = ?")
            args.append(icon or None)
        if cover_photo is not _UNSET:
            sets.append("cover_photo = ?")
            args.append(cover_photo or None)
        if is_locked is not _UNSET:
            sets.append("is_locked = ?")
            args.append(bool(is_locked))
        with self.database.transaction() as c:
            page = self._get_page(c, ref, with_content=False)
            if sets:
                c.execute(
                    f"UPDATE kd_pages SET {', '.join(sets)}, updated_at = now(), "
                    "updated_by = ? WHERE id = ?",
                    (*args, updated_by, page["id"]),
                )
            return self._get_page(c, page["id"])

    def set_content(self, ref: str, content: dict, *, updated_by: str = "agent") -> dict:
        """Replace a page's content with ProseMirror JSON, as a Yjs edit that
        merges with whatever the editor holds (the realtime server picks the
        change up at its next persist)."""

        if not isinstance(content, dict):
            raise Invalid("content must be a ProseMirror document")
        with self.database.transaction() as c:
            page = self._get_page(c, ref, with_content=False)
            row = c.execute(
                "SELECT ydoc, content FROM kd_pages WHERE id = ? FOR UPDATE", (page["id"],)
            ).fetchone()
            doc = Doc()
            if row["ydoc"]:
                doc.apply_update(bytes(row["ydoc"]))
            elif row["content"]:
                doc = json_to_ydoc(row["content"])
            replace_content(doc, content)
            self._write_state(c, page["id"], doc.get_update(), ydoc_to_json(doc), updated_by)
            return self._get_page(c, page["id"])

    @staticmethod
    def _write_state(c: Connection, page_id: str, state: bytes, content: dict, updated_by: str) -> int:
        text = plain_text(content)
        row = c.execute(
            "UPDATE kd_pages SET ydoc = ?, content = ?, text_content = ?, text_norm = ?, "
            "version = version + 1, updated_at = now(), updated_by = ? WHERE id = ? "
            "RETURNING version",
            (state, Jsonb(content), text, fold(text), updated_by, page_id),
        ).fetchone()
        _sync_backlinks(c, page_id, content)
        return int(row["version"])

    # -- realtime persistence ----------------------------------------------------

    def load_ydoc(self, ref: str) -> tuple[str, bytes | None, int]:
        """(page id, Yjs state or None, version) for the realtime server."""

        with self.database.read() as c:
            row = c.execute(
                "SELECT id, ydoc, content, version FROM kd_pages WHERE "
                + ("id" if _is_uuid(str(ref)) else "slug_id")
                + " = ? AND deleted_at IS NULL",
                (str(ref),),
            ).fetchone()
        if row is None:
            raise NotFound("Page not found")
        state = bytes(row["ydoc"]) if row["ydoc"] else None
        if state is None and row["content"]:
            state = json_to_update(row["content"])
        return str(row["id"]), state, int(row["version"])

    def current_version(self, page_id: str) -> int | None:
        """The stored version of a live page (None when it is gone)."""

        with self.database.read() as c:
            row = c.execute(
                "SELECT version FROM kd_pages WHERE id = ? AND deleted_at IS NULL", (page_id,)
            ).fetchone()
        return int(row["version"]) if row else None

    def persist_ydoc(
        self, page_id: str, state: bytes, known_version: int, *, snapshot: bool = False,
    ) -> tuple[bytes, int]:
        """Store the live document's Yjs state and derive content from it.

        Returns ``(merged_state, version)``. When the row changed since the
        caller loaded it (an agent wrote through set_content, another process
        persisted) the stored state is merged in; the caller applies
        ``merged_state`` to its live document, which broadcasts whatever was
        new to the editors.
        """

        with self.database.transaction() as c:
            row = c.execute(
                "SELECT ydoc, version FROM kd_pages WHERE id = ? AND deleted_at IS NULL FOR UPDATE",
                (page_id,),
            ).fetchone()
            if row is None:
                raise NotFound("Page not found")
            merged = state
            if int(row["version"]) != known_version and row["ydoc"]:
                merged = merge_updates(bytes(row["ydoc"]), state)
            content = update_to_json(merged)
            version = self._write_state(c, page_id, merged, content, "user")
            if snapshot:
                self._snapshot(c, page_id, force=False)
            return merged, version

    # -- trash, move, copy --------------------------------------------------------

    def trash_page(self, ref: str) -> None:
        """Move a page and all its descendants to the trash."""

        with self.database.transaction() as c:
            page = self._get_page(c, ref, with_content=False)
            c.execute(
                "WITH RECURSIVE tree AS (SELECT id FROM kd_pages WHERE id = ? "
                "UNION ALL SELECT k.id FROM kd_pages k JOIN tree t ON k.parent_page_id = t.id) "
                "UPDATE kd_pages SET deleted_at = now(), deleted_root_id = ? "
                "WHERE id IN (SELECT id FROM tree) AND deleted_at IS NULL",
                (page["id"], page["id"]),
            )

    def restore_page(self, ref: str) -> dict:
        with self.database.transaction() as c:
            page = self._get_page(c, ref, with_content=False, include_deleted=True)
            if page["deleted_at"] is None:
                return page
            c.execute(
                "UPDATE kd_pages SET deleted_at = NULL, deleted_root_id = NULL "
                "WHERE deleted_root_id = ?",
                (page["id"],),
            )
            # A parent that is still in the trash (or gone) makes this a root.
            c.execute(
                "UPDATE kd_pages SET parent_page_id = NULL WHERE id = ? AND parent_page_id IN "
                "(SELECT id FROM kd_pages WHERE deleted_at IS NOT NULL)",
                (page["id"],),
            )
            return self._get_page(c, page["id"], with_content=False)

    def delete_page(self, ref: str) -> None:
        """Delete a page and its subtree for good (history, labels, comments,
        attachments and favorites go with it)."""

        with self.database.transaction() as c:
            page = self._get_page(c, ref, with_content=False, include_deleted=True)
            c.execute("DELETE FROM kd_pages WHERE id = ?", (page["id"],))

    def trash(self, *, space_id: str | None = None, cursor: str | None = None,
              limit: int | None = None) -> tuple[list[dict], str | None]:
        """Deleted pages (the roots of what was deleted), newest first."""

        size = _limit(limit, 50)
        after = decode_cursor(cursor)
        where = ["p.deleted_at IS NOT NULL", "p.deleted_root_id = p.id"]
        args: list[Any] = []
        if space_id:
            where.append("p.space_id = ?")
            args.append(_uuid(space_id, "spaceId"))
        if after:
            where.append("(p.deleted_at, p.id::text) < (?, ?)")
            args.extend([datetime.fromisoformat(after[0]), after[1]])
        with self.database.read() as c:
            rows = c.execute(
                f"SELECT {_PAGE_FIELDS}, p.text_content FROM kd_pages p "
                f"WHERE {' AND '.join(where)} "
                f"ORDER BY p.deleted_at DESC, p.id::text DESC LIMIT {size + 1}",
                args,
            ).fetchall()
        pages = [_page(r) for r in rows]
        more = len(pages) > size
        pages = pages[:size]
        return pages, encode_cursor(pages[-1]["deleted_at"], pages[-1]["id"]) if more else None

    def move_page(
        self, ref: str, *, parent_page_id: Any = _UNSET, position: str | None = None,
        after: str | None = None, before: str | None = None,
    ) -> dict:
        with self.database.transaction() as c:
            page = self._get_page(c, ref, with_content=False)
            parent = page["parent_page_id"] if parent_page_id is _UNSET else _uuid(parent_page_id)
            if parent:
                row = c.execute(
                    "SELECT space_id FROM kd_pages WHERE id = ? AND deleted_at IS NULL", (parent,)
                ).fetchone()
                if row is None:
                    raise NotFound("Parent page not found")
                if str(row["space_id"]) != page["space_id"]:
                    raise Invalid("Use move-to-space to change a page's space")
                inside = c.execute(
                    "WITH RECURSIVE tree AS (SELECT id FROM kd_pages WHERE id = ? "
                    "UNION ALL SELECT k.id FROM kd_pages k JOIN tree t ON k.parent_page_id = t.id) "
                    "SELECT 1 FROM tree WHERE id = ?",
                    (page["id"], parent),
                ).fetchone()
                if inside:
                    raise Invalid("A page cannot be moved into itself")
            if not fractional.valid(position):
                position = self._position_near(c, page, parent, after, before)
            c.execute(
                "UPDATE kd_pages SET parent_page_id = ?, position = ?, updated_at = now() "
                "WHERE id = ?",
                (parent, position, page["id"]),
            )
            return self._get_page(c, page["id"], with_content=False)

    @staticmethod
    def _position_near(c: Connection, page: dict, parent: str | None,
                       after: str | None, before: str | None) -> str:
        def position_of(ref: str | None) -> str | None:
            if not ref:
                return None
            row = c.execute(
                "SELECT position FROM kd_pages WHERE id = ? AND deleted_at IS NULL",
                (_uuid(ref),),
            ).fetchone()
            return row["position"] if row else None

        low, high = position_of(after), position_of(before)
        if low is not None and high is None:
            nxt = c.execute(
                'SELECT min(position COLLATE "C") AS p FROM kd_pages WHERE space_id = ? '
                'AND parent_page_id IS NOT DISTINCT FROM ? AND deleted_at IS NULL '
                'AND id <> ? AND position COLLATE "C" > ?',
                (page["space_id"], parent, page["id"], low),
            ).fetchone()
            high = nxt["p"] if nxt else None
        if low is None and high is None:
            last = c.execute(
                'SELECT max(position COLLATE "C") AS p FROM kd_pages WHERE space_id = ? '
                "AND parent_page_id IS NOT DISTINCT FROM ? AND deleted_at IS NULL AND id <> ?",
                (page["space_id"], parent, page["id"]),
            ).fetchone()
            return fractional.after(last["p"] if last else None)
        try:
            return fractional.key_between(low, high)
        except ValueError:
            return fractional.after(low or high)

    def move_to_space(self, ref: str, space_id: str) -> dict:
        """Move a page with its subtree to the root of another space."""

        with self.database.transaction() as c:
            page = self._get_page(c, ref, with_content=False)
            space = self._get_space(c, _uuid(space_id, "spaceId") or "")
            if space["id"] == page["space_id"]:
                raise Invalid("The page is already in that space")
            last = c.execute(
                'SELECT max(position COLLATE "C") AS p FROM kd_pages WHERE space_id = ? '
                "AND parent_page_id IS NULL AND deleted_at IS NULL",
                (space["id"],),
            ).fetchone()
            ids = [
                str(r["id"])
                for r in c.execute(
                    "WITH RECURSIVE tree AS (SELECT id FROM kd_pages WHERE id = ? "
                    "UNION ALL SELECT k.id FROM kd_pages k JOIN tree t ON k.parent_page_id = t.id) "
                    "SELECT id FROM tree",
                    (page["id"],),
                ).fetchall()
            ]
            c.execute(
                "UPDATE kd_pages SET parent_page_id = NULL, position = ?, space_id = ?, "
                "updated_at = now() WHERE id = ?",
                (fractional.after(last["p"] if last else None), space["id"], page["id"]),
            )
            c.execute(
                "UPDATE kd_pages SET space_id = ? WHERE id = ANY(?::uuid[])",
                (space["id"], ids),
            )
            c.execute(
                "UPDATE kd_attachments SET space_id = ? WHERE page_id = ANY(?::uuid[])",
                (space["id"], ids),
            )
            return self._get_page(c, page["id"], with_content=False)

    def duplicate_page(self, ref: str, *, space_id: str | None = None) -> dict:
        """Copy a page and its subtree (into ``space_id`` when given)."""

        with self.database.transaction() as c:
            source = self._get_page(c, ref, with_content=False)
            target_space = (
                self._get_space(c, _uuid(space_id, "spaceId") or "")["id"]
                if space_id else source["space_id"]
            )
            rows = c.execute(
                "WITH RECURSIVE tree AS (SELECT id, 0 AS depth FROM kd_pages WHERE id = ? "
                "UNION ALL SELECT k.id, t.depth + 1 FROM kd_pages k JOIN tree t "
                "ON k.parent_page_id = t.id WHERE k.deleted_at IS NULL) "
                "SELECT p.id, p.parent_page_id, p.title, p.icon, p.cover_photo, p.content, "
                "p.position FROM kd_pages p JOIN tree t ON t.id = p.id ORDER BY t.depth, "
                'p.position COLLATE "C"',
                (source["id"],),
            ).fetchall()
            last = c.execute(
                'SELECT max(position COLLATE "C") AS p FROM kd_pages WHERE space_id = ? '
                "AND parent_page_id IS NOT DISTINCT FROM ? AND deleted_at IS NULL",
                (target_space, source["parent_page_id"] if target_space == source["space_id"] else None),
            ).fetchone()
            mapping: dict[str, str] = {}
            for row in rows:
                old = str(row["id"])
                is_root = old == source["id"]
                parent = (
                    (source["parent_page_id"] if target_space == source["space_id"] else None)
                    if is_root else mapping[str(row["parent_page_id"])]
                )
                content = row["content"]
                title = f"Copy of {row['title']}" if is_root and row["title"] else row["title"]
                text = plain_text(content) if content else ""
                new = c.execute(
                    "INSERT INTO kd_pages (slug_id, space_id, parent_page_id, position, title, "
                    "icon, cover_photo, content, text_content, ydoc, title_norm, text_norm, "
                    "version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
                    (
                        self._free_slug_id(c), target_space, parent,
                        fractional.after(last["p"] if last else None) if is_root else row["position"],
                        title, row["icon"], row["cover_photo"],
                        Jsonb(content) if content else None, text,
                        json_to_update(content) if content else None,
                        fold(title), fold(text), 1 if content else 0,
                    ),
                ).fetchone()
                mapping[old] = str(new["id"])
                if content:
                    _sync_backlinks(c, mapping[old], content)
            return self._get_page(c, mapping[source["id"]])

    def breadcrumbs(self, ref: str) -> list[dict]:
        """The page's ancestors from the root down, ending with the page."""

        with self.database.read() as c:
            page = self._get_page(c, ref, with_content=False, include_deleted=True)
            rows = c.execute(
                "WITH RECURSIVE up AS (SELECT id, parent_page_id, 0 AS depth FROM kd_pages "
                "WHERE id = ? UNION ALL SELECT k.id, k.parent_page_id, u.depth + 1 "
                "FROM kd_pages k JOIN up u ON k.id = u.parent_page_id) "
                f"SELECT {_PAGE_FIELDS} FROM kd_pages p JOIN up ON up.id = p.id "
                "ORDER BY up.depth DESC",
                (page["id"],),
            ).fetchall()
        return [_page(r) for r in rows]

    def recent(self, *, space_id: str | None = None, cursor: str | None = None,
               limit: int | None = None) -> tuple[list[dict], str | None]:
        size = _limit(limit, 15)
        after = decode_cursor(cursor)
        where = ["p.deleted_at IS NULL"]
        args: list[Any] = []
        if space_id:
            where.append("p.space_id = ?")
            args.append(_uuid(space_id, "spaceId"))
        if after:
            where.append("(p.updated_at, p.id::text) < (?, ?)")
            args.extend([datetime.fromisoformat(after[0]), after[1]])
        with self.database.read() as c:
            rows = c.execute(
                f"SELECT {_PAGE_FIELDS}, p.text_content FROM kd_pages p "
                f"WHERE {' AND '.join(where)} "
                f"ORDER BY p.updated_at DESC, p.id::text DESC LIMIT {size + 1}",
                args,
            ).fetchall()
        pages = [_page(r) for r in rows]
        more = len(pages) > size
        pages = pages[:size]
        return pages, encode_cursor(pages[-1]["updated_at"], pages[-1]["id"]) if more else None

    # ----------------------------------------------------------------- history

    def snapshot_page(self, ref: str, *, created_by: str = "user") -> dict | None:
        """Record the page's current content in its history (skipped when it
        equals the newest snapshot)."""

        with self.database.transaction() as c:
            page = self._get_page(c, ref, with_content=False)
            return self._snapshot(c, page["id"], force=True, created_by=created_by)

    def snapshot_if_due(self, page_id: str) -> None:
        """Snapshot when the newest one is older than the history interval."""

        with self.database.transaction() as c:
            self._snapshot(c, page_id, force=False)

    @staticmethod
    def _snapshot(c: Connection, page_id: str, *, force: bool, created_by: str = "user") -> dict | None:
        row = c.execute(
            "SELECT title, icon, cover_photo, content, text_content, version, updated_by "
            "FROM kd_pages WHERE id = ?",
            (page_id,),
        ).fetchone()
        if row is None or row["content"] is None:
            return None
        last = c.execute(
            "SELECT created_at, content, title FROM kd_page_history WHERE page_id = ? "
            "ORDER BY created_at DESC LIMIT 1",
            (page_id,),
        ).fetchone()
        if last is not None:
            if last["content"] == row["content"] and last["title"] == row["title"]:
                return None
            age = (_now() - last["created_at"]).total_seconds()
            if not force and age < HISTORY_INTERVAL_SECONDS:
                return None
        saved = c.execute(
            "INSERT INTO kd_page_history (page_id, title, icon, cover_photo, content, "
            "text_content, version, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            (
                page_id, row["title"], row["icon"], row["cover_photo"],
                Jsonb(row["content"]), row["text_content"], row["version"],
                row["updated_by"] if row["updated_by"] in ("user", "agent", "import") else created_by,
            ),
        ).fetchone()
        c.execute(
            "DELETE FROM kd_page_history WHERE page_id = ? AND id NOT IN "
            f"(SELECT id FROM kd_page_history WHERE page_id = ? ORDER BY created_at DESC LIMIT {HISTORY_CAP})",
            (page_id, page_id),
        )
        return {"id": str(saved["id"])}

    def history(self, ref: str, *, cursor: str | None = None,
                limit: int | None = None) -> tuple[list[dict], str | None]:
        size = _limit(limit, 30)
        after = decode_cursor(cursor)
        with self.database.read() as c:
            page = self._get_page(c, ref, with_content=False, include_deleted=True)
            where, args = ["h.page_id = ?"], [page["id"]]
            if after:
                where.append("(h.created_at, h.id::text) < (?, ?)")
                args += [datetime.fromisoformat(after[0]), after[1]]
            rows = c.execute(
                "SELECT h.id, h.page_id, h.title, h.icon, h.cover_photo, h.version, "
                "h.created_by, h.created_at FROM kd_page_history h "
                f"WHERE {' AND '.join(where)} ORDER BY h.created_at DESC, h.id::text DESC "
                f"LIMIT {size + 1}",
                args,
            ).fetchall()
        items = [self._history_row(r) for r in rows]
        more = len(items) > size
        items = items[:size]
        return items, encode_cursor(items[-1]["created_at"], items[-1]["id"]) if more else None

    def history_entry(self, history_id: str) -> dict:
        with self.database.read() as c:
            row = c.execute(
                "SELECT h.id, h.page_id, h.title, h.icon, h.cover_photo, h.content, "
                "h.version, h.created_by, h.created_at FROM kd_page_history h WHERE h.id = ?",
                (_uuid(history_id, "historyId"),),
            ).fetchone()
        if row is None:
            raise NotFound("History entry not found")
        return self._history_row(row)

    @staticmethod
    def _history_row(row) -> dict:
        entry = {key: row[key] for key in row.keys()}
        entry["id"] = str(entry["id"])
        entry["page_id"] = str(entry["page_id"])
        return entry

    # ------------------------------------------------------------------ search

    def search(
        self, query: str, *, space_id: str | None = None, limit: int | None = None,
        title_only: bool = False, offset: int = 0,
    ) -> list[dict]:
        """Pages matching every word of ``query``, diacritics and case
        ignored ("tieng viet" finds "Tiếng Việt"), best first. Each hit has a
        ``highlight`` snippet of the page text with <b> around the matches
        (the rest HTML-escaped)."""

        terms = [t for t in fold(query).split() if t][:8]
        if not terms:
            return []
        size = _limit(limit, 25)
        where = ["p.deleted_at IS NULL"]
        args: list[Any] = []
        for term in terms:
            like = "%" + term.translate(_LIKE_ESCAPE) + "%"
            if title_only:
                where.append("p.title_norm LIKE ?")
                args.append(like)
            else:
                where.append("(p.title_norm LIKE ? OR p.text_norm LIKE ?)")
                args += [like, like]
        if space_id:
            where.append("p.space_id = ?")
            args.append(_uuid(space_id, "spaceId"))
        joined = " & ".join(re.sub(r"[^\w]", "", t) for t in terms if re.sub(r"[^\w]", "", t))
        rank_args: list[Any] = []
        rank = "0"
        if joined:
            rank = "ts_rank(p.tsv, to_tsquery('simple', ?))"
            rank_args.append(joined.replace(" & ", ":* & ") + ":*")
        with self.database.read() as c:
            rows = c.execute(
                f"SELECT {_PAGE_FIELDS}, p.text_content, p.title_norm, p.text_norm, "
                f"{rank} AS rank, (p.title_norm LIKE ?) AS in_title FROM kd_pages p "
                f"WHERE {' AND '.join(where)} "
                "ORDER BY in_title DESC, rank DESC, p.updated_at DESC "
                f"LIMIT {size} OFFSET {max(0, int(offset))}",
                [*rank_args, "%" + terms[0].translate(_LIKE_ESCAPE) + "%", *args],
            ).fetchall()
        hits = []
        for row in rows:
            hit = _page(row)
            hit["rank"] = float(row["rank"] or 0)
            hit["highlight"] = highlight(row["text_content"], row["text_norm"], terms)
            hit["title_highlight"] = highlight(row["title"] or "", row["title_norm"], terms, width=200)
            hits.append(hit)
        return hits

    # --------------------------------------------------------------- favorites

    def add_favorite(self, kind: str, target_id: str) -> None:
        if kind not in ("page", "space", "template"):
            raise Invalid("invalid favorite type")
        column = {"page": "page_id", "space": "space_id", "template": "template_id"}[kind]
        target = _uuid(target_id, f"{column[:-3]}Id")
        with self.database.transaction() as c:
            if kind == "page":
                self._get_page(c, target, with_content=False)
            elif kind == "space":
                self._get_space(c, target)
            c.execute(
                f"INSERT INTO kd_favorites (type, {column}) VALUES (?, ?) ON CONFLICT DO NOTHING",
                (kind, target),
            )

    def remove_favorite(self, kind: str, target_id: str) -> None:
        column = {"page": "page_id", "space": "space_id", "template": "template_id"}.get(kind)
        if column is None:
            raise Invalid("invalid favorite type")
        with self.database.transaction() as c:
            c.execute(
                f"DELETE FROM kd_favorites WHERE type = ? AND {column} = ?",
                (kind, _uuid(target_id)),
            )

    def favorite_ids(self, kind: str, *, space_id: str | None = None) -> list[str]:
        column = {"page": "page_id", "space": "space_id", "template": "template_id"}.get(kind)
        if column is None:
            raise Invalid("invalid favorite type")
        join = ""
        where = ["f.type = ?"]
        args: list[Any] = [kind]
        if kind == "page":
            join = "JOIN kd_pages p ON p.id = f.page_id AND p.deleted_at IS NULL"
            if space_id:
                where.append("p.space_id = ?")
                args.append(_uuid(space_id, "spaceId"))
        with self.database.read() as c:
            rows = c.execute(
                f"SELECT f.{column} AS target FROM kd_favorites f {join} "
                f"WHERE {' AND '.join(where)} ORDER BY f.created_at DESC",
                args,
            ).fetchall()
        return [str(r["target"]) for r in rows]

    def list_favorites(self, *, kind: str | None = None, space_id: str | None = None,
                       cursor: str | None = None, limit: int | None = None
                       ) -> tuple[list[dict], str | None]:
        size = _limit(limit, 50)
        after = decode_cursor(cursor)
        where = ["TRUE"]
        args: list[Any] = []
        if kind:
            where.append("f.type = ?")
            args.append(kind)
        if space_id:
            where.append("(p.space_id = ? OR f.space_id = ?)")
            args += [_uuid(space_id, "spaceId")] * 2
        if after:
            where.append("(f.created_at, f.id::text) < (?, ?)")
            args += [datetime.fromisoformat(after[0]), after[1]]
        with self.database.read() as c:
            rows = c.execute(
                "SELECT f.id, f.type, f.page_id, f.space_id, f.template_id, f.created_at, "
                "p.slug_id AS p_slug, p.title AS p_title, p.icon AS p_icon, p.space_id AS p_space, "
                "s.name AS s_name, s.slug AS s_slug, s.icon AS s_icon "
                "FROM kd_favorites f LEFT JOIN kd_pages p ON p.id = f.page_id "
                "LEFT JOIN kd_spaces s ON s.id = f.space_id "
                f"WHERE {' AND '.join(where)} AND (f.page_id IS NULL OR p.deleted_at IS NULL) "
                f"ORDER BY f.created_at DESC, f.id::text DESC LIMIT {size + 1}",
                args,
            ).fetchall()
        items = []
        for r in rows:
            items.append({
                "id": str(r["id"]), "type": r["type"],
                "page_id": str(r["page_id"]) if r["page_id"] else None,
                "space_id": str(r["space_id"]) if r["space_id"] else None,
                "template_id": str(r["template_id"]) if r["template_id"] else None,
                "created_at": r["created_at"],
                "page": {
                    "id": str(r["page_id"]), "slug_id": r["p_slug"], "title": r["p_title"],
                    "icon": r["p_icon"], "space_id": str(r["p_space"]),
                } if r["page_id"] else None,
                "space": {
                    "id": str(r["space_id"]), "name": r["s_name"], "slug": r["s_slug"],
                    "icon": r["s_icon"],
                } if r["space_id"] else None,
            })
        more = len(items) > size
        items = items[:size]
        return items, encode_cursor(items[-1]["created_at"], items[-1]["id"]) if more else None

    # ------------------------------------------------------------- attachments

    def save_attachment(
        self, *, file_name: str, data: bytes, mime_type: str = "application/octet-stream",
        page_id: str | None = None, space_id: str | None = None, kind: str = "file",
        attachment_id: str | None = None,
    ) -> dict:
        """Store a file. With ``attachment_id`` the bytes of that attachment
        are replaced (same page); otherwise a new attachment is made."""

        if kind not in ATTACHMENT_TYPES:
            raise Invalid("invalid attachment type")
        if len(data) > MAX_ATTACHMENT_BYTES:
            raise TooLarge(f"File exceeds the {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB limit")
        name = os.path.basename((file_name or "").replace("\\", "/")).strip() or "file"
        name = name[:255]
        ext = os.path.splitext(name)[1][:20].lower()
        with self.database.transaction() as c:
            page = self._get_page(c, _uuid(page_id, "pageId"), with_content=False) if page_id else None
            sid = _uuid(space_id, "spaceId")
            if sid:
                self._get_space(c, sid)
            elif page:
                sid = page["space_id"]
            if attachment_id:
                existing = c.execute(
                    "SELECT id FROM kd_attachments WHERE id = ? AND deleted_at IS NULL",
                    (_uuid(attachment_id, "attachmentId"),),
                ).fetchone()
                if existing is None:
                    raise NotFound("Attachment not found")
                aid = str(existing["id"])
                c.execute(
                    "UPDATE kd_attachments SET file_name = ?, file_size = ?, file_ext = ?, "
                    "mime_type = ?, updated_at = now() WHERE id = ?",
                    (name, len(data), ext, mime_type, aid),
                )
                c.execute("UPDATE kd_attachment_blobs SET data = ? WHERE attachment_id = ?", (data, aid))
            else:
                row = c.execute(
                    "INSERT INTO kd_attachments (file_name, file_size, file_ext, mime_type, type, "
                    "page_id, space_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
                    (name, len(data), ext, mime_type, kind, page["id"] if page else None, sid),
                ).fetchone()
                aid = str(row["id"])
                c.execute(
                    "INSERT INTO kd_attachment_blobs (attachment_id, data) VALUES (?, ?)", (aid, data)
                )
            return self._attachment(c, aid)

    @staticmethod
    def _attachment(c: Connection, attachment_id: str) -> dict:
        row = c.execute(
            "SELECT id, file_name, file_path, file_size, file_ext, mime_type, type, page_id, "
            "space_id, created_at, updated_at, deleted_at FROM kd_attachments WHERE id = ?",
            (attachment_id,),
        ).fetchone()
        if row is None:
            raise NotFound("Attachment not found")
        item = {key: row[key] for key in row.keys()}
        for key in ("id", "page_id", "space_id"):
            if item[key] is not None:
                item[key] = str(item[key])
        return item

    def get_attachment(self, attachment_id: str) -> dict:
        with self.database.read() as c:
            item = self._attachment(c, _uuid(attachment_id, "attachmentId") or "")
        if item["deleted_at"] is not None:
            raise NotFound("Attachment not found")
        return item

    def read_attachment(self, attachment_id: str) -> tuple[dict, bytes]:
        with self.database.read() as c:
            item = self._attachment(c, _uuid(attachment_id, "attachmentId") or "")
            row = c.execute(
                "SELECT data FROM kd_attachment_blobs WHERE attachment_id = ?", (item["id"],)
            ).fetchone()
        if row is None or item["deleted_at"] is not None:
            raise NotFound("Attachment not found")
        return item, bytes(row["data"])

    def page_attachments(self, page_id: str, *, cursor: str | None = None,
                         limit: int | None = None) -> tuple[list[dict], str | None]:
        size = _limit(limit, 50)
        after = decode_cursor(cursor)
        where, args = ["page_id = ?", "deleted_at IS NULL", "type = 'file'"], [_uuid(page_id, "pageId")]
        if after:
            where.append("(created_at, id::text) < (?, ?)")
            args += [datetime.fromisoformat(after[0]), after[1]]
        with self.database.read() as c:
            rows = c.execute(
                "SELECT id, file_name, file_path, file_size, file_ext, mime_type, type, page_id, "
                "space_id, created_at, updated_at, deleted_at FROM kd_attachments "
                f"WHERE {' AND '.join(where)} ORDER BY created_at DESC, id::text DESC LIMIT {size + 1}",
                args,
            ).fetchall()
        items = []
        for r in rows:
            item = {key: r[key] for key in r.keys()}
            for key in ("id", "page_id", "space_id"):
                if item[key] is not None:
                    item[key] = str(item[key])
            items.append(item)
        more = len(items) > size
        items = items[:size]
        return items, encode_cursor(items[-1]["created_at"], items[-1]["id"]) if more else None

    def remove_icon(self, kind: str, *, space_id: str | None = None) -> None:
        """Drop the current avatar / space icon / workspace icon."""

        if kind not in ("avatar", "space-icon", "workspace-icon"):
            raise Invalid("invalid icon type")
        with self.database.transaction() as c:
            if kind == "space-icon":
                self._get_space(c, _uuid(space_id, "spaceId") or "")
                c.execute("DELETE FROM kd_attachments WHERE type = ? AND space_id = ?", (kind, _uuid(space_id)))
                c.execute("UPDATE kd_spaces SET icon = NULL WHERE id = ?", (_uuid(space_id),))
            else:
                c.execute("DELETE FROM kd_attachments WHERE type = ?", (kind,))

    def search_attachments(self, query: str, *, space_id: str | None = None,
                           limit: int | None = None) -> list[dict]:
        terms = [t for t in fold(query).split() if t][:8]
        if not terms:
            return []
        where, args = ["a.deleted_at IS NULL", "a.type = 'file'", "p.deleted_at IS NULL"], []
        for term in terms:
            where.append("(lower(a.file_name) LIKE ? OR lower(coalesce(a.text_content, '')) LIKE ?)")
            like = "%" + term.translate(_LIKE_ESCAPE) + "%"
            args += [like, like]
        if space_id:
            where.append("a.space_id = ?")
            args.append(_uuid(space_id, "spaceId"))
        with self.database.read() as c:
            rows = c.execute(
                "SELECT a.id, a.file_name, a.page_id, a.created_at, a.updated_at, p.title, p.slug_id, "
                "s.id AS sid, s.name AS sname, s.slug AS sslug, s.icon AS sicon "
                "FROM kd_attachments a JOIN kd_pages p ON p.id = a.page_id "
                "JOIN kd_spaces s ON s.id = p.space_id "
                f"WHERE {' AND '.join(where)} ORDER BY a.created_at DESC LIMIT {_limit(limit, 25)}",
                args,
            ).fetchall()
        return [
            {
                "id": str(r["id"]), "file_name": r["file_name"], "page_id": str(r["page_id"]),
                "created_at": r["created_at"], "updated_at": r["updated_at"],
                "page": {"id": str(r["page_id"]), "title": r["title"], "slug_id": r["slug_id"]},
                "space": {"id": str(r["sid"]), "name": r["sname"], "slug": r["sslug"], "icon": r["sicon"]},
            }
            for r in rows
        ]

    # ---------------------------------------------------------------- settings

    def get_settings(self) -> dict:
        """{settings, workspace, locale, timezone} — the user's KhaiDocs preferences."""

        with self.database.read() as c:
            row = c.execute(
                "SELECT settings, workspace, locale, timezone FROM kd_user_settings"
            ).fetchone()
        if row is None:
            return {"settings": {}, "workspace": {}, "locale": None, "timezone": None}
        return {key: row[key] for key in row.keys()}

    def update_settings(self, *, settings: dict | None = None, workspace: dict | None = None,
                        locale: str | None = None, timezone: str | None = None) -> dict:
        """Merge keys into the stored preferences (one level deep)."""

        with self.database.transaction() as c:
            row = c.execute(
                "SELECT settings, workspace, locale, timezone FROM kd_user_settings FOR UPDATE"
            ).fetchone()
            current = (
                {key: row[key] for key in row.keys()}
                if row else {"settings": {}, "workspace": {}, "locale": None, "timezone": None}
            )
            for field, patch in (("settings", settings), ("workspace", workspace)):
                if patch:
                    merged = dict(current[field])
                    for key, value in patch.items():
                        if isinstance(value, dict) and isinstance(merged.get(key), dict):
                            merged[key] = {**merged[key], **value}
                        else:
                            merged[key] = value
                    current[field] = merged
            if locale is not None:
                current["locale"] = locale
            if timezone is not None:
                current["timezone"] = timezone
            c.execute(
                "INSERT INTO kd_user_settings (settings, workspace, locale, timezone) "
                "VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings, "
                "workspace = EXCLUDED.workspace, locale = EXCLUDED.locale, "
                "timezone = EXCLUDED.timezone, updated_at = now()",
                (Jsonb(current["settings"]), Jsonb(current["workspace"]), current["locale"], current["timezone"]),
            )
            return current


def highlight(text: str, folded: str, terms: list[str], *, width: int = 220) -> str:
    """A snippet of ``text`` around the first match, matches in <b>, all text
    HTML-escaped. ``folded`` is the length-preserving fold of ``text``."""

    import html

    if not text:
        return ""
    if len(folded) != len(text):  # defensive: a fold that changed length
        folded = text.casefold()
        if len(folded) != len(text):
            return html.escape(text[:width])
    spans: list[tuple[int, int]] = []
    for term in terms:
        start = 0
        while (hit := folded.find(term, start)) >= 0 and len(spans) < 40:
            spans.append((hit, hit + len(term)))
            start = hit + max(1, len(term))
    if not spans:
        return html.escape(text[:width])
    spans.sort()
    merged: list[list[int]] = []
    for a, b in spans:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    first = merged[0][0]
    begin = max(0, first - width // 3)
    end = min(len(text), begin + width)
    out, pos = [], begin
    for a, b in merged:
        if a >= end:
            break
        a, b = max(a, begin), min(b, end)
        out.append(html.escape(text[pos:a]))
        out.append("<b>" + html.escape(text[a:b]) + "</b>")
        pos = b
    out.append(html.escape(text[pos:end]))
    return ("…" if begin else "") + "".join(out) + ("…" if end < len(text) else "")
