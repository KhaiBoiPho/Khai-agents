"""DeepThink Turn plumbing: mode persistence, execution routing, retry (stubs)."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import pytest

from app_server.connection import ConnectionState
from app_server.dispatcher import Dispatcher, Params
from app_server.errors import InvalidParams
from core.application import DeepCodeApplication
from core.domain import TrustState
from core.domain.item import ItemKind, ItemStatus
from core.domain.turn import TurnStatus
from core.events import (
    AgentMessage,
    AgentMessageDelta,
    DeepThinkProgress,
    Event,
    ModelUsageRecorded,
    TaskComplete,
    TurnStarted,
)
from core.sessions import SessionStore

ROOT = Path(__file__).resolve().parents[2]


class StubSession:
    def __init__(self) -> None:
        self.history: list[dict[str, Any]] = []
        self.loaded: list[list[dict[str, Any]]] = []
        self.normal_runs: list[str] = []

    def load_history(self, messages: list[dict[str, Any]]) -> None:
        self.history = list(messages)
        self.loaded.append(list(messages))

    async def run_stream(self, op):
        self.normal_runs.append(op.text)
        self.history.append({"role": "user", "content": op.text})
        yield Event("1", TurnStarted())
        yield Event("2", AgentMessage("normal answer"))
        yield Event("3", TaskComplete("normal answer", "completed"))
        self.history.append({"role": "assistant", "content": "normal answer"})

    async def aclose(self) -> None:
        return None


class StubFactory:
    def __init__(self) -> None:
        self.sessions: list[StubSession] = []

    def create(self, *, workspace, model, execution_profile, approval_callback):
        del workspace, model, execution_profile, approval_callback
        session = StubSession()
        self.sessions.append(session)
        return session


def _progress(status: str, search: str) -> dict[str, Any]:
    return {
        "version": 1,
        "status": status,
        "round": 1,
        "steps": [
            {"id": "plan", "label": "Plan", "status": "completed", "detail": "2 sub-questions", "items": []},
            {"id": "search", "label": "Search", "status": search, "detail": None, "items": []},
            {"id": "check", "label": "Check", "status": "skipped", "detail": None, "items": []},
            {"id": "summarize", "label": "Summarize", "status": "completed" if status == "completed" else "pending", "detail": None, "items": []},
        ],
        "sources": [{"id": 1, "title": "Example", "url": "https://example.com"}],
        "notes": [],
    }


class StubDeepThink:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def __call__(self, session, *, prompt, execution_profile):
        self.calls.append(
            {"session": session, "prompt": prompt, "profile": execution_profile}
        )

        async def stream():
            answer = "Deep answer [1].\n\n**Sources**\n\n- \\[1\\] [Example](https://example.com)"
            yield Event("1", TurnStarted())
            yield Event("2", DeepThinkProgress(_progress("running", "running")))
            yield Event("3", AgentMessageDelta("Deep answer", "dt-msg"))
            yield Event(
                "4",
                ModelUsageRecorded(
                    response_ordinal=1,
                    usage={"prompt_tokens": 120, "completion_tokens": 30},
                ),
            )
            yield Event("5", DeepThinkProgress(_progress("completed", "completed")))
            yield Event("6", AgentMessage(answer, message_id="dt-msg"))
            yield Event("7", TaskComplete(answer, "completed"))

        return stream()


def _application(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    home = tmp_path / "home"
    home.mkdir()
    (home / "deepcode_config.json").write_text(
        json.dumps(
            {
                "agents": {"defaults": {"connection": "router-a", "model": "moonshotai/kimi-k2.5"}},
                "providers": {"profiles": {"router-a": {"label": "Router A", "template": "openrouter"}}},
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("DEEPCODE_HOME", str(home))
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    factory = StubFactory()
    sessions = SessionStore(tmp_path / "sessions")
    application = DeepCodeApplication.open(
        tmp_path / "state.sqlite3",
        session_factory=factory,
        session_store=sessions,
    )
    project = application.projects.add(str(workspace), trust_state=TrustState.TRUSTED)
    thread = application.threads.start(
        project.id,
        title="Research",
        connection_id="router-a",
        model="moonshotai/kimi-k2.5",
        reasoning_effort="low",
        context_window=128_000,
    )
    deepthink = StubDeepThink()
    application.turns.deepthink_stream_factory = deepthink
    return application, thread.id, sessions, factory, deepthink


def _wait(application, turn_id: str, status: TurnStatus):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        snapshot = application.turns.read(turn_id)
        if snapshot.turn.status is status:
            return snapshot
        time.sleep(0.01)
    raise AssertionError(f"turn did not reach {status}: {application.turns.read(turn_id).turn}")


def test_deepthink_turn_runs_the_graph_and_persists_like_a_normal_turn(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    application, thread_id, sessions, factory, deepthink = _application(tmp_path, monkeypatch)
    try:
        snapshot = application.turns.start(
            thread_id, prompt="Compare A and B", message_id="m-1", mode="deepthink"
        )
        done = _wait(application, snapshot.turn.id, TurnStatus.COMPLETED)

        assert len(deepthink.calls) == 1
        assert deepthink.calls[0]["prompt"] == "Compare A and B"
        assert deepthink.calls[0]["profile"].model_id == "moonshotai/kimi-k2.5"
        assert factory.sessions[0].normal_runs == []

        user = next(item for item in done.items if item.kind is ItemKind.USER_MESSAGE)
        assert user.payload["mode"] == "deepthink"
        stages = [item for item in done.items if item.kind is ItemKind.WORKFLOW_STAGE]
        assert len(stages) == 1, "progress updates one item in place"
        assert stages[0].status is ItemStatus.COMPLETED
        assert stages[0].payload["name"] == "deepthink"
        assert stages[0].payload["deepthink"]["status"] == "completed"
        answer = next(item for item in done.items if item.kind is ItemKind.ASSISTANT_MESSAGE)
        assert answer.payload["text"].startswith("Deep answer [1].")
        completion = next(item for item in done.items if item.kind is ItemKind.COMPLETION)
        assert completion.payload["usage"]["prompt_tokens"] == 120

        canonical = sessions.get_session(thread_id)
        roles = [(message.role, message.content[:11]) for message in canonical.messages]
        assert roles[-2:] == [("user", "Compare A a"), ("assistant", "Deep answer")]
        assert canonical.messages[-1].metadata["mode"] == "deepthink"
        # The live kernel reloads history so the next normal Turn sees it.
        assert factory.sessions[0].history[-1]["content"].startswith("Deep answer")

        follow = application.turns.start(thread_id, prompt="And C?", message_id="m-2")
        _wait(application, follow.turn.id, TurnStatus.COMPLETED)
        assert len(deepthink.calls) == 1
        assert factory.sessions[0].normal_runs == ["And C?"]
        follow_user = next(
            item
            for item in application.turns.read(follow.turn.id).items
            if item.kind is ItemKind.USER_MESSAGE
        )
        assert "mode" not in follow_user.payload
    finally:
        application.close()


@pytest.mark.parametrize("use_current_selection", [False, True])
def test_retry_reruns_deepthink(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, use_current_selection: bool
) -> None:
    application, thread_id, _sessions, _factory, deepthink = _application(tmp_path, monkeypatch)
    try:
        first = application.turns.start(thread_id, prompt="Research X", mode="deepthink")
        _wait(application, first.turn.id, TurnStatus.COMPLETED)
        retried = application.turns.retry(
            first.turn.id, use_current_selection=use_current_selection
        )
        done = _wait(application, retried.turn.id, TurnStatus.COMPLETED)
        assert len(deepthink.calls) == 2
        user = next(item for item in done.items if item.kind is ItemKind.USER_MESSAGE)
        assert user.payload["mode"] == "deepthink"
        assert user.payload["source"] == "retry"
    finally:
        application.close()


def test_enqueue_persists_mode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    application, thread_id, _sessions, _factory, deepthink = _application(tmp_path, monkeypatch)
    try:
        queued = application.turns.enqueue(
            thread_id, prompt="Queued research", message_id="q-1", mode="deepthink"
        )
        _wait(application, queued.turn.id, TurnStatus.COMPLETED)
        assert [call["prompt"] for call in deepthink.calls] == ["Queued research"]
    finally:
        application.close()


def test_message_id_replay_with_a_different_mode_conflicts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.application.errors import DuplicateMessageConflictError

    application, thread_id, _sessions, _factory, _deepthink = _application(tmp_path, monkeypatch)
    try:
        first = application.turns.start(thread_id, prompt="Same", message_id="dup", mode="deepthink")
        _wait(application, first.turn.id, TurnStatus.COMPLETED)
        replay = application.turns.start(thread_id, prompt="Same", message_id="dup", mode="deepthink")
        assert replay.turn.id == first.turn.id
        with pytest.raises(DuplicateMessageConflictError):
            application.turns.start(thread_id, prompt="Same", message_id="dup")
    finally:
        application.close()


def test_dispatcher_plumbs_and_validates_mode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    application, thread_id, _sessions, _factory, deepthink = _application(tmp_path, monkeypatch)
    try:
        dispatcher = Dispatcher(application, ConnectionState(application.broker))
        with pytest.raises(InvalidParams):
            dispatcher._handlers["turn/start"](
                Params({"threadId": thread_id, "prompt": "x", "messageId": "bad", "mode": "turbo"})
            )
        result = dispatcher._handlers["turn/start"](
            Params(
                {"threadId": thread_id, "prompt": "Research", "messageId": "rpc-1", "mode": "deepthink"}
            )
        )
        _wait(application, result["turn"]["id"], TurnStatus.COMPLETED)
        assert len(deepthink.calls) == 1
    finally:
        application.close()


def test_protocol_schema_declares_the_mode() -> None:
    schema = json.loads((ROOT / "protocol" / "app-server.schema.json").read_text("utf-8"))
    mode = schema["$defs"]["TurnStartParams"]["properties"]["mode"]
    assert mode["enum"] == ["normal", "deepthink"]
    generated = (ROOT / "desktop" / "src" / "generated" / "app-server.ts").read_text("utf-8")
    assert 'mode?: "normal" | "deepthink";' in generated
