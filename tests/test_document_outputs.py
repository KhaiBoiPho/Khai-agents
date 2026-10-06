"""Document file cards: which tool outputs surface as chat documents."""

from __future__ import annotations

import json
from pathlib import Path

from core.application.document_outputs import document_outputs
from core.application.turn_projection import TurnEventProjector
from core.events import ToolCompleted


def _envelope(path: Path | str) -> str:
    return json.dumps(
        {
            "status": "ok",
            "command": "create",
            "summary": "created",
            "output_path": str(path),
        }
    )


def test_output_path_inside_workspace_becomes_relative_document(
    tmp_path: Path,
) -> None:
    deck = tmp_path / "decks" / "pitch.pptx"
    deck.parent.mkdir()
    deck.write_bytes(b"x" * 42)
    documents = document_outputs(
        result_preview=_envelope(deck), edited_path=None, workspace=tmp_path
    )
    assert documents == [
        {
            "path": "decks/pitch.pptx",
            "name": "pitch.pptx",
            "extension": "pptx",
            "sizeBytes": 42,
        }
    ]


def test_directories_outside_paths_and_non_documents_are_ignored(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "ws"
    (workspace / "shots").mkdir(parents=True)
    (workspace / "shots.pdf").mkdir()  # a directory with a document suffix
    (workspace / "notes.txt").write_text("x")
    outside = tmp_path / "outside.docx"
    outside.write_text("x")
    for path in (
        workspace / "shots",
        workspace / "shots.pdf",
        workspace / "notes.txt",
        outside,
        workspace / "missing.docx",
    ):
        assert (
            document_outputs(
                result_preview=_envelope(path), edited_path=None, workspace=workspace
            )
            == []
        )
    assert document_outputs(result_preview=None, edited_path=None, workspace=None) == []


def test_edited_relative_path_and_truncated_preview(tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text("# hi")
    truncated = '{"status":"ok","summary":"…'
    documents = document_outputs(
        result_preview=truncated, edited_path="README.md", workspace=tmp_path
    )
    assert [document["path"] for document in documents] == ["README.md"]


def test_projector_attaches_documents_only_to_successful_calls(
    tmp_path: Path,
) -> None:
    report = tmp_path / "report.docx"
    report.write_bytes(b"docx")
    projector = TurnEventProjector.__new__(TurnEventProjector)
    projector._tool_edit_paths = {}
    projector._workspace = tmp_path
    ok = ToolCompleted(
        call_id="c1",
        name="mcp__genoffice__create_docx",
        result_preview=_envelope(report),
        is_error=False,
    )
    failed = ToolCompleted(
        call_id="c2",
        name="mcp__genoffice__create_docx",
        result_preview=_envelope(report),
        is_error=True,
    )
    assert projector._documents_for(ok)[0]["path"] == "report.docx"
    assert projector._documents_for(failed) == []
