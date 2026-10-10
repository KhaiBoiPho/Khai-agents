"""Tests for the P1 three-valued permission engine."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.agent_setup import _wire_tool_permissions
from core.domain.execution_security import ApprovalPolicy
from core.harness.permissions import (
    PermissionDecision,
    PermissionEngine,
    PermissionMode,
    PermissionRule,
    make_engine,
    rules_from_config,
)
from core.harness.tools import default_coding_tools

ALLOW = PermissionDecision.ALLOW
ASK = PermissionDecision.ASK
DENY = PermissionDecision.DENY


def _decide(engine: PermissionEngine, tool: str, **args):
    decision, _reason = engine.evaluate(tool, args)
    return decision


# ---- non-overridable sensitive-path denylist -------------------------------


def test_denylist_blocks_ssh_read_even_in_full_auto():
    engine = PermissionEngine(mode=PermissionMode.FULL_AUTO, cwd="/home/u/proj")
    assert _decide(engine, "read_file", file_path="/home/u/.ssh/id_rsa") is DENY


def test_denylist_blocks_env_and_config_and_pem():
    engine = PermissionEngine(mode=PermissionMode.FULL_AUTO, cwd="/home/u/proj")
    assert _decide(engine, "read_file", file_path="/home/u/proj/.env") is DENY
    assert _decide(engine, "write_file", file_path="deepcode_config.json") is DENY
    assert _decide(engine, "read_file", file_path="/home/u/proj/server.pem") is DENY


def test_denylist_cannot_be_overridden_by_an_allow_rule():
    engine = PermissionEngine(
        mode=PermissionMode.FULL_AUTO,
        rules=[PermissionRule("*", "*", ALLOW)],
        cwd="/home/u/proj",
    )
    # Even a blanket allow rule loses to the denylist.
    assert _decide(engine, "read_file", file_path="/home/u/.aws/credentials") is DENY


def test_denylist_matches_relative_path_via_cwd():
    engine = PermissionEngine(mode=PermissionMode.FULL_AUTO, cwd="/home/u/proj")
    # ".env" resolves under cwd and is caught.
    assert _decide(engine, "write_file", file_path=".env") is DENY


def test_patch_paths_are_checked_by_central_sensitive_path_protection():
    engine = PermissionEngine(mode=PermissionMode.FULL_AUTO, cwd="/home/u/proj")
    patch = (
        "*** Begin Patch\n"
        "*** Update File: /home/u/.ssh/config\n"
        "@@\n-old\n+new\n"
        "*** End Patch\n"
    )

    assert _decide(engine, "apply_patch", patch=patch) is DENY


def test_sensitive_path_protection_can_only_be_disabled_centrally():
    engine = PermissionEngine(
        mode=PermissionMode.FULL_AUTO,
        cwd="/home/u/proj",
        protect_sensitive_paths=False,
    )

    assert _decide(engine, "write", file_path="/home/u/.ssh/config") is ALLOW


def test_ordinary_workspace_path_is_not_denylisted():
    engine = PermissionEngine(mode=PermissionMode.FULL_AUTO, cwd="/home/u/proj")
    assert _decide(engine, "write_file", file_path="src/model.py") is ALLOW


# ---- modes -----------------------------------------------------------------


def test_default_mode_reads_allow_writes_ask():
    engine = PermissionEngine(mode=PermissionMode.DEFAULT, cwd="/w")
    assert _decide(engine, "read_file", file_path="/w/a.py") is ALLOW
    assert _decide(engine, "write_file", file_path="/w/a.py") is ASK
    assert _decide(engine, "execute_bash", command="pytest") is ASK


def test_native_tool_read_only_metadata_drives_default_mode(tmp_path):
    engine = PermissionEngine(mode=PermissionMode.DEFAULT, cwd=str(tmp_path))
    registry = default_coding_tools(tmp_path)

    _wire_tool_permissions(registry, engine)

    assert _decide(engine, "read", file_path="a.py") is ALLOW
    assert _decide(engine, "grep", pattern="needle") is ALLOW
    assert _decide(engine, "web_fetch", url="https://example.com") is ALLOW
    assert _decide(engine, "write", file_path="a.py") is ASK
    assert _decide(engine, "bash", command="python -m unittest") is ASK


def test_plan_mode_denies_mutations_allows_reads():
    engine = PermissionEngine(mode=PermissionMode.PLAN, cwd="/w")
    assert _decide(engine, "grep", pattern="foo") is ALLOW
    assert _decide(engine, "write_file", file_path="/w/a.py") is DENY


def test_enforced_read_only_cannot_be_broadened_by_allow_rule():
    engine = PermissionEngine(
        mode=PermissionMode.PLAN,
        rules=[PermissionRule("write", "*", ALLOW)],
        cwd="/w",
        enforce_read_only=True,
    )

    decision, reason = engine.evaluate("write", {"file_path": "/w/a.py"})

    assert decision is DENY
    assert "cannot be enabled by rules" in reason


def test_legacy_plan_rule_override_remains_compatible():
    engine = PermissionEngine(
        mode=PermissionMode.PLAN,
        rules=[PermissionRule("write", "*", ALLOW)],
        cwd="/w",
    )

    assert _decide(engine, "write", file_path="/w/a.py") is ALLOW


def test_full_auto_allows_mutations_without_ask():
    engine = PermissionEngine(mode=PermissionMode.FULL_AUTO, cwd="/w")
    assert _decide(engine, "write_file", file_path="/w/a.py") is ALLOW
    assert _decide(engine, "execute_bash", command="pytest") is ALLOW


def test_never_approval_policy_turns_explicit_ask_rule_into_deny():
    engine = PermissionEngine(
        mode=PermissionMode.FULL_AUTO,
        rules=[PermissionRule("bash", "git push *", ASK)],
        cwd="/w",
        approval_policy=ApprovalPolicy.NEVER,
    )

    decision, reason = engine.evaluate("bash", {"command": "git push origin main"})

    assert decision is DENY
    assert "approval policy is never" in reason


def test_mcp_tool_name_suffix_never_grants_read_only():
    # A server picks its own tool names; ending in ``_read_file`` / ``_grep``
    # must not make a tool auto-allowed or plan-mode exempt.
    engine = PermissionEngine(mode=PermissionMode.DEFAULT, cwd="/w")
    assert (
        _decide(engine, "mcp_code-implementation_read_file", file_path="/w/a.py")
        is ASK
    )
    assert _decide(engine, "mcp_x_rm_grep", pattern="*") is ASK
    assert _decide(engine, "mcp_x_update_plan") is ASK
    assert not engine.is_read_only("mcp_x_rm_ls")
    plan = PermissionEngine(mode=PermissionMode.PLAN, cwd="/w")
    assert _decide(plan, "mcp_x_rm_grep", pattern="*") is DENY
    # Built-in read-only names keep their exact-name behavior.
    assert _decide(engine, "grep", pattern="x") is ALLOW


def test_mcp_read_only_requires_annotation_or_explicit_rule():
    from types import SimpleNamespace

    from core.agent_runtime.tools.registry import ToolRegistry
    from core.mcp.models import McpToolAnnotations
    from core.mcp.tools import McpToolAdapter

    def adapter(raw: str, visible: str, read_only_hint: bool | None):
        server = SimpleNamespace(
            server_id="srv",
            name="x",
            source=SimpleNamespace(value="user"),
            definition=SimpleNamespace(
                policy_for=lambda _name: SimpleNamespace(value="auto"),
                supports_parallel_tool_calls=True,
            ),
        )
        annotations = (
            SimpleNamespace(readOnlyHint=read_only_hint)
            if read_only_hint is not None
            else None
        )
        definition = SimpleNamespace(
            name=raw,
            description="d",
            inputSchema={"type": "object", "properties": {}},
            annotations=annotations,
        )
        return McpToolAdapter(
            SimpleNamespace(server=server), definition, visible_name=visible
        )

    malicious = adapter("rm_grep", "mcp_x_rm_grep", None)
    annotated = adapter("lookup", "mcp_x_lookup", True)
    assert malicious.read_only is False
    assert annotated.annotations == McpToolAnnotations.from_sdk(
        SimpleNamespace(readOnlyHint=True)
    )

    registry = ToolRegistry()
    registry.register(malicious)
    registry.register(annotated)
    engine = PermissionEngine(mode=PermissionMode.DEFAULT, cwd="/w")
    _wire_tool_permissions(registry, engine)

    # Plain evaluation (registry-declared metadata) and the session's
    # evaluate_tool path (adapter metadata) agree.
    assert _decide(engine, "mcp_x_rm_grep") is ASK
    assert _decide(engine, "mcp_x_lookup") is ALLOW
    assert engine.evaluate_tool("mcp_x_rm_grep", {}, read_only=malicious.read_only)[0] is ASK
    assert engine.evaluate_tool("mcp_x_lookup", {}, read_only=annotated.read_only)[0] is ALLOW
    plan = PermissionEngine(mode=PermissionMode.PLAN, cwd="/w")
    _wire_tool_permissions(registry, plan)
    assert _decide(plan, "mcp_x_rm_grep") is DENY
    assert _decide(plan, "mcp_x_lookup") is ALLOW

    # An explicit user rule can still allow an unannotated MCP tool.
    ruled = PermissionEngine(
        mode=PermissionMode.DEFAULT,
        rules=rules_from_config({"mcp_x_rm_grep": "allow"}),
        cwd="/w",
    )
    assert _decide(ruled, "mcp_x_rm_grep") is ALLOW


# ---- two-dimensional wildcard rules, last-match-wins ------------------------


def test_two_dimensional_bash_rule():
    engine = PermissionEngine(
        mode=PermissionMode.DEFAULT,
        rules=rules_from_config({"execute_bash": {"git push *": "ask", "*": "allow"}}),
        cwd="/w",
    )
    assert _decide(engine, "execute_bash", command="git status") is ALLOW
    assert _decide(engine, "execute_bash", command="git push origin main") is ASK


def test_last_match_wins():
    engine = PermissionEngine(
        mode=PermissionMode.DEFAULT,
        rules=[
            PermissionRule("write_file", "*", DENY),
            PermissionRule("write_file", "*", ALLOW),  # later wins
        ],
        cwd="/w",
    )
    assert _decide(engine, "write_file", file_path="/w/a.py") is ALLOW


def test_rule_does_not_override_denylist():
    engine = make_engine(
        "full_auto",
        rules_config={"read_file": {"*": "allow"}},
        cwd="/home/u/proj",
    )
    assert _decide(engine, "read_file", file_path="/home/u/.ssh/config") is DENY


def test_rules_from_config_rejects_bad_action():
    import pytest

    with pytest.raises(ValueError):
        rules_from_config({"write_file": "sometimes"})


def test_shorthand_string_rule():
    engine = PermissionEngine(
        mode=PermissionMode.DEFAULT,
        rules=rules_from_config({"write_file": "allow"}),
        cwd="/w",
    )
    assert _decide(engine, "write_file", file_path="/w/a.py") is ALLOW
