"""Inline the composer's attached files into a DeepThink question.

The composer appends ``Attached workspace context:`` and one ``- <path>`` line
per file. The agent loop reads those paths with its tools; DeepThink has no
tools, so without this the model sees only a path and answers with a
make-believe ``read_file`` call.
"""

from __future__ import annotations

from pathlib import Path

ATTACHED_HEADING = "\n\nAttached workspace context:\n"
UPLOAD_PREFIX = "deepcode-upload-"


def _attached_paths(prompt: str) -> tuple[str, list[str]]:
    at = prompt.rfind(ATTACHED_HEADING)
    if at < 0:
        return prompt, []
    lines = prompt[at + len(ATTACHED_HEADING):].split("\n")
    if not lines or not all(line.startswith("- ") for line in lines):
        return prompt, []
    return prompt[:at], [line[2:].strip() for line in lines if line[2:].strip()]


def _readable(path: Path, workspace: Path | None) -> bool:
    """Uploads anywhere, other files only inside the Session's workspace."""

    if path.name.startswith(UPLOAD_PREFIX):
        return True
    return workspace is not None and path.is_relative_to(workspace)


def _decode(data: bytes) -> str | None:
    """UTF-8 text, or None for binary (PDF, image, ...). A read cut inside
    a multi-byte character keeps the text before it."""

    if b"\x00" in data:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as exc:
        if exc.start >= len(data) - 3:
            return data[: exc.start].decode("utf-8", errors="ignore")
        return None


def _display_name(path: Path) -> str:
    name = path.name
    if name.startswith(UPLOAD_PREFIX):
        # deepcode-upload-<24 hex>-<original name>
        rest = name[len(UPLOAD_PREFIX):]
        if len(rest) > 25 and rest[24] == "-":
            return rest[25:]
    return name


def inline_attachments(
    prompt: str, *, workspace: str | Path | None, char_budget: int
) -> str:
    """``prompt`` with each readable text attachment's content appended,
    sharing ``char_budget`` characters; unreadable files stay as paths."""

    question, paths = _attached_paths(prompt)
    if not paths or char_budget <= 0:
        return prompt
    root: Path | None = None
    if workspace is not None:
        try:
            root = Path(workspace).resolve()
        except OSError:
            root = None
    blocks: list[str] = []
    left = char_budget
    for raw in paths:
        if left <= 0:
            break
        try:
            path = Path(raw).resolve(strict=True)
        except OSError:
            continue
        if not path.is_file() or not _readable(path, root):
            continue
        try:
            with path.open("rb") as handle:
                data = handle.read(left * 4 + 4)
        except OSError:
            continue
        text = _decode(data)
        if text is None:
            continue
        body = text[:left]
        if len(text) > left:
            body += "\n[... truncated]"
        left -= len(body)
        blocks.append(f'<attached_file name="{_display_name(path)}">\n{body}\n</attached_file>')
    if not blocks:
        return prompt
    return (
        f"{question}\n\nThe user attached these files; their full text is below, "
        "so answer from it directly.\n\n" + "\n\n".join(blocks)
    )


__all__ = ["inline_attachments"]
