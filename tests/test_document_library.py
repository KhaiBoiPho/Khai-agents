"""The Documents library: uploads and agent-written documents per Thread."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from core.application.document_library import DocumentLibrary, display_name


class _Database:
    def __init__(self, path: Path) -> None:
        self.path = path

    @contextmanager
    def read(self):
        connection = sqlite3.connect(self.path)
        try:
            yield connection
        finally:
            connection.close()


def _database(tmp_path: Path, chats: Path, project: Path) -> _Database:
    path = tmp_path / "app.sqlite3"
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE projects (id TEXT, canonical_path TEXT, display_name TEXT);
        CREATE TABLE threads (id TEXT, project_id TEXT, title TEXT, status TEXT,
            workspace_path TEXT, worktree_path TEXT, updated_at TEXT);
        CREATE TABLE turns (thread_id TEXT, prompt TEXT);
        CREATE TABLE items (thread_id TEXT, kind TEXT, payload_json TEXT);
        """
    )
    connection.executemany(
        "INSERT INTO projects VALUES (?, ?, ?)",
        [("p-chats", str(chats), "Chats"), ("p-code", str(project), "repo")],
    )
    connection.executemany(
        "INSERT INTO threads VALUES (?, ?, ?, 'idle', ?, NULL, ?)",
        [
            ("t-cv", "p-chats", "Review my CV", str(chats), "2026-10-02"),
            ("t-other", "p-chats", "Other chat", str(chats), "2026-10-03"),
            ("t-code", "p-code", "Write the report", str(project), "2026-10-01"),
        ],
    )
    upload = "deepcode-upload-0123456789abcdef01234567-cv.pdf"
    connection.executemany(
        "INSERT INTO turns VALUES (?, ?)",
        [("t-cv", f"review\n\nAttached workspace context:\n- {upload}")],
    )
    connection.executemany(
        "INSERT INTO items VALUES (?, ?, ?)",
        [
            ("t-code", "file_change", json.dumps({"name": "write", "detail": "docs/report.docx"})),
            ("t-code", "tool_call", json.dumps({"name": "read", "detail": "README.md"})),
        ],
    )
    connection.commit()
    connection.close()
    return _Database(path)


def test_lists_uploads_and_agent_documents(tmp_path: Path) -> None:
    chats = tmp_path / "chats"
    project = tmp_path / "repo"
    (project / "docs").mkdir(parents=True)
    chats.mkdir()
    (chats / "deepcode-upload-0123456789abcdef01234567-cv.pdf").write_bytes(b"%PDF")
    (chats / "summary.md").write_text("# Summary")
    (project / "docs" / "report.docx").write_bytes(b"PK")
    (project / "README.md").write_text("readme")  # only read: not a document of ours
    (project / "main.py").write_text("print()")

    library = DocumentLibrary(_database(tmp_path, chats, project))  # type: ignore[arg-type]
    entries = library.list()
    by_name = {entry.name: entry for entry in entries}

    assert set(by_name) == {"cv.pdf", "summary.md", "report.docx"}
    assert by_name["cv.pdf"].source == "uploaded"
    assert by_name["cv.pdf"].thread_id == "t-cv"  # the prompt that attached it
    assert by_name["report.docx"].source == "agent"
    assert by_name["report.docx"].path == "docs/report.docx"
    assert by_name["summary.md"].source == "agent"

    only_cv = library.list(thread_id="t-cv")
    assert [entry.name for entry in only_cv] == ["cv.pdf"]
    # summary.md is mentioned by no chat: listed, but nobody's own document.
    assert by_name["summary.md"].linked is False
    assert library.list(thread_id="t-other") == []


def test_display_name_strips_upload_prefix() -> None:
    assert display_name("deepcode-upload-0123456789abcdef01234567-a b.pdf") == "a b.pdf"
    assert display_name("plain.pdf") == "plain.pdf"
