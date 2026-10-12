"""``khaidocs_read`` / ``khaidocs_write``: the agent's access to the user's wiki.

Two tools so that the permission class is static: reading (search / tree /
read / trash) is read-only and auto-allowed, writing follows the normal
approval policy. Both run on a user-bound :class:`core.khaidocs.KhaiDocsStore`
over the worker's own database role (row-level security shows only that user's
pages). Registered only when such a store exists, so every other setup pays no
prompt tokens. Results are short plain text; pages are exchanged as Markdown
(core.khaidocs.agent_markdown). Deleting is soft only: ``trash`` moves a page
to the trash, there is no permanent delete.
"""

from __future__ import annotations

import asyncio
import html
import json
import os
import re
from collections.abc import Callable
from typing import Any

from loguru import logger

from core.agent_runtime.tools.base import Tool, ToolResult, tool_parameters
from core.khaidocs import KhaiDocsError, KhaiDocsStore
from core.khaidocs import agent_markdown as md
from core.khaidocs.text import fold

NOTIFY_CHANNEL = "khaidocs_agent"
DEFAULT_READ_CHARS = 6_000
MAX_READ_CHARS = 30_000
MAX_HITS = 8
SNIPPET_CHARS = 200
TREE_LINES = 200
TREE_DEPTH = 4

StoreFactory = Callable[[], KhaiDocsStore]


# ----------------------------------------------------------------------------- store


def default_store() -> KhaiDocsStore | None:
    """The store of the user this process works for, or None.

    A hosted worker: its database role (``KHAI_USER_ID``). A single-user
    install: the primary administrator. Not configured, not migrated or
    unbound (multi-user mode without a user) means no tools.
    """

    if not os.environ.get("KHAI_DATABASE_URL", "").strip():
        return None
    try:
        from core.persistence.database import Database

        database = Database()
        database.user_id  # noqa: B018 - resolves (and validates) the binding
        return KhaiDocsStore(database)
    except Exception as exc:  # noqa: BLE001 - optional capability
        logger.debug("KhaiDocs tools unavailable: {}", exc)
        return None


def khaidocs_tools(store: KhaiDocsStore | None) -> tuple[Tool, ...]:
    """The two tools, or ``()`` when there is no store (see :func:`default_store`)."""

    if store is None:
        return ()
    return (KhaiDocsReadTool(lambda: store), KhaiDocsWriteTool(lambda: store))


# ----------------------------------------------------------------------------- helpers


def _notify(store: KhaiDocsStore, op: str, page: dict | None = None) -> None:
    """Tell the gateway (Postgres NOTIFY) that the agent changed something, so
    open tabs refresh their tree and editors merge the new content at once."""

    try:
        body = {"u": store.database.user_id, "op": op}
        if page:
            body.update(p=page.get("id"), s=page.get("space_id"), g=page.get("slug_id"))
        with store.database.transaction() as c:
            c.execute("SELECT pg_notify(?, ?)", (NOTIFY_CHANNEL, json.dumps(body)))
    except Exception as exc:  # noqa: BLE001 - freshness is best effort
        logger.debug("KhaiDocs notify failed: {}", exc)


