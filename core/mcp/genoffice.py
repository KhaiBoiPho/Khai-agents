"""Built-in GenOffice document MCP server.

GenOffice (Apache-2.0) exposes its document engines -- create, convert, read,
edit and render DOCX/XLSX/PPTX/PDF/Markdown/HTML -- headless through the
``genoffice`` CLI, whose ``genoffice mcp`` subcommand is a stdio MCP server.
Khai ships it as a *built-in* server: it is part of every MCP plan whenever the
binary resolves and silently absent otherwise. A user or project
``mcpServers.genoffice`` entry replaces the built-in definition as a whole
(the usual layer rule), which is also how it is disabled.

Binary resolution order:

1. ``$GENOFFICE_BIN`` (an explicit path; an empty value disables the server);
2. the bundled copy written by ``scripts/setup-genoffice.sh`` at
   ``tools/genoffice/genoffice``;
3. ``genoffice`` on ``PATH`` (e.g. installed by the GenOffice app).
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Mapping
from pathlib import Path

from core.mcp.models import McpServerDefinition

GENOFFICE_SERVER_NAME = "genoffice"
GENOFFICE_BIN_ENV = "GENOFFICE_BIN"

_REPO_ROOT = Path(__file__).resolve().parents[2]
BUNDLED_GENOFFICE_BIN = _REPO_ROOT / "tools" / "genoffice" / "genoffice"

# Tools that only make sense next to a running GenOffice app or its cloud
# account (search/image/media need GenOffice's own provider keys). Khai has
# its own web search and review panel, so these stay hidden.
GENOFFICE_DISABLED_TOOLS: tuple[str, ...] = (
    "open",
    "selection",
    "capabilities",
    "search",
    "image",
    "media",
)

GENOFFICE_DESCRIPTION = (
    "Built-in GenOffice document engine: create, convert, read, edit and render "
    "DOCX, XLSX, PPTX, PDF, Markdown and HTML files in the workspace."
)


# Khai workflow guidance sent with the built-in server's own MCP instructions
# (the per-turn MCP instruction context), so it only reaches the model while
# the genoffice tools are actually available.
GENOFFICE_KHAI_INSTRUCTIONS = """\
Khai: for requests to make or change a document (report, memo, deck, \
spreadsheet, PDF, conversion), load the `genoffice` Skill first, then: \
1) plan briefly (audience, sections/slides/sheets, real figures, output path); \
For slide decks, never invent `layout` or page `type` names. Load the GenOffice \
slide design/spec guide and use only its listed variants, then validate the full \
outline before calling deck-start/create. Content pages must not repeat the same \
layout on consecutive pages; use at least three different guide-listed variants \
across the body when the deck is long enough. Do not emit `two_column_split` or \
`three_column_cards` unless the current guide explicitly lists them. If validation \
fails, treat its structured issues as authoritative: change only the cited page \
fields, use a listed supported variant, and rerun the check; do not guess layout \
names or explain away a failed check. Image layouts must include a real image \
query or a workspace image; do not omit `images`. \
2) build with these tools, writing only workspace-relative paths such as \
`reports/<name>.docx` (paths outside the workspace are refused); \
3) check (`docs_check`, `sheet_check`, `slides_audit`) and, if render is \
available, look (`render` or `slides_render`); on `app_unavailable` continue \
without it and say the visual check was skipped; fix at most twice; \
4) present: name each file's workspace path with a one-line summary; the chat \
shows it as a card the user can open, so do not paste the document back. \
For `create_docx`, always pass non-empty `markdown` (preferred) or supported \
restricted-HTML fragment content; do not pass an empty string, a full HTML page \
wrapper, or unsupported HTML. If content is in HTML, ensure it has readable \
body elements before calling the tool. Use a workspace-relative `.md` source \
with `convert` when the content is otherwise ambiguous. After creation, verify \
the output with `docs_read` or `docs_check`; on a parse error, correct the input \
format and retry once with Markdown rather than repeating identical HTML. \
For `pdf_read`, use `page` OR `range`, never both. Use `range` alone for multiple \
pages; omit both to read the default first pages. \
Never hand-write Office XML or use shell zip tricks when these tools exist."""


def _is_executable(path: Path) -> bool:
    return path.is_file() and os.access(path, os.X_OK)


