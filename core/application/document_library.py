"""The Documents library: files people uploaded and documents the agent made.

Nothing is copied: the library is a view over the Thread workspaces.

* **Uploaded** — every ``deepcode-upload-<hex>-<name>`` file the web upload
  endpoint wrote into a workspace root. It belongs to the Thread whose prompt
  mentions it (the composer lists attachments in the prompt), else to the
  workspace's most recent Thread.
* **Created by agent** — document-type files (PDF, Word, Excel, slides,
  Markdown, ...) that an agent tool wrote: paths named by file-change and
  non-read tool calls in the Thread's items. In the plain-chats workspace,
  where people never put files by hand, every other document file counts too.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from core.persistence.database import Database

DOCUMENT_SUFFIXES = frozenset(
    {
        ".pdf", ".docx", ".doc", ".odt", ".rtf",
        ".xlsx", ".xls", ".ods", ".csv", ".tsv",
        ".pptx", ".ppt", ".odp",
        ".md", ".markdown", ".txt", ".html", ".htm",
    }
)
UPLOAD_PREFIX = "deepcode-upload-"
_UPLOAD_NAME = re.compile(r"^deepcode-upload-[0-9a-f]{24}-(.+)$")
_PATH_TOKEN = re.compile(
    r"[\w./\\:\-]*?[\w\-]+\.(?:" + "|".join(s[1:] for s in DOCUMENT_SUFFIXES) + r")\b",
    re.IGNORECASE,
)
_READ_TOOLS = ("read", "glob", "grep", "search", "list", "find", "fetch", "scrape")
_SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build"}
_SCAN_LIMIT = 4000


@dataclass(frozen=True, slots=True)
class DocumentEntry:
    id: str
    name: str
    path: str
    thread_id: str
    thread_title: str
    project_id: str
    project_name: str
    source: str  # "uploaded" | "agent"
    size: int
    modified_at: str
    extension: str
    # False when no existing Thread mentions the file (its chat was deleted):
    # it stays in the library, reachable through a Thread of the same
    # workspace, but is not shown as that Thread's document.
    linked: bool = True

    def to_wire(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "path": self.path,
            "threadId": self.thread_id,
            "threadTitle": self.thread_title,
            "projectId": self.project_id,
            "projectName": self.project_name,
            "source": self.source,
            "size": self.size,
            "modifiedAt": self.modified_at,
            "extension": self.extension,
            "linked": self.linked,
        }


def display_name(filename: str) -> str:
    match = _UPLOAD_NAME.match(filename)
    return match.group(1) if match else filename


def is_document(path: str) -> bool:
    return Path(path).suffix.lower() in DOCUMENT_SUFFIXES


@dataclass(slots=True)
class _Thread:
    id: str
    title: str
    root: Path
    project_id: str
    project_name: str
    chats: bool
    prompts: str = ""
    mentioned: tuple[str, ...] = ()


class DocumentLibrary:
    def __init__(self, database: Database) -> None:
        self.database = database

    def list(
        self, *, limit: int = 500, thread_id: str | None = None
    ) -> list[DocumentEntry]:
        """All documents, newest first; or only those of one Thread."""
        threads = self._threads()
        by_root: dict[Path, list[_Thread]] = {}
        for thread in threads:  # newest first
            by_root.setdefault(thread.root, []).append(thread)

        found: dict[Path, DocumentEntry] = {}
        for root, owners in by_root.items():
            if not root.is_dir():
                continue
            self._collect_uploads(root, owners, found)
            self._collect_agent_files(root, owners, found)
        entries = sorted(found.values(), key=lambda entry: entry.modified_at, reverse=True)
        if thread_id is not None:
            entries = [
                entry for entry in entries if entry.thread_id == thread_id and entry.linked
            ]
        return entries[:limit]

    # -- sources ------------------------------------------------------------

    def _threads(self) -> list[_Thread]:
        with self.database.read() as connection:
            rows = connection.execute(
                """
                SELECT t.id, t.title, t.workspace_path, t.worktree_path,
                       p.id AS project_id, p.display_name, p.canonical_path
                FROM threads t JOIN projects p ON p.id = t.project_id
                WHERE t.status <> 'archived'
                ORDER BY t.updated_at DESC
                """
            ).fetchall()
            prompts: dict[str, list[str]] = {}
            for thread_id, prompt in connection.execute(
                "SELECT thread_id, prompt FROM turns"
            ):
                prompts.setdefault(thread_id, []).append(prompt or "")
            mentioned: dict[str, list[str]] = {}
            for thread_id, payload_json in connection.execute(
                "SELECT thread_id, payload_json FROM items"
                " WHERE kind IN ('file_change', 'tool_call', 'artifact')"
            ):
                mentioned.setdefault(thread_id, []).extend(_written_paths(payload_json))
        threads = []
        for row in rows:
            root = Path(row[3] or row[2])
            canonical = str(row[6]).replace("\\", "/")
            threads.append(
                _Thread(
                    id=row[0],
                    title=row[1],
                    root=root,
                    project_id=row[4],
                    project_name=row[5],
                    chats=row[5] == "Chats" and canonical.endswith("/chats"),
                    prompts="\n".join(prompts.get(row[0], [])),
                    mentioned=tuple(mentioned.get(row[0], [])),
                )
            )
        return threads

    def _collect_uploads(
        self, root: Path, owners: list[_Thread], found: dict[Path, DocumentEntry]
    ) -> None:
        try:
            names = [
                entry.name
                for entry in os.scandir(root)
                if entry.name.startswith(UPLOAD_PREFIX) and entry.is_file(follow_symlinks=False)
            ]
        except OSError:
            return
        for name in names:
            owner = next((t for t in owners if name in t.prompts), None)
            self._add(
                found, root / name, root, owner or owners[0], "uploaded", linked=owner is not None
            )

    def _collect_agent_files(
        self, root: Path, owners: list[_Thread], found: dict[Path, DocumentEntry]
    ) -> None:
        for owner in reversed(owners):  # newest owner wins a shared path
            for raw in owner.mentioned:
                candidate = Path(raw)
                path = candidate if candidate.is_absolute() else root / candidate
                if _inside(path, root) and path.name and not path.name.startswith(UPLOAD_PREFIX):
                    self._add(found, path, root, owner, "agent")
        if not any(owner.chats for owner in owners):
            return
        # Plain chats: nobody adds files by hand, so any document is the agent's.
        scanned = 0
        for directory, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS and not d.startswith(".")]
            for name in filenames:
                scanned += 1
                if scanned > _SCAN_LIMIT:
                    return
                if name.startswith(UPLOAD_PREFIX) or name.startswith(".") or not is_document(name):
                    continue
                path = Path(directory) / name
                if path in found:
                    continue
                relative = path.relative_to(root).as_posix()
                owner = next(
                    (t for t in owners if relative in t.mentioned or name in t.prompts),
                    None,
                )
                self._add(
                    found, path, root, owner or owners[0], "agent", linked=owner is not None
                )

    @staticmethod
    def _add(
        found: dict[Path, DocumentEntry],
        path: Path,
        root: Path,
        owner: _Thread,
        source: str,
        *,
        linked: bool = True,
    ) -> None:
        if not is_document(path.name):
            return
        try:
            stat = path.stat()
        except OSError:
            return
        if not path.is_file():
            return
        relative = path.relative_to(root).as_posix()
        found[path] = DocumentEntry(
            id=f"{owner.id}:{relative}",
            name=display_name(path.name),
            path=relative,
            thread_id=owner.id,
            thread_title=owner.title,
            project_id=owner.project_id,
            project_name=owner.project_name,
            source=source,
            size=stat.st_size,
            modified_at=datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
            extension=path.suffix.lower().lstrip("."),
            linked=linked,
        )


def _inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except (OSError, ValueError):
        return False
    return True


def _written_paths(payload_json: str) -> list[str]:
    """Document paths a write-like tool call names (not ones it only read)."""
    try:
        payload = json.loads(payload_json or "{}")
    except json.JSONDecodeError:
        return []
    name = str(payload.get("name") or "").lower()
    if any(token in name for token in _READ_TOOLS) and not any(
        token in name for token in ("write", "create", "export", "save", "generate")
    ):
        return []
    texts = [str(payload.get("detail") or "")]
    activity = payload.get("activity")
    if isinstance(activity, dict):
        texts.append(str(activity.get("subject") or ""))
    for key in ("path", "paths", "files", "changes"):
        value = payload.get(key)
        if value:
            texts.append(json.dumps(value))
    texts.append(str(payload.get("resultPreview") or "")[:4000])
    paths: list[str] = []
    for text in texts:
        for match in _PATH_TOKEN.findall(text):
            cleaned = match.strip().strip("\"'`").lstrip("./") if not match.strip().startswith("/") else match.strip()
            if cleaned and "://" not in cleaned:
                paths.append(cleaned)
    return paths


__all__ = ["DocumentEntry", "DocumentLibrary", "display_name", "is_document"]
