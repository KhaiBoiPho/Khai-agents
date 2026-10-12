"""KhaiDocs pages as virtual documents of the document index.

``KhaiDocsIndex`` is a :class:`DocumentIndex` whose "files" are the user's
live KhaiDocs pages, so ``search_documents`` can answer from the wiki with the
same chunking, embeddings, hybrid retrieval and contextual enrichment as for
files. Nothing is copied to disk.

* path  ``khaidocs/<space slug>/<title>-<slug id>``  (the trailing slug id is
  what ``khaidocs_read`` takes), locator = the section heading;
* change detection (size, mtime) = (page version, updated_at), so only edited
  pages are embedded again, and a page whose text did not change is only
  touched (content hash);
* trashed or deleted pages leave the live list, so the index drops them on the
  next run;
* bounded cost: at most ``KHAIDOCS_RAG_MAX_PAGES`` pages (newest first,
  default 300) and ``KHAIDOCS_RAG_MAX_CHARS`` characters per page (default
  60000). Contextual enrichment keeps its own per-document chunk cap.
* ``KHAIDOCS_RAG=0`` switches the bridge off.
"""

from __future__ import annotations

import hashlib
import os
import re

from core.khaidocs import KhaiDocsError
from core.khaidocs.agent_markdown import pm_to_markdown
from core.rag.extract import Section
from core.rag.index import DocumentIndex, FileState

KHAIDOCS_ROOT = "khaidocs:"
PATH_PREFIX = "khaidocs/"
ENABLE_ENV = "KHAIDOCS_RAG"
MAX_PAGES_ENV = "KHAIDOCS_RAG_MAX_PAGES"
MAX_CHARS_ENV = "KHAIDOCS_RAG_MAX_CHARS"
_HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")


def enabled() -> bool:
    return os.environ.get(ENABLE_ENV, "1").strip().lower() not in {"0", "false", "no", "off"}


def _int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, "") or default))
    except ValueError:
        return default


def is_khaidocs_root(root: object) -> bool:
    return str(root) == KHAIDOCS_ROOT


def is_khaidocs_path(path: str) -> bool:
    return path.startswith(PATH_PREFIX)


def page_path(space_slug: str, title: str, slug_id: str) -> str:
    clean = re.sub(r"[\\/\s]+", " ", title or "Untitled").strip()[:60].strip() or "Untitled"
    return f"{PATH_PREFIX}{space_slug or 'space'}/{clean}-{slug_id}"


def slug_of(path: str) -> str:
    return path.rsplit("-", 1)[-1]


def split_sections(title: str, markdown: str, limit: int) -> list[Section]:
    """Heading-based sections; the locator is the section's own heading."""

    markdown = markdown[:limit]
    sections: list[Section] = []
    trail: list[tuple[int, str]] = []
    heading, locator, body = title, "", []
    in_code = False

    def flush() -> None:
        text = "\n".join(body).strip()
        if text:
            sections.append(Section(text=text, locator=locator, heading=heading))
        body.clear()

    for line in markdown.splitlines():
        if line.startswith("```"):
            in_code = not in_code
        match = None if in_code else _HEADING.match(line)
        if match is None:
            body.append(line)
            continue
        flush()
        level, text = len(match.group(1)), match.group(2)
        trail = [(lv, t) for lv, t in trail if lv < level] + [(level, text)]
        locator = text
        heading = " > ".join([title] + [t for _lv, t in trail])
    flush()
    return sections


class KhaiDocsIndex(DocumentIndex):
    def __init__(self, root, store, source, **kwargs) -> None:  # noqa: ANN001
        super().__init__(root, store, **kwargs)
        self.source = source
        self._known: dict[str, dict] = {}
        self._loaded: dict[str, dict] = {}

    def scan(self) -> tuple[dict[str, FileState], bool]:
        spaces = {s["id"]: s["slug"] for s in self.source.list_spaces()}
        pages = sorted(
            self.source.all_pages(), key=lambda p: p["updated_at"], reverse=True
        )
        limit = min(self.max_documents, _int_env(MAX_PAGES_ENV, 300))
        files: dict[str, FileState] = {}
        self._known = {}
        for page in pages[:limit]:
            path = page_path(spaces.get(page["space_id"], ""), page["title"], page["slug_id"])
            files[path] = FileState(
                int(page["version"]), int(page["updated_at"].timestamp() * 1_000_000_000)
            )
            self._known[path] = page
        return files, len(pages) > limit

    def _load(self, path: str) -> dict:
        page = self._loaded.get(path)
        if page is None:
            try:
                page = self.source.get_page(slug_of(path))
            except KhaiDocsError as exc:  # trashed since the scan
                raise OSError(str(exc)) from exc
            self._loaded = {path: page}  # one page at a time
        return page

    def _digest_of(self, path: str) -> str:
        page = self._load(path)
        text = pm_to_markdown(page.get("content"))[: _int_env(MAX_CHARS_ENV, 60_000)]
        return hashlib.sha256(f"{page['title']}\0{text}".encode()).hexdigest()

    def _sections_of(self, path: str, visual, stats):  # noqa: ANN001
        page = self._load(path)
        limit = _int_env(MAX_CHARS_ENV, 60_000)
        title = page["title"] or "Untitled"
        sections = split_sections(title, pm_to_markdown(page.get("content")), limit)
        return sections or ([Section(text=title, heading=title)] if page["title"] else [])


__all__ = [
    "ENABLE_ENV",
    "KHAIDOCS_ROOT",
    "KhaiDocsIndex",
    "enabled",
    "is_khaidocs_path",
    "is_khaidocs_root",
    "page_path",
    "slug_of",
    "split_sections",
]
