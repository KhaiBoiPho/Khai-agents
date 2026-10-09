"""Built-in GenOffice MCP server: binary resolution and default wiring."""

from __future__ import annotations

import json
import stat
from pathlib import Path

import pytest

from cli.mcp_cli import run
from core.mcp import genoffice
from core.mcp.genoffice import (
    GENOFFICE_SERVER_NAME,
    builtin_server_definitions,
    resolve_genoffice_binary,
    builtin_server_instructions,
)
from core.mcp.models import McpServerSource
from core.mcp.resolver import McpConfigResolver


def _fake_binary(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


def test_explicit_env_binary_wins(tmp_path: Path) -> None:
    explicit = _fake_binary(tmp_path / "explicit" / "genoffice")
    bundled = _fake_binary(tmp_path / "bundled" / "genoffice")
    on_path = _fake_binary(tmp_path / "path" / "genoffice")
    env = {"GENOFFICE_BIN": str(explicit), "PATH": str(on_path.parent)}
    assert resolve_genoffice_binary(env, bundled=bundled) == explicit


def test_empty_env_binary_disables_resolution(tmp_path: Path) -> None:
    bundled = _fake_binary(tmp_path / "bundled" / "genoffice")
    assert resolve_genoffice_binary({"GENOFFICE_BIN": ""}, bundled=bundled) is None


def test_bundled_binary_before_path(tmp_path: Path) -> None:
    bundled = _fake_binary(tmp_path / "bundled" / "genoffice")
    on_path = _fake_binary(tmp_path / "path" / "genoffice")
    env = {"PATH": str(on_path.parent)}
    assert resolve_genoffice_binary(env, bundled=bundled) == bundled


def test_path_fallback_and_absence(tmp_path: Path) -> None:
    missing = tmp_path / "missing" / "genoffice"
    on_path = _fake_binary(tmp_path / "path" / "genoffice")
    assert (
        resolve_genoffice_binary({"PATH": str(on_path.parent)}, bundled=missing)
        == on_path
    )
    assert (
        resolve_genoffice_binary({"PATH": str(tmp_path / "empty")}, bundled=missing)
        is None
    )


def test_builtin_definition_is_workspace_scoped_and_compact(tmp_path: Path) -> None:
    binary = _fake_binary(tmp_path / "genoffice")
    servers = builtin_server_definitions({"GENOFFICE_BIN": str(binary)})
    definition = servers[GENOFFICE_SERVER_NAME]
    assert definition.type == "stdio"
    assert definition.command == str(binary)
    assert definition.args == ("mcp", "--compact-schemas")
    assert definition.cwd == "${workspace}"
    assert definition.env["GENOFFICE_ALLOWED_ROOTS"] == "${workspace}"
    assert definition.enabled
    assert not definition.exposes("open")
    assert definition.exposes("create_pptx")
    assert builtin_server_definitions({"GENOFFICE_BIN": ""}) == {}


def test_genoffice_instructions_avoid_empty_or_unparseable_docx_html() -> None:
    instructions = builtin_server_instructions(GENOFFICE_SERVER_NAME)
    assert instructions is not None
    assert "non-empty `markdown`" in instructions
    assert "retry once with Markdown" in instructions


def test_genoffice_docx_fallback_extracts_readable_markdown() -> None:
    from core.mcp.tools import _html_to_markdown

    content = _html_to_markdown(
        "<html><body><h1>Redis TTL</h1><p>Expiry in seconds.</p>"
        "<ul><li>Read-only</li></ul><script>secret()</script></body></html>"
    )

    assert "# Redis TTL" in content
    assert "Expiry in seconds." in content
    assert "- Read-only" in content
    assert "secret()" not in content


def test_genoffice_pdf_read_normalizes_exclusive_page_range_arguments() -> None:
    from types import SimpleNamespace

    from core.mcp.tools import _normalize_tool_arguments

    identity = SimpleNamespace(server_name="genoffice", raw_name="pdf_read")
    assert _normalize_tool_arguments(
        identity, {"file": "report.pdf", "page": 2, "range": "2-5"}
    ) == {"file": "report.pdf", "range": "2-5"}
    assert _normalize_tool_arguments(
        identity, {"file": "report.pdf", "page": 2, "range": None}
    ) == {"file": "report.pdf", "page": 2}


@pytest.fixture
def fake_genoffice(tmp_path: Path, monkeypatch) -> Path:
    binary = _fake_binary(tmp_path / "bin" / "genoffice")
    monkeypatch.setenv("GENOFFICE_BIN", str(binary))
    return binary


def test_resolver_includes_builtin_by_default(
    tmp_path: Path, fake_genoffice: Path
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    plan = McpConfigResolver(tmp_path / "home" / "deepcode_config.json").resolve(
        workspace, project_trusted=False
    )
    (server,) = plan.servers
    assert server.name == GENOFFICE_SERVER_NAME
    assert server.source is McpServerSource.BUILTIN
    assert server.workspace == workspace.resolve()


def test_resolver_omits_builtin_when_binary_absent(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    plan = McpConfigResolver(tmp_path / "home" / "deepcode_config.json").resolve(
        workspace, project_trusted=False
    )
    assert plan.servers == ()


def test_user_entry_replaces_and_disables_builtin(
    tmp_path: Path, fake_genoffice: Path
) -> None:
    config = tmp_path / "home" / "deepcode_config.json"
    config.parent.mkdir(parents=True)
    config.write_text(
        json.dumps(
            {
                "mcpServers": {
                    "genoffice": {
                        "type": "stdio",
                        "command": "genoffice",
                        "args": ["mcp"],
                        "enabled": False,
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    resolver = McpConfigResolver(config)
    assert resolver.resolve(workspace, project_trusted=False).servers == ()
    (server,) = resolver.resolve(
        workspace, project_trusted=False, include_disabled=True
    ).servers
    assert server.source is McpServerSource.USER
    assert server.definition.args == ("mcp",)


def test_cli_lists_disables_and_refuses_to_remove_builtin(
    tmp_path: Path, monkeypatch, capsys, fake_genoffice: Path
) -> None:
    home = tmp_path / "home"
    monkeypatch.setenv("DEEPCODE_HOME", str(home))

    assert run(["list", "--json"]) == 0
    (listed,) = json.loads(capsys.readouterr().out)["servers"]
    assert listed["name"] == "genoffice"
    assert listed["source"] == "builtin"
    assert listed["enabled"] is True

    assert run(["disable", "genoffice", "--json"]) == 0
    (disabled,) = json.loads(capsys.readouterr().out)["servers"]
    assert disabled["source"] == "user"
    assert disabled["enabled"] is False
    stored = json.loads((home / "deepcode_config.json").read_text(encoding="utf-8"))
    assert stored["mcpServers"]["genoffice"]["command"] == str(fake_genoffice)

    assert run(["remove", "genoffice", "--json"]) == 0
    (restored,) = json.loads(capsys.readouterr().out)["servers"]
    assert restored["source"] == "builtin"
    assert run(["remove", "genoffice", "--json"]) != 0


def test_bundled_path_points_into_tools() -> None:
    assert genoffice.BUNDLED_GENOFFICE_BIN.parts[-3:] == (
        "tools",
        "genoffice",
        "genoffice",
    )


def test_mcp_image_blocks_are_summarized_not_inlined_as_base64() -> None:
    from mcp.types import CallToolResult, ImageContent, TextContent

    from core.mcp.tools import _result_text

    text = _result_text(
        CallToolResult(
            content=[
                TextContent(type="text", text='{"status":"ok"}'),
                ImageContent(type="image", data="QUJD" * 1000, mimeType="image/png"),
            ]
        )
    )
    assert text.startswith('{"status":"ok"}')
    assert "[image omitted: image/png" in text
    assert "QUJD" not in text


def test_builtin_server_gets_khai_workflow_instructions() -> None:
    from core.mcp.genoffice import builtin_server_instructions

    note = builtin_server_instructions("genoffice")
    assert note is not None and "genoffice` Skill" in note
    assert builtin_server_instructions("other") is None
