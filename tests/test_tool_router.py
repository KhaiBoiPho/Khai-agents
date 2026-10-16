from __future__ import annotations

import asyncio

from core.agent_runtime.tool_router import (
    ALWAYS,
    RequestToolsTool,
    ToolRouter,
    group_of,
    recent_tool_groups,
)

NAMES = (
    "read", "write", "edit", "grep", "bash", "web_fetch", "planner_read", "planner_write",
    "khaidocs_read", "spawn_agent", "update_plan", "request_tools", "mystery_tool",
)


def _router(answers: dict | None = None, *, fail: bool = False) -> tuple[ToolRouter, list]:
    calls: list = []

    async def post(url, json, headers):
        calls.append(json)
        if fail:
            raise TimeoutError("slow")
        return {"answers": answers or {}, "usage": {"cost": 0.00001}}

    return ToolRouter(api_key="test-key", post=post), calls


def test_groups_cover_the_real_tool_names() -> None:
    assert group_of("planner_write") == "planner"
    assert group_of("apply_patch") == "files"
    assert group_of("mcp_gmail_send") == "connectors"
    assert group_of("mystery_tool") is None


def test_only_needed_groups_reach_the_model() -> None:
    router, calls = _router({
        "planner": {"type": "noul", "noul": 0.92},
        "files": {"type": "noul", "noul": 0.05},
        "shell": {"type": "noul", "noul": 0.02},
        "web": {"type": "noul", "noul": 0.1},
    })
    asyncio.run(router.route("Thêm lịch họp 9h sáng mai", [], NAMES))
    shown = set(router.filter(NAMES))
    assert {"planner_read", "planner_write"} <= shown
    assert not {"read", "bash", "web_fetch", "khaidocs_read"} & shown
    # Control tools and unknown tools are never routed away.
    assert {"update_plan", "request_tools", "mystery_tool"} <= shown
    assert set(calls[0]["questions"]) >= {"planner", "files", "shell", "web"}
    assert router.last_cost_usd > 0


def test_failure_shows_every_tool() -> None:
    router, _ = _router(fail=True)
    asyncio.run(router.route("hello", [], NAMES))
    assert router.selection is None
    assert router.filter(NAMES) is None


def test_no_key_means_no_routing() -> None:
    router = ToolRouter(api_key="")
    asyncio.run(router.route("hello", [], NAMES))
    assert router.filter(NAMES) is None


def test_recently_used_groups_stay_selected() -> None:
    history = [{"role": "assistant", "tool_calls": [{"function": {"name": "bash"}}]}]
    assert recent_tool_groups(history) == {"shell"}
    router, _ = _router({"shell": {"type": "noul", "noul": 0.0}})
    asyncio.run(router.route("tiếp tục", history, NAMES))
    assert "bash" in router.filter(NAMES)


def test_request_tools_adds_a_group_mid_turn() -> None:
    router, _ = _router({"files": {"type": "noul", "noul": 0.0}})
    asyncio.run(router.route("chào", [], NAMES))
    assert "read" not in router.filter(NAMES)
    message = asyncio.run(RequestToolsTool(router).execute(groups=["files"]))
    assert "Enabled: files" in message
    assert "read" in router.filter(NAMES)
    assert "request_tools" in ALWAYS


def test_selection_only_grows_so_the_prompt_cache_survives() -> None:
    router, calls = _router({"planner": {"type": "noul", "noul": 0.9}})
    asyncio.run(router.route("lịch họp", [], NAMES))
    async def post(url, json, headers):
        calls.append(json)
        return {"answers": {"files": {"type": "noul", "noul": 0.9}}}

    router._post = post
    asyncio.run(router.route("sửa file", [], NAMES))
    assert {"planner", "files"} <= router.selection
    assert "planner" not in calls[1]["questions"]  # already shown: not asked again
