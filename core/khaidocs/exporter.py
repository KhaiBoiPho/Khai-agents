"""Exporting pages as Markdown / HTML (single file or zip) and Word.

``export_pages`` returns an :class:`Export` whose ``file`` is a temporary file
(spooled to disk above a few MB) the HTTP layer streams out and closes.
Page trees become folders (``Title.md`` next to a ``Title/`` folder of its
children); attachments referenced by the content go to ``files/`` and the
documents point at them with relative links, so the archive re-imports with
its images intact.
"""

from __future__ import annotations

import io
import re
import tempfile
import zipfile
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

from core.khaidocs.docx_pm import pm_to_docx
from core.khaidocs.errors import Invalid, KhaiDocsError, NotFound
from core.khaidocs.html_pm import pm_to_html
from core.khaidocs.markdown_pm import pm_to_md
from core.khaidocs.safezip import safe_filename
from core.khaidocs.store import KhaiDocsStore

MAX_PAGES = 5000
_FILE_ID = re.compile(r"/api/files/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})")
FILE_KINDS = ("image", "attachment", "video", "audio", "pdf")


@dataclass
class Export:
    file: Any  # a binary file object positioned at 0
    size: int
    file_name: str
    content_type: str

    def close(self) -> None:
        self.file.close()


def attachment_ids(doc: Any) -> list[str]:
    """Attachment ids referenced by a document, in order, without repeats."""

    found: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            if node.get("type") in FILE_KINDS:
                attrs = node.get("attrs") or {}
                ident = attrs.get("attachmentId")
                if not ident:
                    match = _FILE_ID.search(str(attrs.get("src") or attrs.get("url") or ""))
                    ident = match.group(1) if match else None
                if ident and ident not in found:
                    found.append(str(ident))
            walk(node.get("content"))

    walk(doc)
    return found


def _spool() -> Any:
    return tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024)  # noqa: SIM115


def _finish(handle: Any, name: str, content_type: str) -> Export:
    size = handle.seek(0, io.SEEK_END)
    handle.seek(0)
    return Export(handle, size, name, content_type)


def _unique(names: set[str], base: str, ext: str) -> str:
    candidate, n = f"{base}{ext}", 1
    while candidate.casefold() in names:
        n += 1
        candidate = f"{base} ({n}){ext}"
    names.add(candidate.casefold())
    return candidate


def _tree(pages: list[dict]) -> list[dict]:
    """Nodes {page, children} of a space's live pages, in sibling order."""

    by_id = {p["id"]: {"page": p, "children": []} for p in pages}
    roots: list[dict] = []
    for page in pages:
        parent = by_id.get(page["parent_page_id"])
        (parent["children"] if parent else roots).append(by_id[page["id"]])
    return roots


def _subtree(store: KhaiDocsStore, page: dict, include_children: bool) -> dict:
    if not include_children:
        return {"page": page, "children": []}
    pages = store.all_pages(space_id=page["space_id"])
    by_parent: dict[str | None, list[dict]] = {}
    for p in pages:
        by_parent.setdefault(p["parent_page_id"], []).append(p)
    count = 0

    def build(p: dict) -> dict:
        nonlocal count
        count += 1
        if count > MAX_PAGES:
            raise Invalid(f"Export is limited to {MAX_PAGES} pages")
        return {"page": p, "children": [build(c) for c in by_parent.get(p["id"], [])]}

    return build(page)


