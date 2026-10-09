"""The Documents library: uploads and agent-written documents per Thread."""

from __future__ import annotations

import json
from pathlib import Path

from core.application.document_library import DocumentLibrary, display_name
from core.persistence.database import Database

NOW = "2026-10-01T00:00:00Z"


def _database(tmp_path: Path, chats: Path, project: Path) -> Database:
    database = Database(tmp_path / "state")
    database.initialize()
    with database.transaction() as connection:
        connection.executemany(
            "INSERT INTO projects (id, canonical_path, display_name, trust_state, "
            "created_at, updated_at, last_opened_at) VALUES (?, ?, ?, 'trusted', ?, ?, ?)",
            [
                ("p-chats", str(chats), "Chats", NOW, NOW, NOW),
                ("p-code", str(project), "repo", NOW, NOW, NOW),
            ],
        )
        connection.executemany(
            "INSERT INTO threads (id, project_id, title, mode, status, workspace_path, "
            "created_at, updated_at) VALUES (?, ?, ?, 'code', 'idle', ?, ?, ?)",
            [
                ("t-cv", "p-chats", "Review my CV", str(chats), NOW, "2026-10-02"),
                ("t-other", "p-chats", "Other chat", str(chats), NOW, "2026-10-03"),
                ("t-code", "p-code", "Write the report", str(project), NOW, "2026-10-01"),
            ],
        )
        upload = "deepcode-upload-0123456789abcdef01234567-cv.pdf"
        connection.executemany(
            "INSERT INTO turns (id, thread_id, ordinal, prompt, status, completed_at) "
            "VALUES (?, ?, 1, ?, 'completed', ?)",
            [
                ("turn-cv", "t-cv", f"review\n\nAttached workspace context:\n- {upload}", NOW),
                ("turn-code", "t-code", "write the report", NOW),
            ],
        )
        connection.executemany(
            "INSERT INTO items (id, thread_id, turn_id, ordinal, kind, status, summary, "
            "payload_json, created_at, updated_at) "
            "VALUES (?, 't-code', 'turn-code', ?, ?, 'completed', '', ?, ?, ?)",
            [
                ("i-1", 1, "file_change", json.dumps({"name": "write", "detail": "docs/report.docx"}), NOW, NOW),
                ("i-2", 2, "tool_call", json.dumps({"name": "read", "detail": "README.md"}), NOW, NOW),
            ],
        )
    return database


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

    library = DocumentLibrary(_database(tmp_path, chats, project))
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
