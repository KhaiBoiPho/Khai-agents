"""Backlinks: which pages link to which (kd_backlinks).

``sync(c, page_id, content)`` is called by the store inside the transaction
that writes a page's content (``KhaiDocsStore._write_state`` and
``create_page``), so the table always matches the stored document. A link is
a ``mention`` node of a page, or a link mark whose href is an internal page
URL (``/s/<space>/p/<title>-<slugId>``, ``/p/<slugId>``), absolute or not.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from core.khaidocs.store import _limit, _uuid, decode_cursor, encode_cursor
from core.persistence.database import Connection, Database

PAGE_URL = re.compile(r"/p/(?:[^/?#\s]*-)?([a-z0-9]{10})(?:[/?#]|$)")
MAX_TARGETS = 500


def extract_refs(content: Any) -> tuple[set[str], set[str]]:
    """(page ids, slug ids) a ProseMirror document points at."""

    ids: set[str] = set()
    slugs: set[str] = set()
    stack = [content]
    while stack and len(ids) + len(slugs) < MAX_TARGETS:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        attrs = node.get("attrs") or {}
        if node.get("type") == "mention" and attrs.get("entityType") == "page":
            entity = attrs.get("entityId")
            if isinstance(entity, str) and _is_uuid(entity):
                ids.add(str(UUID(entity)))
            elif isinstance(attrs.get("slugId"), str):
                slugs.add(attrs["slugId"])
        for mark in node.get("marks") or []:
            if isinstance(mark, dict) and mark.get("type") == "link":
                href = (mark.get("attrs") or {}).get("href")
                match = PAGE_URL.search(href) if isinstance(href, str) else None
                if match:
                    slugs.add(match.group(1))
        if node.get("content"):
            stack.append(node["content"])
    return ids, slugs


def _is_uuid(value: str) -> bool:
    try:
        UUID(value)
    except ValueError:
        return False
    return True


def sync(c: Connection, page_id: str, content: Any) -> None:
    """Replace the outgoing links of ``page_id`` with those in ``content``."""

    ids, slugs = extract_refs(content)
    targets: set[str] = set()
    if ids:
        rows = c.execute(
            "SELECT id FROM kd_pages WHERE id = ANY(?::uuid[]) AND deleted_at IS NULL", (list(ids),)
        ).fetchall()
        targets |= {str(r["id"]) for r in rows}
    if slugs:
        rows = c.execute(
            "SELECT id FROM kd_pages WHERE slug_id = ANY(?) AND deleted_at IS NULL", (list(slugs),)
        ).fetchall()
        targets |= {str(r["id"]) for r in rows}
    targets.discard(str(page_id))
    current = {
        str(r["target_page_id"])
        for r in c.execute(
            "SELECT target_page_id FROM kd_backlinks WHERE source_page_id = ?", (str(page_id),)
        ).fetchall()
    }
    for gone in current - targets:
        c.execute(
            "DELETE FROM kd_backlinks WHERE source_page_id = ? AND target_page_id = ?",
            (str(page_id), gone),
        )
    for new in targets - current:
        c.execute(
            "INSERT INTO kd_backlinks (source_page_id, target_page_id) VALUES (?, ?) "
            "ON CONFLICT DO NOTHING",
            (str(page_id), new),
        )


class BacklinkStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    def counts(self, page_id: str) -> dict:
        pid = _uuid(page_id, "pageId")
        with self.database.read() as c:
            row = c.execute(
                "SELECT "
                "(SELECT count(*) FROM kd_backlinks b JOIN kd_pages p ON p.id = b.source_page_id "
                " WHERE b.target_page_id = ? AND p.deleted_at IS NULL) AS incoming, "
                "(SELECT count(*) FROM kd_backlinks b JOIN kd_pages p ON p.id = b.target_page_id "
                " WHERE b.source_page_id = ? AND p.deleted_at IS NULL) AS outgoing",
                (pid, pid),
            ).fetchone()
        return {"incoming": int(row["incoming"]), "outgoing": int(row["outgoing"])}

    def list(self, page_id: str, direction: str, *, cursor: str | None = None,
             limit: int | None = None) -> tuple[list[dict], str | None]:
        """Pages linking to (incoming) or linked from (outgoing) a page."""

        pid = _uuid(page_id, "pageId")
        size = _limit(limit, 50)
        mine, other = ("target_page_id", "source_page_id") if direction != "outgoing" \
            else ("source_page_id", "target_page_id")
        after = decode_cursor(cursor)
        where = ["b." + mine + " = ?", "p.deleted_at IS NULL"]
        args: list = [pid]
        if after:
            where.append("(p.title_norm, p.id::text) > (?, ?)")
            args += [after[0], after[1]]
        with self.database.read() as c:
            rows = c.execute(
                "SELECT p.id, p.slug_id, p.title, p.icon, p.space_id, p.updated_at, p.title_norm, "
                "s.slug AS space_slug, s.name AS space_name FROM kd_backlinks b "
                f"JOIN kd_pages p ON p.id = b.{other} JOIN kd_spaces s ON s.id = p.space_id "
                f"WHERE {' AND '.join(where)} ORDER BY p.title_norm, p.id::text LIMIT {size + 1}",
                args,
            ).fetchall()
        items = [
            {
                "id": str(r["id"]), "slug_id": r["slug_id"], "title": r["title"], "icon": r["icon"],
                "space_id": str(r["space_id"]), "updated_at": r["updated_at"],
                "space": {"id": str(r["space_id"]), "slug": r["space_slug"], "name": r["space_name"]},
                "_norm": r["title_norm"],
            }
            for r in rows
        ]
        more = len(items) > size
        items = items[:size]
        nxt = encode_cursor(items[-1]["_norm"], items[-1]["id"]) if more else None
        for item in items:
            item.pop("_norm")
        return items, nxt