def export_pages(
    store: KhaiDocsStore, *, page_id: str | None = None, space_id: str | None = None,
    fmt: str = "markdown", include_children: bool = False, include_attachments: bool = False,
) -> Export:
    if fmt not in ("markdown", "html"):
        raise Invalid("format must be markdown or html")
    ext = ".md" if fmt == "markdown" else ".html"
    if page_id:
        page = store.get_page(page_id, with_content=False)
        roots = [_subtree(store, page, include_children)]
        archive_name = safe_filename(page["title"] or "Untitled")
    else:
        space = store.get_space(space_id or "")
        pages = store.all_pages(space_id=space["id"])
        if len(pages) > MAX_PAGES:
            raise Invalid(f"Export is limited to {MAX_PAGES} pages")
        roots = _tree(pages)
        archive_name = safe_filename(space["name"] or "Space")
        include_children = True
    single = page_id is not None and not include_children and not include_attachments
    if single:
        page = store.get_page(page_id)
        data = _render(store, page, fmt, lambda kind, attrs: _plain_url(kind, attrs), {})
        handle = _spool()
        handle.write(data.encode("utf-8"))
        return _finish(handle, safe_filename(page["title"] or "Untitled") + ext,
                       "text/markdown; charset=utf-8" if fmt == "markdown" else "text/html; charset=utf-8")
    # an archive
    paths: dict[str, str] = {}  # page id -> path in the archive
    entries: list[tuple[dict, str]] = []

    def assign(nodes: list[dict], folder: str, used: set[str]) -> None:
        for node in nodes:
            page = node["page"]
            name = _unique(used, safe_filename(page["title"] or "Untitled"), ext)
            path = f"{folder}{name}"
            paths[page["id"]] = path
            entries.append((page, path))
            if node["children"]:
                assign(node["children"], f"{folder}{name[: -len(ext)]}/", set())

    assign(roots, "", set())
    handle = _spool()
    files: dict[str, str] = {}  # attachment id -> path
    used_files: set[str] = set()
    with zipfile.ZipFile(handle, "w", zipfile.ZIP_DEFLATED) as archive:
        for page_row, path in entries:
            page = store.get_page(page_row["id"])
            depth = path.count("/")
            prefix = "../" * depth
            if include_attachments:
                for att_id in attachment_ids(page.get("content")):
                    if att_id in files:
                        continue
                    try:
                        item, blob = store.read_attachment(att_id)
                    except KhaiDocsError:
                        continue
                    name = _unique(used_files, safe_filename(item["file_name"], "file"), "")
                    files[att_id] = f"files/{name}"
                    archive.writestr(f"files/{name}", blob)

            def url(kind: str, attrs: dict, prefix: str = prefix) -> str:
                return _archive_url(kind, attrs, prefix, files, paths, store)

            archive.writestr(path, _render(store, page, fmt, url, files).encode("utf-8"))
    return _finish(handle, archive_name + ".zip", "application/zip")


def _plain_url(kind: str, attrs: dict) -> str:
    if kind == "page":
        return f"/p/{attrs.get('slugId')}"
    return str(attrs.get("src") or attrs.get("url") or "")


def _archive_url(kind: str, attrs: dict, prefix: str, files: dict, paths: dict, store: KhaiDocsStore) -> str:
    if kind == "page":
        target = attrs.get("entityId")
        if target in paths:
            return prefix + "/".join(quote(p) for p in paths[target].split("/"))
        return f"/p/{attrs.get('slugId')}"
    original = str(attrs.get("src") or attrs.get("url") or "")
    ident = attrs.get("attachmentId")
    if not ident:
        match = _FILE_ID.search(original)
        ident = match.group(1) if match else None
    if ident in files:
        return prefix + "/".join(quote(p) for p in files[ident].split("/"))
    return original


def _render(store: KhaiDocsStore, page: dict, fmt: str, url: Any, files: dict) -> str:
    doc = page.get("content") or {"type": "doc", "content": [{"type": "paragraph"}]}
    title = page.get("title") or ""
    if fmt == "markdown":
        return pm_to_md(doc, url=url, title=title or None)
    return pm_to_html(doc, url=url, title=title or "Untitled")


def export_docx(store: KhaiDocsStore, page_id: str) -> Export:
    page = store.get_page(page_id)
    cache: dict[str, tuple[bytes, str] | None] = {}

    def image_bytes(attrs: dict) -> tuple[bytes, str] | None:
        ident = attrs.get("attachmentId")
        if not ident:
            match = _FILE_ID.search(str(attrs.get("src") or ""))
            ident = match.group(1) if match else None
        if not ident:
            return None
        if ident not in cache:
            try:
                item, blob = store.read_attachment(str(ident))
                cache[ident] = (blob, item["mime_type"])
            except (KhaiDocsError, NotFound):
                cache[ident] = None
        return cache[ident]

    data = pm_to_docx(page.get("content") or {"type": "doc", "content": []},
                      title=page.get("title") or None, image_bytes=image_bytes)
    handle = _spool()
    handle.write(data)
    return _finish(
        handle, safe_filename(page["title"] or "Untitled") + ".docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
