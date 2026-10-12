from pathlib import Path

from core.deepthink.attachments import inline_attachments
from core.deepthink.prompts import SUMMARIZE_NO_SOURCES_SYSTEM


def _prompt(question: str, *paths: Path) -> str:
    return question + "\n\nAttached workspace context:\n" + "\n".join(f"- {p}" for p in paths)


def test_upload_text_is_inlined_under_its_original_name(tmp_path: Path) -> None:
    upload = tmp_path / "deepcode-upload-326c095def3228af886a7c62-lo-trinh.md"
    upload.write_text("# Lộ trình\nGiai đoạn 0", encoding="utf-8")

    result = inline_attachments(_prompt("Tóm tắt file", upload), workspace=None, char_budget=1_000)

    assert result.startswith("Tóm tắt file\n\n")
    assert '<attached_file name="lo-trinh.md">' in result
    assert "Giai đoạn 0" in result
    assert "Attached workspace context" not in result


def test_files_outside_the_workspace_are_not_read(tmp_path: Path) -> None:
    secret = tmp_path / "outside.txt"
    secret.write_text("do not leak", encoding="utf-8")
    workspace = tmp_path / "ws"
    workspace.mkdir()
    prompt = _prompt("q", secret)

    assert inline_attachments(prompt, workspace=workspace, char_budget=1_000) == prompt


def test_workspace_files_are_read(tmp_path: Path) -> None:
    (tmp_path / "notes.txt").write_text("hello", encoding="utf-8")

    result = inline_attachments(
        _prompt("q", tmp_path / "notes.txt"), workspace=tmp_path, char_budget=1_000
    )

    assert '<attached_file name="notes.txt">\nhello\n</attached_file>' in result


def test_binary_files_stay_as_paths(tmp_path: Path) -> None:
    pdf = tmp_path / "deepcode-upload-000000000000000000000000-a.pdf"
    pdf.write_bytes(b"%PDF-1.7\n\x00\xff\xfe binary")
    prompt = _prompt("q", pdf)

    assert inline_attachments(prompt, workspace=None, char_budget=1_000) == prompt


def test_budget_truncates_and_is_shared(tmp_path: Path) -> None:
    first = tmp_path / "deepcode-upload-000000000000000000000000-a.md"
    second = tmp_path / "deepcode-upload-000000000000000000000000-b.md"
    first.write_text("ộ" * 50, encoding="utf-8")
    second.write_text("second", encoding="utf-8")

    result = inline_attachments(_prompt("q", first, second), workspace=None, char_budget=10)

    assert "ộ" * 10 + "\n[... truncated]" in result
    assert "second" not in result


def test_prompt_without_attachments_is_unchanged() -> None:
    assert inline_attachments("plain question", workspace=None, char_budget=1_000) == "plain question"


def test_answer_prompt_forbids_tool_calls() -> None:
    assert "never write a tool or function call" in SUMMARIZE_NO_SOURCES_SYSTEM