def resolve_genoffice_binary(
    env: Mapping[str, str] | None = None,
    *,
    bundled: Path | None = None,
) -> Path | None:
    """Return the ``genoffice`` executable to run, or ``None`` when absent."""

    environ = os.environ if env is None else env
    if GENOFFICE_BIN_ENV in environ:
        explicit = environ[GENOFFICE_BIN_ENV].strip()
        if not explicit:
            return None
        candidate = Path(explicit).expanduser()
        if _is_executable(candidate):
            return candidate
        found = shutil.which(explicit, path=environ.get("PATH"))
        return Path(found) if found else None
    bundled_bin = BUNDLED_GENOFFICE_BIN if bundled is None else bundled
    if _is_executable(bundled_bin):
        return bundled_bin
    found = shutil.which("genoffice", path=environ.get("PATH"))
    return Path(found) if found else None


def genoffice_server_definition(binary: Path) -> McpServerDefinition:
    """The built-in stdio definition for one resolved ``genoffice`` binary.

    ``--compact-schemas`` keeps tools/list at roughly 8.6k tokens instead of
    roughly 23k: the typed per-op schemas of ``docs_apply``/``sheet_apply``/
    ``slides_apply`` (about 5k tokens each) are replaced by plain arrays, and
    the agent pulls the op reference on demand through the ``guide`` tool, as
    the bundled genoffice Skill instructs. ``GENOFFICE_ALLOWED_ROOTS`` confines
    every read and write to the session workspace.
    """

    return McpServerDefinition.model_validate(
        {
            "type": "stdio",
            "command": str(binary),
            "args": ["mcp", "--compact-schemas"],
            "cwd": "${workspace}",
            "env": {
                "GENOFFICE_ALLOWED_ROOTS": "${workspace}",
                "GENOFFICE_MCP_COMPACT_SCHEMAS": "1",
            },
            "envVars": ["GENOFFICE_NODE"],
            "startupTimeoutSeconds": 30,
            "toolTimeoutSeconds": 300,
            "disabledTools": list(GENOFFICE_DISABLED_TOOLS),
            "approvalMode": "auto",
            "description": GENOFFICE_DESCRIPTION,
        }
    )


def builtin_server_instructions(server_name: str) -> str | None:
    """Khai's extra model guidance for one built-in server, if any."""

    if server_name == GENOFFICE_SERVER_NAME:
        return GENOFFICE_KHAI_INSTRUCTIONS
    return None


def builtin_server_definitions(
    env: Mapping[str, str] | None = None,
) -> dict[str, McpServerDefinition]:
    """Built-in servers available on this machine, keyed by server name.

    GenOffice appears when its binary resolves; the Firecrawl web search
    server (deferred, keyless URL) unless ``$KHAI_BUILTIN_WEBSEARCH`` is set
    to an off value.
    """

    from core.mcp.firecrawl import (
        FIRECRAWL_SERVER_NAME,
        firecrawl_server_definition,
    )

    environ = os.environ if env is None else env
    servers: dict[str, McpServerDefinition] = {}
    binary = resolve_genoffice_binary(env)
    if binary is not None:
        servers[GENOFFICE_SERVER_NAME] = genoffice_server_definition(binary)
    if builtin_websearch_enabled(environ):
        servers[FIRECRAWL_SERVER_NAME] = firecrawl_server_definition()
    return servers


BUILTIN_WEBSEARCH_ENV = "KHAI_BUILTIN_WEBSEARCH"
_OFF_VALUES = frozenset({"", "0", "false", "no", "off"})


def builtin_websearch_enabled(env: Mapping[str, str] | None = None) -> bool:
    """Whether the built-in Firecrawl server is offered (default: yes)."""

    environ = os.environ if env is None else env
    if BUILTIN_WEBSEARCH_ENV not in environ:
        return True
    return environ[BUILTIN_WEBSEARCH_ENV].strip().lower() not in _OFF_VALUES


__all__ = [
    "BUILTIN_WEBSEARCH_ENV",
    "BUNDLED_GENOFFICE_BIN",
    "GENOFFICE_BIN_ENV",
    "GENOFFICE_DISABLED_TOOLS",
    "GENOFFICE_SERVER_NAME",
    "GENOFFICE_KHAI_INSTRUCTIONS",
    "builtin_server_definitions",
    "builtin_server_instructions",
    "builtin_websearch_enabled",
    "genoffice_server_definition",
    "resolve_genoffice_binary",
]
