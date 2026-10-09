"""The one folder a hosted user's projects live in.

A hosted worker (``KHAI_WORKSPACE_ROOT`` set by the gateway) only browses,
opens, uploads into and clones into this folder. Without it, as on the
desktop, every folder on the machine stays available.
"""

from __future__ import annotations

import os
from pathlib import Path, PurePosixPath


def workspace_root() -> Path | None:
    value = os.environ.get("KHAI_WORKSPACE_ROOT", "").strip()
    if not value:
        return None
    root = Path(value).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def within(root: Path, path: Path) -> bool:
    resolved = path.resolve()
    return resolved == root or resolved.is_relative_to(root)


def relative_path(raw: str) -> PurePosixPath:
    """A browser-supplied relative path, or ValueError.

    Rejects absolute paths, ``.``/``..`` and empty segments rather than
    normalizing them, so the result can only name something below the root.
    """

    if not raw or "\x00" in raw or "\\" in raw or len(raw) > 1024:
        raise ValueError("invalid path")
    path = PurePosixPath(raw)
    parts = raw.split("/")
    if path.is_absolute() or len(parts) > 64:
        raise ValueError("invalid path")
    if any(part in {"", ".", ".."} or len(part) > 255 for part in parts):
        raise ValueError("invalid path")
    return path
