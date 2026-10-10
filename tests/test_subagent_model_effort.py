"""Per-sub-agent model and reasoning effort for spawn_agent (no network)."""

from __future__ import annotations

import asyncio
import dataclasses
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.config import ConfigError
from core.domain.execution_profile import ExecutionProfile
from core.harness.agents.control import AgentControl, AgentLimitError, SubAgent
from core.harness.tools.spawn_agent import SpawnAgentTool


def _profile(model: str = "parent-model", **changes: Any) -> ExecutionProfile:
    base = ExecutionProfile(
        connection_id="main",
        provider_name="anthropic",
        adapter="anthropic",
        model_id=model,
        context_window=200_000,
        max_output_tokens=64_000,
        max_tokens=32_000,
        temperature=0.7,
        reasoning_effort="medium",
        config_revision="rev",
    )
    return dataclasses.replace(base, **changes)


class _Runtime:
    """Resolves models the way the parent does: through one resolver."""

    def __init__(
        self,
        *,
        known: set[str] | None = None,
        manual: tuple[str, ...] | None = None,
    ) -> None:
        self.known = known
        self.calls: list[dict[str, Any]] = []
        manual_entries = tuple(SimpleNamespace(id=m) for m in manual or ())
        connection = SimpleNamespace(
            id="main",
            model_catalog="manual" if manual is not None else "remote",
            manual_model_entries=manual_entries,
        )
        self.connection_resolver = SimpleNamespace(
            resolve_connection=lambda connection_id, **_: connection
        )

    def resolve_execution_profile(self, **kwargs: Any) -> ExecutionProfile:
        self.calls.append(kwargs)
        model = kwargs["model"]
        if self.known is not None and model not in self.known:
            raise ConfigError(f"Unknown LLM connection for model '{model}'")
        return _profile(
            model,
            connection_id=kwargs["connection_id"] or "main",
            reasoning_effort=kwargs["reasoning_effort"],
        )


def _control(tmp_path: Path, runtime: Any = None, profile: Any = "default") -> AgentControl:
    return AgentControl(
        str(tmp_path),
        "parent-model",
        execution_profile=_profile() if profile == "default" else profile,
        runtime=runtime,
    )


def _fake_build(captured: dict[str, Any]):
    class _Session:
        history: list = []

        def load_history(self, _messages):
            return None

        async def run_stream(self, _op):
            from core.events import Event, TaskComplete

            yield Event("1", TaskComplete("done", "completed"))

        async def aclose(self):
            return None

    def build(**kwargs: Any):
        captured.update(kwargs)
        return _Session(), kwargs.get("model"), object()

    return build


# ---- validation ---------------------------------------------------------------


def test_tool_schema_exposes_model_and_bounded_effort(tmp_path: Path) -> None:
    tool = SpawnAgentTool(_control(tmp_path))
    props = tool.parameters["properties"]
    assert props["model"]["type"] == "string"
    assert props["effort"]["enum"] == ["low", "medium"]
    assert "model" not in tool.parameters["required"]


def test_effort_outside_app_levels_is_refused(tmp_path: Path) -> None:
    control = _control(tmp_path)
    tool = SpawnAgentTool(control)
    out = asyncio.run(tool.execute(name="x", task="t", isolate=False, effort="high"))
    assert out.startswith("Error:") and "low, medium" in out
    assert control.all() == []
    with pytest.raises(AgentLimitError):
        control._resolve_child_profile(None, "max")


def test_unknown_model_is_refused_at_spawn(tmp_path: Path) -> None:
    runtime = _Runtime(known={"small-model"})
    control = _control(tmp_path, runtime)
    tool = SpawnAgentTool(control)
    out = asyncio.run(
        tool.execute(name="x", task="t", isolate=False, model="no-such-model")
    )
    assert out.startswith("Error: model 'no-such-model' is not available")
    assert control.all() == []
    # Resolved on the parent's connection, like the parent's own model.
    assert runtime.calls[0]["connection_id"] == "main"


def test_manual_connection_only_offers_listed_models(tmp_path: Path) -> None:
    control = _control(tmp_path, _Runtime(manual=("small-model", "parent-model")))
    with pytest.raises(AgentLimitError, match="not offered by connection"):
        control._resolve_child_profile("other-model", None)
    assert control._resolve_child_profile("small-model", None).model_id == "small-model"


def test_external_backend_rejects_model_and_effort(tmp_path: Path) -> None:
    control = _control(tmp_path)
    with pytest.raises(AgentLimitError, match="model"):
        control.spawn("t", backend="codex", isolate=False, model="small-model")
    with pytest.raises(AgentLimitError, match="effort"):
        control.spawn("t", backend="codex", isolate=False, effort="low")


# ---- threading to the child -----------------------------------------------------


def test_no_override_inherits_parent_profile(tmp_path: Path, monkeypatch) -> None:
    captured: dict[str, Any] = {}
    monkeypatch.setattr("core.agent_setup.build_agent_session", _fake_build(captured))
    control = _control(tmp_path)
    assert control._resolve_child_profile(None, None) is None
    sub = SubAgent(id="c", task="t", isolate=False)
    asyncio.run(control._run_subagent(sub, str(tmp_path)))
    assert captured["execution_profile"] is control._execution_profile
    assert captured["model"] == "parent-model"


def test_effort_only_keeps_model_and_lowers_effort(tmp_path: Path, monkeypatch) -> None:
    captured: dict[str, Any] = {}
    monkeypatch.setattr("core.agent_setup.build_agent_session", _fake_build(captured))
    control = _control(tmp_path)
    child = control._resolve_child_profile(None, "low")
    assert child.model_id == "parent-model"
    assert child.reasoning_effort == "low"
    assert child.connection_id == "main"

    sub = SubAgent(id="c", task="t", isolate=False, effort="low", execution_profile=child)
    asyncio.run(control._run_subagent(sub, str(tmp_path)))
    assert captured["execution_profile"].reasoning_effort == "low"
    assert captured["model"] == "parent-model"


def test_model_override_reaches_child_session(tmp_path: Path, monkeypatch) -> None:
    captured: dict[str, Any] = {}
    monkeypatch.setattr("core.agent_setup.build_agent_session", _fake_build(captured))
    runtime = _Runtime(known={"small-model"})
    control = _control(tmp_path, runtime)
    tool = SpawnAgentTool(control)

    async def scenario() -> SubAgent:
        out = await tool.execute(
            name="lookup", task="t", isolate=False, model="small-model", effort="low"
        )
        assert out.startswith("Spawned lookup")
        sub = control.get("lookup")
        await asyncio.wait_for(sub.settled.wait(), timeout=5)
        sub.handle.cancel()
        await asyncio.gather(sub.handle, return_exceptions=True)
        return sub

    sub = asyncio.run(scenario())
    assert sub.model == "small-model" and sub.effort == "low"
    assert captured["model"] == "small-model"
    assert captured["execution_profile"].model_id == "small-model"
    assert captured["execution_profile"].reasoning_effort == "low"
    assert runtime.calls[0]["reasoning_effort"] == "low"


def test_legacy_runtime_without_profile_passes_effort(tmp_path: Path, monkeypatch) -> None:
    captured: dict[str, Any] = {}
    monkeypatch.setattr("core.agent_setup.build_agent_session", _fake_build(captured))
    control = _control(tmp_path, profile=None)
    assert control._resolve_child_profile(None, "medium") is None
    sub = SubAgent(id="c", task="t", isolate=False, effort="medium")
    asyncio.run(control._run_subagent(sub, str(tmp_path)))
    assert captured["execution_profile"] is None
    assert captured["reasoning_effort"] == "medium"
