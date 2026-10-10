"""Token/API cost controls (stubs only, no real provider calls).

Covers the parallel-round bounds (batch cap, dedupe, order, combined size),
deterministic tool ordering for prompt caching, cache usage extraction and
breakpoint placement, the optional spend guard, and result truncation.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.agent_runtime.helpers import maybe_persist_tool_result, truncate_head_tail
from core.agent_runtime.runner import AgentRunner, AgentRunSpec
from core.agent_runtime.spend import response_cost_usd
from core.agent_runtime.tools.base import Tool, tool_parameters
from core.agent_runtime.tools.registry import ToolRegistry, canonical_schema
from core.config import (
    LOW_EFFORT_OUTPUT_TOKEN_BUDGET,
    AgentDefaults,
    output_budget_for_effort,
)
from core.providers.anthropic import AnthropicProvider
from core.providers.base import NANO_USD, USAGE_COST_KEY, LLMResponse, ToolCallRequest
from core.providers.openai_compat import OpenAICompatProvider
from core.providers.openai_responses.parsing import parse_response_output


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


@tool_parameters(
    {"type": "object", "properties": {"arg": {"type": "string"}}, "required": []}
)
class _Probe(Tool):
    def __init__(
        self,
        name: str,
        log: dict[str, Any],
        *,
        read_only: bool = True,
        output: str | None = None,
        delay: float = 0.02,
    ) -> None:
        self._name = name
        self._log = log
        self._read_only = read_only
        self._output = output
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

    async def execute(self, **kwargs: Any) -> Any:
        log = self._log
        log["active"] += 1
        log["max_active"] = max(log["max_active"], log["active"])
        log["runs"].append((self._name, kwargs.get("arg")))
        await asyncio.sleep(self._delay)
        log["active"] -= 1
        if self._output is not None:
            return self._output
        return f"result:{self._name}:{kwargs.get('arg')}"


def _log() -> dict[str, Any]:
    return {"active": 0, "max_active": 0, "runs": []}


class _ScriptedProvider:
    def __init__(self, responses: list[LLMResponse]) -> None:
        self._responses = responses
        self.calls = 0
        self.requests: list[dict[str, Any]] = []

    def get_default_model(self) -> str:
        return "fake-model"

    async def chat_with_retry(self, **kwargs: Any) -> LLMResponse:
        self.requests.append(kwargs)
        index = min(self.calls, len(self._responses) - 1)
        self.calls += 1
        return self._responses[index]


def _calls(*specs: tuple[str, dict[str, Any]]) -> LLMResponse:
    return LLMResponse(
        content="",
        tool_calls=[
            ToolCallRequest(id=f"call-{i}", name=name, arguments=args)
            for i, (name, args) in enumerate(specs)
        ],
        finish_reason="tool_calls",
    )


def _run(
    tools: list[Tool],
    responses: list[LLMResponse],
    **spec_kw: Any,
) -> tuple[Any, _ScriptedProvider]:
    registry = ToolRegistry()
    for tool in tools:
        registry.register(tool)
    provider = _ScriptedProvider(responses)
    kwargs: dict[str, Any] = {
        "initial_messages": [{"role": "user", "content": "go"}],
        "tools": registry,
        "model": "fake-model",
        "max_iterations": 6,
        "max_tool_result_chars": 10_000,
        "concurrent_tools": True,
    }
    kwargs.update(spec_kw)
    spec = AgentRunSpec(**kwargs)
    return asyncio.run(AgentRunner(provider).run(spec)), provider


def _tool_messages(result: Any) -> list[dict[str, Any]]:
    return [m for m in result.messages if m.get("role") == "tool"]


_DONE = LLMResponse(content="done", finish_reason="stop")


# ---------------------------------------------------------------------------
# parallel rounds: batch cap, dedupe, order, combined size
# ---------------------------------------------------------------------------


def test_parallel_batch_is_capped_and_results_keep_call_order() -> None:
    log = _log()
    tool = _Probe("look", log)
    calls = _calls(*[("look", {"arg": str(i)}) for i in range(7)])
    result, _ = _run([tool], [calls, _DONE], max_parallel_tools=3)

    assert log["max_active"] == 3
    assert len(log["runs"]) == 7
    assert [m["tool_call_id"] for m in _tool_messages(result)] == [
        f"call-{i}" for i in range(7)
    ]
    assert [m["content"] for m in _tool_messages(result)] == [
        f"result:look:{i}" for i in range(7)
    ]


def test_default_parallel_cap_is_four() -> None:
    log = _log()
    calls = _calls(*[("look", {"arg": str(i)}) for i in range(9)])
    _run([_Probe("look", log)], [calls, _DONE])
    assert log["max_active"] == 4


def test_identical_read_only_calls_run_once_and_repeats_point_back() -> None:
    log = _log()
    calls = _calls(
        ("look", {"arg": "a"}),
        ("look", {"arg": "b"}),
        ("look", {"arg": "a"}),  # duplicate of call-0
    )
    result, _ = _run([_Probe("look", log)], [calls, _DONE])

    assert sorted(log["runs"]) == [("look", "a"), ("look", "b")]
    messages = _tool_messages(result)
    assert [m["tool_call_id"] for m in messages] == ["call-0", "call-1", "call-2"]
    assert messages[0]["content"] == "result:look:a"
    assert messages[1]["content"] == "result:look:b"
    assert "call-0" in messages[2]["content"]
    assert "ran once" in messages[2]["content"]
    assert result.tool_events[2]["detail"].startswith("duplicate")


def test_dedupe_window_resets_after_a_side_effecting_call() -> None:
    log = _log()
    calls = _calls(
        ("look", {"arg": "a"}),
        ("write", {"arg": "x"}),  # not concurrency-safe
        ("look", {"arg": "a"}),  # must run again: the write may change it
    )
    _run(
        [_Probe("look", log), _Probe("write", log, read_only=False)],
        [calls, _DONE],
    )
    assert log["runs"] == [("look", "a"), ("write", "x"), ("look", "a")]


def test_dedupe_can_be_disabled() -> None:
    log = _log()
    calls = _calls(("look", {"arg": "a"}), ("look", {"arg": "a"}))
    _run([_Probe("look", log)], [calls, _DONE], dedupe_read_only_calls=False)
    assert log["runs"] == [("look", "a"), ("look", "a")]


def test_round_results_are_bounded_by_spilling_largest(tmp_path: Path) -> None:
    log = _log()
    big = "B" * 9_000
    tools = [
        _Probe("big1", log, output=big),
        _Probe("small", log, output="tiny"),
        _Probe("big2", log, output=big),
    ]
    calls = _calls(("big1", {}), ("small", {}), ("big2", {}))
    result, _ = _run(
        tools,
        [calls, _DONE],
        max_round_tool_result_chars=12_000,
        workspace=tmp_path,
        session_key="s",
    )
    messages = _tool_messages(result)
    assert [m["name"] for m in messages] == ["big1", "small", "big2"]
    assert messages[1]["content"] == "tiny"
    total = sum(len(m["content"]) for m in messages)
    assert total <= 12_000
    spilled = [m for m in messages if m["content"].startswith("[tool output persisted]")]
    assert spilled, "at least one large result must be spilled"
    saved = Path(spilled[0]["content"].split("Full output saved to: ")[1].split("\n")[0])
    assert saved.read_text() == big


def test_round_under_budget_is_untouched(tmp_path: Path) -> None:
    log = _log()
    tools = [_Probe("a", log, output="x" * 3000), _Probe("b", log, output="y" * 3000)]
    result, _ = _run(
        tools, [_calls(("a", {}), ("b", {})), _DONE], workspace=tmp_path
    )
    assert [m["content"] for m in _tool_messages(result)] == ["x" * 3000, "y" * 3000]


# ---------------------------------------------------------------------------
# truncation / spill previews / images
# ---------------------------------------------------------------------------


def test_truncate_head_tail_keeps_both_ends() -> None:
    text = "HEAD" + "m" * 10_000 + "TAIL"
    out = truncate_head_tail(text, 1_000)
    assert out.startswith("HEAD") and out.endswith("TAIL")
    assert "chars omitted" in out
    assert len(out) < 1_100
    assert truncate_head_tail("short", 1_000) == "short"


def test_spilled_result_preview_has_head_and_tail(tmp_path: Path) -> None:
    text = "START\n" + "line\n" * 5_000 + "EXIT 1\n"
    out = maybe_persist_tool_result(tmp_path, "s", "c1", text, max_chars=12_000)
    assert out.startswith("[tool output persisted]")
    assert "START" in out and "EXIT 1" in out
    assert len(out) < 5_000
    assert "offset/limit" in out


def test_oversized_result_without_workspace_is_head_tail_truncated() -> None:
    log = _log()
    text = "HEAD" + "z" * 50_000 + "TAIL"
    result, _ = _run(
        [_Probe("big", log, output=text)],
        [_calls(("big", {})), _DONE],
        max_tool_result_chars=4_000,
    )
    content = _tool_messages(result)[0]["content"]
    assert content.startswith("HEAD") and content.endswith("TAIL")
    assert len(content) < 4_200


def test_stale_tool_images_are_not_resent() -> None:
    image = {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}
    messages = [
        {"role": "user", "content": "go"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "t1"}]},
        {"role": "tool", "tool_call_id": "t1", "content": "shot", "images": [image]},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "t2"}]},
        {"role": "tool", "tool_call_id": "t2", "content": "shot2", "images": [image]},
    ]
    view = AgentRunner._drop_stale_tool_images(messages)
    assert "images" not in view[2]
    assert "not re-sent" in view[2]["content"]
    assert view[4]["images"] == [image]  # current round still attached
    assert messages[2]["images"] == [image]  # input untouched


# ---------------------------------------------------------------------------
# deterministic tool ordering / schema bytes
# ---------------------------------------------------------------------------


def _schema_names(registry: ToolRegistry) -> list[str]:
    return [ToolRegistry._schema_name(s) for s in registry.get_definitions()]


def test_tool_order_is_sorted_builtins_then_stable_mcp_slots() -> None:
    log = _log()
    registry = ToolRegistry()
    for name in ("read", "bash", "mcp_srv_b", "mcp_srv_a", "grep"):
        registry.register(_Probe(name, log))
    assert _schema_names(registry) == ["bash", "grep", "read", "mcp_srv_a", "mcp_srv_b"]

    # A server connecting late appends at the end, even when its name sorts
    # earlier: the cached prefix before it stays byte-identical.
    before = json.dumps(registry.get_definitions())
    registry.register(_Probe("mcp_late_a", log))
    after_defs = registry.get_definitions()
    assert _schema_names(registry)[-1] == "mcp_late_a"
    assert json.dumps(after_defs).startswith(before[:-1])

    # Reconnect (unregister + register) keeps the original slot.
    registry.unregister("mcp_srv_a")
    registry.register(_Probe("mcp_srv_a", log))
    assert _schema_names(registry) == [
        "bash",
        "grep",
        "read",
        "mcp_srv_a",
        "mcp_srv_b",
        "mcp_late_a",
    ]


def test_tool_definitions_are_byte_stable_across_rebuilds() -> None:
    log = _log()
    registry = ToolRegistry()
    for name in ("write", "mcp_x_tool", "read"):
        registry.register(_Probe(name, log))
    first = json.dumps(registry.get_definitions())
    registry.register(_Probe("glob", log))
    registry.unregister("glob")
    assert json.dumps(registry.get_definitions()) == first


def test_canonical_schema_sorts_keys_but_keeps_lists() -> None:
    schema = {"b": 1, "a": {"z": [3, 1, {"y": 1, "x": 2}], "c": 0}}
    canonical = canonical_schema(schema)
    assert json.dumps(canonical) == (
        '{"a": {"c": 0, "z": [3, 1, {"x": 2, "y": 1}]}, "b": 1}'
    )
    assert canonical == schema  # same meaning


# ---------------------------------------------------------------------------
# cache usage extraction and breakpoints
# ---------------------------------------------------------------------------


def test_openrouter_usage_records_cache_reads_writes_and_cost() -> None:
    usage = OpenAICompatProvider._extract_usage(
        {
            "usage": {
                "prompt_tokens": 20_000,
                "completion_tokens": 300,
                "total_tokens": 20_300,
                "prompt_tokens_details": {
                    "cached_tokens": 18_000,
                    "cache_write_tokens": 1_500,
                },
                "cost": 0.0123,
            }
        }
    )
    assert usage["cached_tokens"] == 18_000
    assert usage["cache_creation_input_tokens"] == 1_500
    assert usage[USAGE_COST_KEY] == round(0.0123 * NANO_USD)


def test_responses_api_usage_records_cached_tokens() -> None:
    response = parse_response_output(
        {
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "hi"}],
                }
            ],
            "usage": {
                "input_tokens": 5_000,
                "output_tokens": 10,
                "total_tokens": 5_010,
                "input_tokens_details": {"cached_tokens": 4_096},
            },
        }
    )
    assert response.usage["cached_tokens"] == 4_096


def _count_markers(value: Any) -> int:
    if isinstance(value, dict):
        own = 1 if "cache_control" in value else 0
        return own + sum(_count_markers(v) for v in value.values())
    if isinstance(value, list):
        return sum(_count_markers(v) for v in value)
    return 0


def _tools(*names: str) -> list[dict[str, Any]]:
    return [
        {"type": "function", "function": {"name": n, "parameters": {"type": "object"}}}
        for n in names
    ]


def test_anthropic_breakpoints_cover_tools_system_and_last_message() -> None:
    messages = [
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": [{"type": "text", "text": "a1"}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t", "content": "r"}]},
    ]
    tools = AnthropicProvider._convert_tools(_tools("bash", "read", "mcp_x_y"))
    system, msgs, marked_tools = AnthropicProvider._apply_cache_control(
        "SYSTEM", messages, tools
    )
    assert system[-1]["cache_control"] == {"type": "ephemeral"}
    assert msgs[-1]["content"][-1]["cache_control"] == {"type": "ephemeral"}
    assert "cache_control" not in json.dumps(msgs[:-1])
    assert marked_tools[1].get("cache_control") and marked_tools[2].get("cache_control")
    total = _count_markers(system) + _count_markers(msgs) + _count_markers(marked_tools)
    assert total <= 4


def test_openai_compat_anthropic_breakpoint_on_last_message() -> None:
    messages = [
        {"role": "system", "content": "S"},
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "t"}]},
        {"role": "tool", "tool_call_id": "t", "content": "result"},
    ]
    marked, tools = OpenAICompatProvider._apply_cache_control(messages, _tools("a"))
    assert marked[0]["content"][-1]["cache_control"]
    assert marked[-1]["content"][-1]["cache_control"]
    assert marked[1] == messages[1] and marked[2] == messages[2]
    assert _count_markers(marked) + _count_markers(tools) <= 4


def test_openai_compat_system_only_breakpoint_for_gemini() -> None:
    messages = [
        {"role": "system", "content": "S"},
        {"role": "user", "content": "q"},
        {"role": "user", "content": "q2"},
    ]
    marked, tools = OpenAICompatProvider._apply_cache_control(
        messages, _tools("a"), system_only=True
    )
    assert _count_markers(marked) == 1
    assert marked[0]["content"][-1]["cache_control"]
    assert _count_markers(tools) == 0


# ---------------------------------------------------------------------------
# spend guard
# ---------------------------------------------------------------------------


def _priced(response: LLMResponse, usd: float) -> LLMResponse:
    response.usage = {
        "prompt_tokens": 1_000,
        "completion_tokens": 10,
        USAGE_COST_KEY: round(usd * NANO_USD),
    }
    return response


def test_turn_spend_guard_stops_before_the_next_model_call() -> None:
    log = _log()
    responses = [
        _priced(_calls(("look", {"arg": "a"})), 0.30),
        _priced(_calls(("look", {"arg": "b"})), 0.30),
        _priced(LLMResponse(content="done"), 0.01),
    ]
    result, provider = _run([_Probe("look", log)], responses, max_turn_cost_usd=0.50)

    assert result.stop_reason == "spend_limit"
    assert provider.calls == 2  # the third call never happened
    assert "limit" in (result.final_content or "")
    assert "maxTurnCostUsd" in (result.final_content or "")
    assert result.messages[-1]["role"] == "assistant"
    assert result.cost_usd == pytest.approx(0.60)


def test_session_spend_guard_blocks_a_turn_without_calling_the_model() -> None:
    result, provider = _run(
        [],
        [_DONE],
        max_session_cost_usd=1.0,
        prior_session_cost_usd=1.25,
    )
    assert result.stop_reason == "spend_limit"
    assert provider.calls == 0
    assert "new chat" in (result.final_content or "")


def test_spend_guard_is_off_by_default() -> None:
    log = _log()
    responses = [
        _priced(_calls(("look", {"arg": "a"})), 50.0),
        _priced(LLMResponse(content="done"), 50.0),
    ]
    result, provider = _run([_Probe("look", log)], responses)
    assert result.stop_reason == "completed"
    assert provider.calls == 2
    assert result.cost_usd == pytest.approx(100.0)


def test_response_cost_prefers_reported_then_list_price() -> None:
    assert response_cost_usd("anything", {USAGE_COST_KEY: NANO_USD // 2}) == 0.5
    assert response_cost_usd("unknown-model-xyz", {"prompt_tokens": 10}) is None
    assert response_cost_usd("x", {}) == 0.0
    priced = response_cost_usd(
        "gpt-5", {"prompt_tokens": 1_000_000, "completion_tokens": 0}
    )
    assert priced is not None and priced > 0


def test_cost_settings_default_off_and_env_overrides(monkeypatch) -> None:
    for name in (
        "KHAI_MAX_TURN_COST_USD",
        "KHAI_MAX_SESSION_COST_USD",
        "KHAI_MAX_PARALLEL_TOOLS",
        "KHAI_MAX_TOOL_RESULT_CHARS",
        "KHAI_COMPACT_TRIGGER_TOKENS",
    ):
        monkeypatch.delenv(name, raising=False)
    defaults = AgentDefaults()
    assert defaults.max_turn_cost_usd is None
    assert defaults.max_session_cost_usd is None
    assert defaults.max_parallel_tools == 4
    assert defaults.max_tool_result_chars == 12_000
    assert defaults.compact_trigger_tokens == 80_000

    monkeypatch.setenv("KHAI_MAX_TURN_COST_USD", "0.25")
    monkeypatch.setenv("KHAI_MAX_PARALLEL_TOOLS", "2")
    tuned = AgentDefaults()
    assert tuned.max_turn_cost_usd == 0.25
    assert tuned.max_parallel_tools == 2
    # camelCase config keys work as for every other agents.defaults field.
    assert AgentDefaults.model_validate({"maxSessionCostUsd": 3}).max_session_cost_usd == 3


# ---------------------------------------------------------------------------
# output tokens / compaction trigger
# ---------------------------------------------------------------------------


def test_low_effort_requests_a_smaller_output_budget() -> None:
    assert output_budget_for_effort("low") == LOW_EFFORT_OUTPUT_TOKEN_BUDGET
    assert output_budget_for_effort("none", 8_192) == 8_192
    assert output_budget_for_effort("high") is None
    assert output_budget_for_effort(None) is None


def test_compact_trigger_tokens_caps_the_window_fraction() -> None:
    class _Meter:
        def measure(self, *_args: Any) -> int:
            return 150_000

        def observe(self, *_args: Any) -> None:
            return None

    runner = AgentRunner(SimpleNamespace(generation=SimpleNamespace(max_tokens=4096)))
    messages = [{"role": "user", "content": "x"}] * 6

    async def _attempted(trigger: int | None) -> bool:
        fired: list[str] = []

        def _pre_compact(trigger_name: str) -> Any:
            fired.append(trigger_name)
            return SimpleNamespace(block=True)  # stop before any model call

        spec = AgentRunSpec(
            initial_messages=[],
            tools=ToolRegistry(),
            model="m",
            max_iterations=1,
            max_tool_result_chars=1_000,
            context_window_tokens=1_000_000,
            compact_trigger_tokens=trigger,
            token_meter=_Meter(),
            tool_result_pruner=None,
            pre_compact_hook=_pre_compact,
        )
        await runner._maybe_compact(spec, list(messages))
        return bool(fired)

    # A 150k-token prompt is under 90% of a 1M window, so without the cap no
    # compaction is attempted; with a 100k cap it is.
    assert asyncio.run(_attempted(None)) is False
    assert asyncio.run(_attempted(100_000)) is True


# ---------------------------------------------------------------------------
# AgentSession wiring
# ---------------------------------------------------------------------------


class _SessionProvider:
    def __init__(self, responses: list[LLMResponse], effort: str | None = None) -> None:
        self._responses = responses
        self.requests: list[dict[str, Any]] = []
        self.generation = SimpleNamespace(
            max_tokens=32_768, temperature=0.1, reasoning_effort=effort
        )

    def get_default_model(self) -> str:
        return "fake-model"

    async def chat_with_retry(self, **kwargs: Any) -> LLMResponse:
        self.requests.append(kwargs)
        return self._responses[min(len(self.requests) - 1, len(self._responses) - 1)]

    chat_stream_with_retry = chat_with_retry


async def _drain(session: Any, text: str) -> list[Any]:
    from core.events import UserInput

    return [event async for event in session.run_stream(UserInput(text=text))]


def test_session_sends_low_effort_output_budget_and_tracks_cost(monkeypatch) -> None:
    from core.events import AgentSession

    monkeypatch.delenv("KHAI_MAX_SESSION_COST_USD", raising=False)
    provider = _SessionProvider(
        [_priced(LLMResponse(content="hi"), 0.4)], effort="low"
    )
    session = AgentSession(
        provider, ToolRegistry(), model="fake-model", max_session_cost_usd=0.5
    )

    async def scenario() -> list[Any]:
        await _drain(session, "one")
        assert provider.requests[0]["max_tokens"] == LOW_EFFORT_OUTPUT_TOKEN_BUDGET
        assert session.session_cost_usd == pytest.approx(0.4)
        await _drain(session, "two")  # 0.8 > 0.5 after this Turn
        assert session.session_cost_usd == pytest.approx(0.8)
        return await _drain(session, "three")

    events = asyncio.run(scenario())
    assert len(provider.requests) == 2  # third Turn never reached the model
    complete = [e for e in events if e.msg.type == "task_complete"][-1]
    assert complete.msg.stop_reason == "spend_limit"


def test_session_hook_context_follows_the_stable_system_prompt() -> None:
    from core.agent_runtime.runner import AgentRunner as _Runner

    composed = _Runner._with_transient_context(
        [
            {"role": "system", "content": "STABLE"},
            {"role": "user", "content": "q"},
        ],
        (
            {"role": "developer", "content": "SKILLS"},
            {"role": "system", "content": "HOOK"},
        ),
    )
    system = composed[0]["content"]
    text = system if isinstance(system, str) else json.dumps(system)
    assert text.index("STABLE") < text.index("SKILLS") < text.index("HOOK")


def test_server_env_spend_limits_are_a_ceiling_for_user_config(monkeypatch) -> None:
    from core.events.session import _env_spend_limit, _tightest

    monkeypatch.setenv("KHAI_MAX_TURN_COST_USD", "0.5")
    ceiling = _env_spend_limit("KHAI_MAX_TURN_COST_USD")
    # A looser user value cannot raise the server's limit; a tighter one wins.
    assert _tightest(5.0, ceiling) == 0.5
    assert _tightest(0.1, ceiling) == 0.1
    assert _tightest(None, ceiling) == 0.5
    monkeypatch.setenv("KHAI_MAX_TURN_COST_USD", "")
    assert _tightest(5.0, _env_spend_limit("KHAI_MAX_TURN_COST_USD")) == 5.0
    assert _tightest(None, None) is None
    monkeypatch.setenv("KHAI_MAX_TURN_COST_USD", "abc")
    assert _env_spend_limit("KHAI_MAX_TURN_COST_USD") is None
