"""Importing Markdown, HTML, text, Word and zip archives as pages.

Everything goes through :class:`KhaiDocsStore` (``create_page`` /
``set_content``), so an imported page is an ordinary page. Images that come
with the import (data: URIs, files next to a page in a zip, pictures inside a
.docx) are stored as attachments of the new page and the document points at
``/api/files/<id>/<name>``.
"""

from __future__ import annotations

import base64
import mimetypes
import os
import posixpath
import re
import unicodedata
from collections.abc import Callable
from typing import Any
from urllib.parse import quote

from core.khaidocs.docx_pm import docx_to_pm
from core.khaidocs.errors import Invalid, KhaiDocsError, TooLarge
from core.khaidocs.html_pm import html_to_pm
from core.khaidocs.markdown_pm import md_to_pm
from core.khaidocs.safezip import SafeZip
from core.khaidocs.store import KhaiDocsStore
from core.khaidocs.text import doc_of, nfc

MD_EXT = (".md", ".markdown", ".mdown")
HTML_EXT = (".html", ".htm")
TEXT_EXT = (".txt",)
DOCX_EXT = (".docx",)
PAGE_EXT = MD_EXT + HTML_EXT + TEXT_EXT + DOCX_EXT
IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/svg+xml",
               "image/avif"}
MAX_PAGES = int(os.environ.get("KHAIDOCS_IMPORT_MAX_PAGES", "2000"))
MAX_DATA_URI = 20 * 1024 * 1024
_NOTION_ID = re.compile(r"\s+[0-9a-f]{32}$")
_DATA_URI = re.compile(r"^data:([\w/+.-]+)?(;[\w=.-]+)*?;base64,(.*)$", re.S)
Progress = Callable[[int, int], None]


def attachment_url(att: dict) -> str:
    return f"/api/files/{att['id']}/{quote(att['file_name'], safe='')}"


def title_from_name(name: str, *, notion: bool = False) -> str:
    stem = posixpath.splitext(posixpath.basename(name.replace("\\", "/")))[0]
    if notion:
        stem = _NOTION_ID.sub("", stem)
    return nfc(stem.strip()) or "Untitled"


def split_title(doc: dict) -> tuple[str | None, dict]:
    """A leading level-1 heading becomes the title and leaves the body."""

    content = doc.get("content") or []
    if content and content[0].get("type") == "heading" and (content[0].get("attrs") or {}).get("level") == 1:
        text = "".join(n.get("text", "") for n in content[0].get("content") or [] if n.get("type") == "text")
        rest = content[1:]
        if text.strip():
            return text.strip()[:500], {"type": "doc", "content": rest or [{"type": "paragraph"}]}
    return None, doc


def text_to_doc(text: str) -> dict:
    return doc_of(nfc(text.replace("\r\n", "\n").replace("\r", "\n")))


def decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16"):
        try:
            return data.decode(encoding)
        except UnicodeError:
            continue
    return data.decode("latin-1")


