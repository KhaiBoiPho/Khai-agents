"""``repo_map``: a ranked outline of the workspace's code (see core.codemap)."""

from __future__ import annotations

import asyncio
from typing import Any

from core.agent_runtime.tools.base import Tool, tool_parameters

DEFAULT_TOKENS = 1500
MAX_TOKENS = 6000


@tool_parameters(
    {
        "type": "object",
        "properties": {
            "focus_files": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Workspace-relative files to center the map on.",
            },
            "symbols": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Identifiers (functions, classes, types) to weight up.",
            },
            "max_tokens": {
                "type": "integer",
                "description": f"Size of the map (default {DEFAULT_TOKENS}, max {MAX_TOKENS}).",
            },
        },
    }
)
class RepoMapTool(Tool):
    """Ranked definitions across the repository, optionally around a focus."""

    def __init__(self, workspace: str):
        self._workspace = str(workspace)

    @property
    def name(self) -> str:
        return "repo_map"

    @property
    def description(self) -> str:
        return (
            "Show the repository's most important definitions (classes, "
            "functions, types) ranked by how the rest of the code uses them, as "
            "`path` then `line│ source`. Pass focus_files and/or symbols to see "
            "what surrounds a part of the code. Use it to orient before reading "
            "files, and to find where something is defined and who depends on it."
        )

    @property
    def read_only(self) -> bool:
        return True

    async def execute(self, **kwargs: Any) -> Any:
        from core.codemap import RepoMap

        focus = {str(path).lstrip("./") for path in kwargs.get("focus_files") or []}
        symbols = {str(name) for name in kwargs.get("symbols") or []}
        try:
            budget = int(kwargs.get("max_tokens") or DEFAULT_TOKENS)
        except (TypeError, ValueError):
            budget = DEFAULT_TOKENS
        budget = max(200, min(MAX_TOKENS, budget))
        result = await asyncio.to_thread(
            RepoMap(self._workspace).render,
            max_tokens=budget,
            focus_files=focus,
            mentioned=symbols,
            time_budget=60.0,
        )
        if not result.text.strip():
            return "No source files with recognizable definitions were found."
        note = "" if result.complete else (
            f"\n\n(partial: {result.files_scanned} of {result.files_total} files scanned)"
        )
        return result.text + note