def _clip(text: str, size: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= size else text[: size - 1].rstrip() + "…"


def _snippet(hit: dict) -> str:
    raw = hit.get("highlight") or ""
    return _clip(html.unescape(re.sub(r"</?b>", "", raw)), SNIPPET_CHARS)


def _err(message: str) -> ToolResult:
    return ToolResult(f"Error: {message}", is_error=True)


def _space_id(store: KhaiDocsStore, ref: Any) -> str | None:
    if not isinstance(ref, str) or not ref.strip():
        return None
    ref = ref.strip()
    needle = fold(ref)
    for space in store.list_spaces():
        if ref in (space["id"], space["slug"]) or fold(space["name"]) == needle:
            return space["id"]
    names = ", ".join(s["name"] for s in store.list_spaces())
    raise KhaiDocsError(f"unknown space {ref!r} (spaces: {names})")


def _page_ref(kwargs: dict) -> str:
    ref = kwargs.get("page")
    if not isinstance(ref, str) or not ref.strip():
        raise KhaiDocsError("page is required (id or slug from search/tree)")
    return ref.strip().rsplit("-", 1)[-1] if "/" in ref else ref.strip()


def _label(page: dict) -> str:
    return f"{page.get('title') or 'Untitled'} [{page['slug_id']}]"


class _KhaiDocsTool(Tool):
    def __init__(self, factory: StoreFactory) -> None:
        self._factory = factory

    def presentation_detail(self, arguments: dict[str, Any]) -> str | None:
        action = arguments.get("action", "")
        subject = arguments.get("title") or arguments.get("query") or arguments.get("page") or ""
        return f"{action} {subject}".strip()[:160]

    async def execute(self, **kwargs: Any) -> Any:
        action = kwargs.get("action")
        handler = getattr(self, f"_do_{action}", None) if isinstance(action, str) else None
        if handler is None or action not in self._ACTIONS:
            return _err(f"action must be one of: {', '.join(self._ACTIONS)}")
        try:
            store = self._factory()
            return await asyncio.to_thread(handler, store, kwargs)
        except KhaiDocsError as exc:
            return _err(str(exc))
        except Exception as exc:  # noqa: BLE001 - tool boundary
            logger.exception("khaidocs tool failed")
            return _err(f"KhaiDocs failed ({type(exc).__name__})")

    _ACTIONS: tuple[str, ...] = ()


# ----------------------------------------------------------------------------- read


@tool_parameters(
    {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["search", "tree", "read", "trash"]},
            "query": {"type": "string", "description": "search: words to find"},
            "page": {"type": "string", "description": "read: page id/slug; tree: root page"},
            "section": {"type": "string", "description": "read: heading to read only"},
            "space": {"type": "string", "description": "limit to this space (name/slug)"},
            "max_chars": {"type": "integer", "minimum": 500, "maximum": MAX_READ_CHARS},
        },
        "required": ["action"],
        "additionalProperties": False,
    }
)
class KhaiDocsReadTool(_KhaiDocsTool):
    _ACTIONS = ("search", "tree", "read", "trash")

    @property
    def name(self) -> str:
        return "khaidocs_read"

    @property
    def description(self) -> str:
        return (
            "Read the user's KhaiDocs wiki (their pages and notes). search finds "
            "pages by words; tree lists the page outline; read returns a page as "
            "Markdown (whole, or one section by heading; long pages are cut, ask "
            "for a section); trash lists deleted pages. Use for questions about "
            "the user's docs, wiki or notes."
        )

    @property
    def read_only(self) -> bool:
        return True

    def _do_search(self, store: KhaiDocsStore, kw: dict) -> str:
        query = str(kw.get("query") or "").strip()
        if not query:
            raise KhaiDocsError("query is required")
        hits = store.search(query, space_id=_space_id(store, kw.get("space")), limit=MAX_HITS)
        if not hits:
            return f'No pages match "{query}".'
        lines = [f"{len(hits)} page(s):"]
        for hit in hits:
            snippet = _snippet(hit)
            lines.append(f"- {_label(hit)}" + (f" — {snippet}" if snippet else ""))
        return "\n".join(lines)

    def _do_tree(self, store: KhaiDocsStore, kw: dict) -> str:
        space = _space_id(store, kw.get("space"))
        pages = store.all_pages(space_id=space)
        if not pages:
            return "No pages yet."
        children: dict[str | None, list[dict]] = {}
        known = {p["id"] for p in pages}
        for page in pages:
            parent = page["parent_page_id"] if page["parent_page_id"] in known else None
            children.setdefault(parent, []).append(page)
        root: str | None = None
        if kw.get("page"):
            root = store.get_page(_page_ref(kw), with_content=False)["id"]
        names = {s["id"]: s["name"] for s in store.list_spaces()}
        lines: list[str] = []
        total = 0

        def walk(parent: str | None, depth: int) -> None:
            nonlocal total
            for page in children.get(parent, []):
                total += 1
                if len(lines) < TREE_LINES:
                    more = "" if depth < TREE_DEPTH or not page["has_children"] else " …"
                    lines.append("  " * depth + f"- {_label(page)}{more}")
                if depth + 1 < TREE_DEPTH:
                    walk(page["id"], depth + 1)

        if root is not None:
            walk(root, 0)
        elif len(names) > 1 and not space:
            for space_id, name in names.items():
                section = [p for p in children.get(None, []) if p["space_id"] == space_id]
                if section:
                    lines.append(f"# {name}")
                    for page in section:
                        total += 1
                        if len(lines) < TREE_LINES:
                            more = " …" if page["has_children"] else ""
                            lines.append(f"- {_label(page)}{more}")
                        walk(page["id"], 1)
        else:
            walk(None, 0)
        if not lines:
            return "No pages under that page."
        if total > len(lines):
            lines.append(f"… {total - len(lines)} more (use page= or space= to narrow)")
        return "\n".join(lines)

    def _do_read(self, store: KhaiDocsStore, kw: dict) -> str:
        page = store.get_page(_page_ref(kw))
        doc = page.get("content") or {"type": "doc", "content": []}
        section = kw.get("section")
        if isinstance(section, str) and section.strip():
            text = md.section_markdown(doc, section)
            if text is None:
                heads = ", ".join(h[1] for h in md.outline(doc)[:25]) or "none"
                raise KhaiDocsError(f"no section {section.strip()!r} (headings: {heads})")
        else:
            text = md.pm_to_markdown(doc)
        limit = kw.get("max_chars")
        limit = limit if isinstance(limit, int) and not isinstance(limit, bool) else DEFAULT_READ_CHARS
        limit = max(500, min(MAX_READ_CHARS, limit))
        head = f"{_label(page)} · updated {str(page['updated_at'])[:16]}"
        if len(text) > limit:
            cut = text[:limit]
            cut = cut[: cut.rfind("\n")] if "\n" in cut[limit // 2:] else cut
            heads = " | ".join(h[1] for h in md.outline(doc)[:25])
            hint = f"\n…[truncated: {len(cut)} of {len(text)} chars. Call again with section=<heading> or max_chars."
            hint += f" Headings: {heads}]" if heads and not section else "]"
            text = cut + hint
        return f"{head}\n\n{text}" if text else f"{head}\n\n(empty page)"

    def _do_trash(self, store: KhaiDocsStore, kw: dict) -> str:
        pages, _ = store.trash(space_id=_space_id(store, kw.get("space")), limit=30)
        if not pages:
            return "Trash is empty."
        return "\n".join(
            [f"{len(pages)} deleted page(s):"]
            + [f"- {_label(p)} (deleted {str(p['deleted_at'])[:10]})" for p in pages]
        )


# ----------------------------------------------------------------------------- write


@tool_parameters(
    {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": [
                    "create", "append", "replace_section", "update",
                    "rename", "move", "trash", "restore",
                ],
            },
            "page": {"type": "string", "description": "page id/slug (not for create)"},
            "title": {"type": "string", "description": "create / rename"},
            "markdown": {"type": "string", "description": "page or section content"},
            "section": {"type": "string", "description": "replace_section: heading"},
            "parent": {"type": "string", "description": "create / move: parent page, 'root' = top level"},
            "space": {"type": "string", "description": "create: space name/slug"},
        },
        "required": ["action"],
        "additionalProperties": False,
    }
)
class KhaiDocsWriteTool(_KhaiDocsTool):
    _ACTIONS = (
        "create", "append", "replace_section", "update", "rename", "move", "trash", "restore",
    )

    @property
    def name(self) -> str:
        return "khaidocs_write"

    @property
    def description(self) -> str:
        return (
            "Change the user's KhaiDocs wiki. create (title, markdown, optional "
            "parent/space); append (page, markdown) adds at the end; "
            "replace_section (page, section heading, markdown); update (page, "
            "markdown) replaces the whole body, so read it first; rename; move "
            "(page, parent or 'root'); trash/restore (page). Trash is soft: "
            "permanent delete is not possible. Markdown supports headings, lists, "
            "- [ ] tasks, tables, code, links, images."
        )

    @property
    def read_only(self) -> bool:
        return False

    @staticmethod
    def _markdown(kw: dict, *, required: bool = True) -> str:
        text = kw.get("markdown")
        if text is None and not required:
            return ""
        if not isinstance(text, str) or (required and not text.strip()):
            raise KhaiDocsError("markdown is required")
        if len(text) > md.MAX_MARKDOWN_CHARS:
            raise KhaiDocsError(f"markdown is longer than {md.MAX_MARKDOWN_CHARS} characters")
        return text

    @staticmethod
    def _editable(store: KhaiDocsStore, kw: dict) -> dict:
        page = store.get_page(_page_ref(kw))
        if page.get("is_locked"):
            raise KhaiDocsError("the page is locked by the user; ask them to unlock it")
        return page

    def _write(self, store: KhaiDocsStore, page: dict, doc: dict, op: str, verb: str) -> str:
        store.snapshot_page(page["id"], created_by="user")  # one-click undo in page history
        saved = store.set_content(page["id"], doc, updated_by="agent")
        _notify(store, "content", saved)
        return f"{verb} {_label(saved)}"

    def _do_create(self, store: KhaiDocsStore, kw: dict) -> str:
        title = str(kw.get("title") or "").strip()
        if not title:
            raise KhaiDocsError("title is required")
        text = self._markdown(kw, required=False)
        doc = md.markdown_to_pm(text) if text.strip() else None
        if doc and doc["content"] and doc["content"][0].get("type") == "heading":
            first = doc["content"][0]
            if (first.get("attrs") or {}).get("level") == 1 and fold(
                "".join(n.get("text", "") for n in first.get("content") or [])
            ) == fold(title):
                doc["content"] = doc["content"][1:] or [{"type": "paragraph"}]
        parent = kw.get("parent")
        parent_id = None
        if isinstance(parent, str) and parent.strip() and parent.strip().lower() != "root":
            parent_id = store.get_page(parent.strip(), with_content=False)["id"]
        page = store.create_page(
            title=title, content=doc, parent_page_id=parent_id,
            space_id=_space_id(store, kw.get("space")), updated_by="agent",
        )
        _notify(store, "create", page)
        return f"Created {_label(page)}"

    def _do_append(self, store: KhaiDocsStore, kw: dict) -> str:
        text = self._markdown(kw)
        page = self._editable(store, kw)
        return self._write(store, page, md.append_markdown(page.get("content"), text), "append", "Appended to")

    def _do_update(self, store: KhaiDocsStore, kw: dict) -> str:
        text = self._markdown(kw)
        page = self._editable(store, kw)
        return self._write(store, page, md.markdown_to_pm(text), "update", "Replaced the body of")

    def _do_replace_section(self, store: KhaiDocsStore, kw: dict) -> str:
        heading = str(kw.get("section") or "").strip()
        if not heading:
            raise KhaiDocsError("section (heading text) is required")
        text = self._markdown(kw, required=False)
        page = self._editable(store, kw)
        doc = md.replace_section(page.get("content") or {"type": "doc", "content": []}, heading, text)
        if doc is None:
            heads = ", ".join(h[1] for h in md.outline(page.get("content"))[:25]) or "none"
            raise KhaiDocsError(f"no section {heading!r} (headings: {heads})")
        return self._write(store, page, doc, "replace_section", f"Replaced section {heading!r} of")

    def _do_rename(self, store: KhaiDocsStore, kw: dict) -> str:
        title = str(kw.get("title") or "").strip()
        if not title:
            raise KhaiDocsError("title is required")
        page = self._editable(store, kw)
        saved = store.update_page(page["id"], title=title, updated_by="agent")
        _notify(store, "rename", saved)
        return f"Renamed to {_label(saved)}"

    def _do_move(self, store: KhaiDocsStore, kw: dict) -> str:
        parent = kw.get("parent")
        if not isinstance(parent, str) or not parent.strip():
            raise KhaiDocsError("parent is required (a page, or 'root' for top level)")
        page = self._editable(store, kw)
        parent_id = (
            None if parent.strip().lower() == "root"
            else store.get_page(parent.strip(), with_content=False)["id"]
        )
        saved = store.move_page(page["id"], parent_page_id=parent_id)
        _notify(store, "move", saved)
        return f"Moved {_label(saved)} " + (f"under {parent.strip()}" if parent_id else "to the top level")

    def _do_trash(self, store: KhaiDocsStore, kw: dict) -> str:
        page = self._editable(store, kw)
        store.trash_page(page["id"])
        _notify(store, "trash", page)
        return f"Moved {_label(page)} to the trash (restore with action=restore)"

    def _do_restore(self, store: KhaiDocsStore, kw: dict) -> str:
        page = store.restore_page(_page_ref(kw))
        _notify(store, "restore", page)
        return f"Restored {_label(page)}"


__all__ = [
    "KhaiDocsReadTool",
    "KhaiDocsWriteTool",
    "NOTIFY_CHANNEL",
    "default_store",
    "khaidocs_tools",
]
