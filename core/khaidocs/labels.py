"""Page labels (kd_labels, kd_page_labels).

Names are normalised like the client does (trimmed, inner whitespace to
hyphens, lower case). A label row exists only while a page uses it.
"""

from __future__ import annotations

import re
from datetime import datetime

from core.khaidocs.errors import Invalid, NotFound
from core.khaidocs.store import _limit, _uuid, decode_cursor, encode_cursor
from core.khaidocs.text import nfc
from core.persistence.database import Database

MAX_NAME = 100
MAX_PER_PAGE = 50
_LIKE = str.maketrans({"\\": "\\\\", "%": "\\%", "_": "\\_"})


def normalize(name: str) -> str:
    return re.sub(r"\s+", "-", nfc(str(name or "")).strip()).lower()


def _label(row) -> dict:
    out = {key: row[key] for key in row.keys()}
    out["id"] = str(out["id"])
    return out


class LabelStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    def page_labels(self, page_id: str) -> list[dict]:
        with self.database.read() as c:
            rows = c.execute(
                "SELECT l.id, l.name, l.type, l.created_at, l.updated_at FROM kd_page_labels pl "
                "JOIN kd_labels l ON l.id = pl.label_id WHERE pl.page_id = ? ORDER BY l.name",
                (_uuid(page_id, "pageId"),),
            ).fetchall()
        return [_label(r) for r in rows]

    def search(self, kind: str = "page", *, query: str | None = None, cursor: str | None = None,
               limit: int | None = None) -> tuple[list[dict], str | None]:
        if kind not in ("page", "space"):
            raise Invalid("invalid label type")
        size = _limit(limit, 50)
        where, args = ["type = ?"], [kind]
        if query and normalize(query):
            where.append("name LIKE ? ESCAPE '\\'")
            args.append("%" + normalize(query).translate(_LIKE) + "%")
        after = decode_cursor(cursor)
        if after:
            where.append("(name, id::text) > (?, ?)")
            args += [after[0], after[1]]
        with self.database.read() as c:
            rows = c.execute(
                "SELECT id, name, type, created_at, updated_at FROM kd_labels "
                f"WHERE {' AND '.join(where)} ORDER BY name, id::text LIMIT {size + 1}",
                args,
            ).fetchall()
        items = [_label(r) for r in rows]
        more = len(items) > size
        items = items[:size]
        return items, encode_cursor(items[-1]["name"], items[-1]["id"]) if more else None

    def add_to_page(self, page_id: str, names: list[str]) -> list[dict]:
        """Attach labels (created as needed); returns the page's labels."""

        clean: list[str] = []
        for name in names or []:
            normal = normalize(name)
            if not normal or len(normal) > MAX_NAME:
                raise Invalid(f"invalid label name: {str(name)[:40]!r}")
            if normal not in clean:
                clean.append(normal)
        if not clean:
            raise Invalid("names are required")
        pid = _uuid(page_id, "pageId")
        with self.database.transaction() as c:
            if c.execute("SELECT 1 FROM kd_pages WHERE id = ? AND deleted_at IS NULL", (pid,)).fetchone() is None:
                raise NotFound("Page not found")
            have = c.execute("SELECT count(*) AS n FROM kd_page_labels WHERE page_id = ?", (pid,)).fetchone()
            if int(have["n"]) + len(clean) > MAX_PER_PAGE:
                raise Invalid(f"A page can have at most {MAX_PER_PAGE} labels")
            for name in clean:
                row = c.execute(
                    "INSERT INTO kd_labels (name, type) VALUES (?, 'page') "
                    "ON CONFLICT (user_id, type, name) DO UPDATE SET updated_at = now() RETURNING id",
                    (name,),
                ).fetchone()
                c.execute(
                    "INSERT INTO kd_page_labels (page_id, label_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
                    (pid, str(row["id"])),
                )
        return self.page_labels(pid)

    def remove_from_page(self, page_id: str, label_id: str) -> None:
        pid, lid = _uuid(page_id, "pageId"), _uuid(label_id, "labelId")
        with self.database.transaction() as c:
            c.execute("DELETE FROM kd_page_labels WHERE page_id = ? AND label_id = ?", (pid, lid))
            self._prune(c)

    @staticmethod
    def _prune(c) -> None:
        c.execute(
            "DELETE FROM kd_labels l WHERE l.type = 'page' AND NOT EXISTS "
            "(SELECT 1 FROM kd_page_labels pl WHERE pl.label_id = l.id)"
        )

    def prune(self) -> None:
        with self.database.transaction() as c:
            self._prune(c)

    def info(self, name: str, kind: str = "page", *, space_id: str | None = None) -> dict:
        normal = normalize(name)
        sid = _uuid(space_id, "spaceId")
        with self.database.read() as c:
            row = c.execute(
                "SELECT count(*) AS n FROM kd_page_labels pl JOIN kd_labels l ON l.id = pl.label_id "
                "JOIN kd_pages p ON p.id = pl.page_id WHERE l.name = ? AND l.type = ? "
                "AND p.deleted_at IS NULL" + (" AND p.space_id = ?" if sid else ""),
                (normal, kind, *([sid] if sid else [])),
            ).fetchone()
        return {"name": normal, "usage_count": int(row["n"])}

    def pages(self, *, label_id: str | None = None, name: str | None = None,
              space_id: str | None = None, cursor: str | None = None,
              limit: int | None = None) -> tuple[list[dict], str | None]:
        """Live pages carrying a label (by id or name), newest edit first."""

        size = _limit(limit, 50)
        where, args = ["p.deleted_at IS NULL"], []
        if label_id:
            where.append("l.id = ?")
            args.append(_uuid(label_id, "labelId"))
        elif name:
            where.append("l.name = ? AND l.type = 'page'")
            args.append(normalize(name))
        else:
            raise Invalid("labelId or name is required")
        if space_id:
            where.append("p.space_id = ?")
            args.append(_uuid(space_id, "spaceId"))
        after = decode_cursor(cursor)
        if after:
            where.append("(p.updated_at, p.id::text) < (?, ?)")
            args += [datetime.fromisoformat(after[0]), after[1]]
        with self.database.read() as c:
            rows = c.execute(
                "SELECT p.id, p.slug_id, p.title, p.icon, p.space_id, p.created_at, "
                "p.updated_at, s.name AS space_name, s.slug AS space_slug, s.icon AS space_icon "
                "FROM kd_page_labels pl JOIN kd_labels l ON l.id = pl.label_id "
                "JOIN kd_pages p ON p.id = pl.page_id JOIN kd_spaces s ON s.id = p.space_id "
                f"WHERE {' AND '.join(where)} ORDER BY p.updated_at DESC, p.id::text DESC LIMIT {size + 1}",
                args,
            ).fetchall()
            items = []
            for r in rows[: size + 1]:
                labels = c.execute(
                    "SELECT l.id, l.name FROM kd_page_labels pl JOIN kd_labels l ON l.id = pl.label_id "
                    "WHERE pl.page_id = ? ORDER BY l.name",
                    (str(r["id"]),),
                ).fetchall()
                items.append({
                    "id": str(r["id"]), "slug_id": r["slug_id"], "title": r["title"], "icon": r["icon"],
                    "space_id": str(r["space_id"]), "created_at": r["created_at"],
                    "updated_at": r["updated_at"],
                    "space": {"id": str(r["space_id"]), "name": r["space_name"],
                              "slug": r["space_slug"], "logo": r["space_icon"]},
                    "labels": [{"id": str(x["id"]), "name": x["name"]} for x in labels],
                })
        more = len(items) > size
        items = items[:size]
        return items, encode_cursor(items[-1]["updated_at"], items[-1]["id"]) if more else None


