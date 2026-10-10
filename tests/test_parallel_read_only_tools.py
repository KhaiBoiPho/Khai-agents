"""Parallel execution of read-only tool calls.

Interactive sessions turn on ``concurrent_tools``. The runner may then overlap
consecutive concurrency-safe calls from one model response, but only tools
that are read-only and not exclusive, and results must come back in the order
the model issued the calls.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.agent_runtime.runner import AgentRunner, AgentRunSpec
from core.agent_runtime.tools.base import Tool, tool_parameters
from core.agent_runtime.tools.registry import ToolRegistry
from core.providers.base import LLMResponse, ToolCallRequest


@tool_parameters({"type": "object", "properties": {}})
class _Probe(Tool):
    """Records overlap with other probes; sleeps so overlap is observable."""

    def __init__(
        self,
        name: str,
        log: dict[str, Any],
        *,
        read_only: bool,
        exclusive: bool = False,
        delay: float = 0.05,
    ) -> None:
        self._name = name
        self._log = log
        self._read_only = read_only
        self._exclusive = exclusive
        self._delay = delay

    @property
    def name(self) -> str:
        return self._name

    @property
    def description(self) -> str:
        return "probe"

    @property
    def read_only(self) -> bool:
        return self._read_only

    @property
    def exclusive(self) -> bool:
        return self._exclusive

    async def execute(self, **kwargs: Any) -> Any:
        log = self._log
        log["active"] += 1
        log["max_active"] = max(log["max_active"], log["active"])
        log["started"].append(self._name)
        if self._exclusive or not self._read_only:
            # A serial tool must never share the floor with anything else.
            log["serial_overlap"] |= log["active"] > 1
        await asyncio.sleep(self._delay)
        log["active"] -= 1
        return f"result:{self._name}"


class _Provider:
    def __init__(self, calls: list[str]) -> None:
        self._responses = [
            LLMResponse(
                content="",
                tool_calls=[
                    ToolCallRequest(id=f"call-{i}", name=name, arguments={})
                    for i, name in enumerate(calls)
                ],
                finish_reason="tool_calls",
            ),
            LLMResponse(content="done", finish_reason="stop"),
        ]
        self.calls = 0

    def get_default_model(self) -> str:
        return "fake-model"

    async def chat_with_retry(self, **kwargs: Any) -> LLMResponse:
        index = min(self.calls, len(self._responses) - 1)
        self.calls += 1
        return self._responses[index]


def _new_log() -> dict[str, Any]:
    return {"active": 0, "max_active": 0, "started": [], "serial_overlap": False}


def _run(tools: list[Tool], calls: list[str], *, concurrent: bool, **spec_kw: Any):
    registry = ToolRegistry()
    for tool in tools:
        registry.register(tool)
    spec = AgentRunSpec(
        initial_messages=[{"role": "user", "content": "go"}],
        tools=registry,
        model="fake-model",
        max_iterations=5,
        max_tool_result_chars=10_000,
        concurrent_tools=concurrent,
        **spec_kw,
    )
    return asyncio.run(AgentRunner(_Provider(calls)).run(spec))


def _tool_messages(result: Any) -> list[dict[str, Any]]:
    return [m for m in result.messages if m.get("role") == "tool"]


def test_read_only_calls_overlap_and_keep_call_order() -> None:
    log = _new_log()
    # Later calls finish first, so completion order differs from call order.
    tools = [
        _Probe("read_a", log, read_only=True, delay=0.12),
        _Probe("read_b", log, read_only=True, delay=0.06),
        _Probe("read_c", log, read_only=True, delay=0.01),
    ]
    result = _run(tools, ["read_a", "read_b", "read_c"], concurrent=True)

    assert log["max_active"] == 3
    messages = _tool_messages(result)
    assert [m["tool_call_id"] for m in messages] == ["call-0", "call-1", "call-2"]
    assert [m["content"] for m in messages] == [
        "result:read_a",
        "result:read_b",
        "result:read_c",
    ]
    assert [e["name"] for e in result.tool_events] == ["read_a", "read_b", "read_c"]


def test_mutating_and_exclusive_tools_split_batches_and_run_alone() -> None:
    log = _new_log()
    tools = [
        _Probe("read_a", log, read_only=True),
        _Probe("read_b", log, read_only=True),
        _Probe("write", log, read_only=False),
        _Probe("ask_user", log, read_only=True, exclusive=True),
        _Probe("read_c", log, read_only=True),
        _Probe("read_d", log, read_only=True),
    ]
    calls = ["read_a", "read_b", "write", "ask_user", "read_c", "read_d"]
    result = _run(tools, calls, concurrent=True)

    assert log["serial_overlap"] is False
    assert log["max_active"] == 2
    assert log["started"][2:4] == ["write", "ask_user"]
    assert [m["content"] for m in _tool_messages(result)] == [
        f"result:{name}" for name in calls
    ]


def test_without_concurrent_tools_everything_is_serial() -> None:
    log = _new_log()
    tools = [
        _Probe("read_a", log, read_only=True),
        _Probe("read_b", log, read_only=True),
    ]
    _run(tools, ["read_a", "read_b"], concurrent=False)
    assert log["max_active"] == 1


def test_permission_gate_is_serialized_inside_a_parallel_batch() -> None:
    log = _new_log()
    tools = [
        _Probe("read_a", log, read_only=True),
        _Probe("read_b", log, read_only=True),
        _Probe("read_c", log, read_only=True),
    ]
    gate = {"active": 0, "max_active": 0}

    async def checker(name: str, arguments: dict[str, Any]):
        gate["active"] += 1
        gate["max_active"] = max(gate["max_active"], gate["active"])
        await asyncio.sleep(0.01)
        gate["active"] -= 1
        return ("allow", "ok")

    _run(
        tools,
        ["read_a", "read_b", "read_c"],
        concurrent=True,
        permission_checker=checker,
    )
    assert gate["max_active"] == 1
    assert log["max_active"] == 3


def test_harness_stateful_tools_are_not_parallel_safe() -> None:
    from core.harness.tools.plan import UpdatePlanTool
    from core.harness.tools.user_input import RequestUserInputTool

    for tool_cls in (UpdatePlanTool, RequestUserInputTool):
        tool = object.__new__(tool_cls)
        assert tool.read_only is True
        assert tool.concurrency_safe is False


def test_mcp_tool_parallel_requires_read_only_annotation() -> None:
    from core.mcp.tools import McpToolAdapter

    def adapter(read_only_hint: bool | None, parallel: bool) -> McpToolAdapter:
        server = SimpleNamespace(
            server_id="srv",
            name="x",
            source=SimpleNamespace(value="user"),
            definition=SimpleNamespace(
                policy_for=lambda _name: SimpleNamespace(value="auto"),
                supports_parallel_tool_calls=parallel,
            ),
        )
        definition = SimpleNamespace(
            name="tool",
            description="d",
            inputSchema={"type": "object", "properties": {}},
            annotations=(
                SimpleNamespace(readOnlyHint=read_only_hint)
                if read_only_hint is not None
                else None
            ),
        )
        return McpToolAdapter(
            SimpleNamespace(server=server), definition, visible_name="mcp_x_tool"
        )

    assert adapter(True, True).concurrency_safe is True
    assert adapter(None, True).concurrency_safe is False
    assert adapter(False, True).concurrency_safe is False
    assert adapter(True, False).concurrency_safe is False


def test_interactive_session_enables_concurrent_tools() -> None:
    from core.events.session import AgentSession
    from core.events import UserInput

    captured: dict[str, Any] = {}

    class _NoopProvider:
        def get_default_model(self) -> str:
            return "fake-model"

        async def chat_with_retry(self, **kwargs: Any) -> LLMResponse:
            return LLMResponse(content="hi", finish_reason="stop")

    async def scenario() -> None:
        session = AgentSession(_NoopProvider(), ToolRegistry(), model="fake-model")
        original = session._runner.run

        async def spy(spec: AgentRunSpec):
            captured["concurrent_tools"] = spec.concurrent_tools
            return await original(spec)

        session._runner.run = spy  # type: ignore[method-assign]
        async for _event in session.run_stream(UserInput(text="hello")):
            pass
        await session.aclose()

    asyncio.run(scenario())
    assert captured["concurrent_tools"] is True