class Importer:
    def __init__(self, store: KhaiDocsStore, space_id: str, parent_page_id: str | None = None) -> None:
        self.store = store
        self.space_id = space_id
        self.parent_page_id = parent_page_id
        self.skipped: list[str] = []
        self.attachments = 0

    # -- attachments --------------------------------------------------------------

    def _attach(self, page_id: str, data: bytes, name: str, mime: str | None = None) -> dict | None:
        mime = mime or mimetypes.guess_type(name)[0] or "application/octet-stream"
        try:
            att = self.store.save_attachment(file_name=name, data=data, mime_type=mime, page_id=page_id)
        except KhaiDocsError as exc:
            self.skipped.append(f"{name[:60]}: {exc}")
            return None
        self.attachments += 1
        return att

    def sink_for(self, page_id: str):
        """An image sink for .docx pictures (see docx_pm.docx_to_pm)."""

        def sink(blob: bytes, mime: str, name: str) -> dict | None:
            att = self._attach(page_id, blob, name, mime)
            if att is None:
                return None
            return {"src": attachment_url(att), "attachmentId": att["id"]}

        return sink

    def attach_images(self, doc: dict, page_id: str, resolver: Callable[[str], tuple[bytes, str] | None] | None) -> None:
        """Rewrite image sources: data: URIs and ``resolver(src)`` hits become attachments."""

        cache: dict[str, dict | None] = {}

        def convert(src: str) -> dict | None:
            if src in cache:
                return cache[src]
            result = None
            match = _DATA_URI.match(src)
            if match:
                mime = (match.group(1) or "image/png").lower()
                if mime in IMAGE_TYPES and len(match.group(3)) <= MAX_DATA_URI * 4 // 3:
                    try:
                        data = base64.b64decode(match.group(3), validate=False)
                    except ValueError:
                        data = b""
                    ext = mimetypes.guess_extension(mime) or ".png"
                    if data:
                        result = self._attach(page_id, data, f"image{ext}", mime)
            elif resolver is not None:
                found = resolver(src)
                if found:
                    result = self._attach(page_id, found[0], found[1])
            cache[src] = result
            return result

        def walk(node: Any) -> None:
            if isinstance(node, list):
                for item in node:
                    walk(item)
            elif isinstance(node, dict):
                if node.get("type") == "image":
                    attrs = node.setdefault("attrs", {})
                    src = attrs.get("src") or ""
                    if src and not attrs.get("attachmentId"):
                        att = convert(src)
                        if att:
                            attrs["src"] = attachment_url(att)
                            attrs["attachmentId"] = att["id"]
                            attrs.setdefault("alt", attrs.get("alt") or att["file_name"])
                for mark_owner in node.get("content") or []:
                    walk(mark_owner)

        walk(doc.get("content") or [])

    # -- single files ---------------------------------------------------------------

    def convert(self, name: str, data: bytes) -> dict | None:
        """ProseMirror JSON for md/html/txt content (docx needs a page first)."""

        lowered = name.lower()
        if lowered.endswith(MD_EXT):
            return md_to_pm(decode_text(data))
        if lowered.endswith(HTML_EXT):
            return html_to_pm(decode_text(data))
        if lowered.endswith(TEXT_EXT):
            return text_to_doc(decode_text(data))
        return None

    def import_file(self, name: str, data: bytes, *, parent_page_id: str | None = None,
                    title: str | None = None) -> dict:
        lowered = name.lower()
        if not lowered.endswith(PAGE_EXT):
            raise Invalid("Unsupported file type. Import .md, .html, .txt or .docx files.")
        parent = parent_page_id if parent_page_id is not None else self.parent_page_id
        fallback = title or title_from_name(name)
        if lowered.endswith(DOCX_EXT):
            page = self.store.create_page(space_id=self.space_id, parent_page_id=parent,
                                          title=fallback, updated_by="import")
            try:
                doc = docx_to_pm(data, image_sink=self.sink_for(page["id"]))
            except KhaiDocsError:
                self.store.delete_page(page["id"])
                raise
            except Exception as exc:  # python-docx raises many types for a damaged file
                self.store.delete_page(page["id"])
                raise Invalid("The .docx file could not be read") from exc
            found, doc = split_title(doc)
            if found and not title:
                self.store.update_page(page["id"], title=found, updated_by="import")
            self.store.set_content(page["id"], doc, updated_by="import")
            return self.store.get_page(page["id"], with_content=True)
        doc = self.convert(name, data) or {"type": "doc", "content": [{"type": "paragraph"}]}
        found, doc = split_title(doc) if lowered.endswith(MD_EXT + HTML_EXT) else (None, doc)
        page = self.store.create_page(space_id=self.space_id, parent_page_id=parent,
                                      title=title or found or fallback, updated_by="import")
        self.attach_images(doc, page["id"], None)
        self.store.set_content(page["id"], doc, updated_by="import")
        return self.store.get_page(page["id"], with_content=True)

    # -- zip archives ---------------------------------------------------------------

    def import_zip(self, data: bytes, *, source: str | None = None,
                   progress: Progress | None = None) -> dict:
        archive = SafeZip(data)
        notion = (source or "") == "notion"
        keys: dict[str, str] = {}
        for name in archive.names:
            if name.lower().endswith(PAGE_EXT):
                key = posixpath.splitext(name)[0]
                keys[key if key not in keys else name] = name
        if not keys:
            raise Invalid("The archive contains no .md, .html, .txt or .docx files")
        if len(keys) > MAX_PAGES:
            raise TooLarge(f"The archive has more than {MAX_PAGES} pages")
        nodes: dict[str, dict] = {k: {"key": k, "file": f, "page": None} for k, f in keys.items()}
        for key in list(nodes):
            parent = posixpath.dirname(key)
            while parent and parent not in nodes:
                nodes[parent] = {"key": parent, "file": None, "page": None}
                parent = posixpath.dirname(parent)
        order = sorted(nodes.values(), key=lambda n: (n["key"].count("/"), _natural(n["key"])))
        total = len(order)
        if progress:
            progress(0, total)
        # pass 1: the page tree (titles only), so links between pages can be rewired
        for node in order:
            parent = nodes.get(posixpath.dirname(node["key"]))
            node["page"] = self.store.create_page(
                space_id=self.space_id,
                parent_page_id=parent["page"]["id"] if parent else self.parent_page_id,
                title=title_from_name(node["key"], notion=notion), updated_by="import",
            )
        by_file = {n["file"]: n for n in nodes.values() if n["file"]}
        # pass 2: content
        for done, node in enumerate(order, 1):
            if node["file"]:
                try:
                    self._fill(archive, node, by_file, notion)
                except KhaiDocsError as exc:
                    self.skipped.append(f"{node['file'][:80]}: {exc}")
                except Exception as exc:  # noqa: BLE001 - one bad file must not stop the import
                    self.skipped.append(f"{node['file'][:80]}: could not be converted ({type(exc).__name__})")
            if progress:
                progress(done, total)
        roots = [n["page"] for n in order if posixpath.dirname(n["key"]) not in nodes]
        return {
            "pages": total, "attachments": self.attachments, "skipped": (archive.skipped + self.skipped)[:50],
            "rootPageIds": [p["id"] for p in roots],
        }

    def _fill(self, archive: SafeZip, node: dict, by_file: dict, notion: bool) -> None:
        name = node["file"]
        page = node["page"]
        data = archive.read(name)
        base = posixpath.dirname(name)
        if name.lower().endswith(DOCX_EXT):
            try:
                doc = docx_to_pm(data, image_sink=self.sink_for(page["id"]))
            except KhaiDocsError:
                raise
            except Exception as exc:
                raise Invalid("The .docx file could not be read") from exc
            found, doc = split_title(doc)
        else:
            doc = self.convert(name, data) or {"type": "doc", "content": [{"type": "paragraph"}]}
            found, doc = split_title(doc) if name.lower().endswith(MD_EXT + HTML_EXT) else (None, doc)

            def resolver(src: str) -> tuple[bytes, str] | None:
                target = archive.resolve(base, src)
                if target and not target.lower().endswith(PAGE_EXT):
                    return archive.read(target), posixpath.basename(target)
                return None

            self.attach_images(doc, page["id"], resolver)
        self._rewire_links(doc, archive, base, by_file, page["id"])
        if found:
            self.store.update_page(page["id"], title=nfc(_NOTION_ID.sub("", found) if notion else found),
                                   updated_by="import")
        self.store.set_content(page["id"], doc, updated_by="import")

    def _rewire_links(self, doc: dict, archive: SafeZip, base: str, by_file: dict, page_id: str) -> None:
        def walk(node: Any) -> None:
            if isinstance(node, list):
                for item in node:
                    walk(item)
            elif isinstance(node, dict):
                for mark in node.get("marks") or []:
                    if mark.get("type") != "link":
                        continue
                    attrs = mark.get("attrs") or {}
                    href = attrs.get("href") or ""
                    target = archive.resolve(base, href) if href else None
                    if not target:
                        continue
                    if target in by_file:
                        other = by_file[target]["page"]
                        attrs["href"] = f"/p/{other['slug_id']}"
                        attrs["internal"] = True
                    else:
                        att = self._attach(page_id, archive.read(target), posixpath.basename(target))
                        if att:
                            attrs["href"] = attachment_url(att)
                walk(node.get("content"))

        walk(doc.get("content"))


def _natural(value: str) -> list:
    return [int(p) if p.isdigit() else unicodedata.normalize("NFC", p).casefold()
            for p in re.split(r"(\d+)", value)]
