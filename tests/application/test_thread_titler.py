from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any

import pytest

from core.application import DeepCodeApplication
from core.application.thread_titler import (
    ThreadTitler,
    clean_title,
    is_automatic_title,
)
from core.domain import TrustState
from core.domain.turn import TurnStatus
from core.events import AgentMessage, Event, TaskComplete, TurnStarted


class _Session:
    def __init__(self, *, fail: bool) -> None:
        self.fail = fail
        self.history: list[dict[str, Any]] = []

    def load_history(self, messages: list[dict[str, Any]]) -> None:
        self.history = messages

    async def run_stream(self, op):
        yield Event("1", TurnStarted())
        if self.fail:
            raise RuntimeError("model exploded")
        yield Event("2", AgentMessage("It is a RAG demo."))
        yield Event("3", TaskComplete("It is a RAG demo.", "completed"))
        self.history.extend(
            [
                {"role": "user", "content": op.text},
                {"role": "assistant", "content": "It is a RAG demo."},
            ]
        )

    async def aclose(self) -> None:
        pass


class _Factory:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail

    def create(self, *, workspace, model, approval_callback):
        return _Session(fail=self.fail)


class _Recorder:
    """Stub title generator; records calls and signals when titling finished."""

    def __init__(self, result: str | Exception = "Giới thiệu dự án agentic-rag"):
        self.result = result
        self.calls: list[tuple[str, str]] = []
        self.done = threading.Event()

    def generate(self, profile, workspace_path, user_text, answer_text) -> str:
        self.calls.append((user_text, answer_text))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result

    def spawn(self, work) -> None:
        def run() -> None:
            try:
                work()
            finally:
                self.done.set()

        threading.Thread(target=run, daemon=True).start()


def _open(tmp_path: Path, recorder: _Recorder, *, fail: bool = False):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    application = DeepCodeApplication.open(
        tmp_path / "state.sqlite3", session_factory=_Factory(fail=fail)
    )
    # Swap the production titler for one with a stubbed model call.
    application.turns.remove_settled_listener(application.titler.on_turn_settled)
    titler = ThreadTitler(
        application.database,
        application.threads,
        application.llm,
        generate=recorder.generate,
        spawn=recorder.spawn,
    )
    application.turns.add_settled_listener(titler.on_turn_settled)
    project = application.projects.add(str(workspace), trust_state=TrustState.TRUSTED)
    thread = application.threads.start(project.id, title="New task")
    return application, thread.id


def _run_turn(application, thread_id: str, prompt: str, status=TurnStatus.COMPLETED):
    started = application.turns.start(thread_id, prompt=prompt)
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if application.turns.read(started.turn.id).turn.status is status:
            return started.turn
        time.sleep(0.01)
    raise AssertionError(application.turns.read(started.turn.id).turn)


def test_first_completed_turn_renames_thread_to_generated_title(tmp_path: Path):
    recorder = _Recorder()
    application, thread_id = _open(tmp_path, recorder)
    try:
        # Mirror the Desktop: it titles the Session from the prompt first.
        application.threads.rename(thread_id, "dự án này làm gì?")
        _run_turn(application, thread_id, "dự án này làm gì?")
        assert recorder.done.wait(3)
        assert recorder.calls == [("dự án này làm gì?", "It is a RAG demo.")]
        assert (
            application.threads.read(thread_id).title
            == "Giới thiệu dự án agentic-rag"
        )
        renamed = [
            event
            for event in application.events.replay(thread_id)
            if event.type == "thread.renamed"
        ]
        assert renamed[-1].payload["thread"]["title"] == "Giới thiệu dự án agentic-rag"
    finally:
        application.close()


def test_failed_first_turn_does_not_rename(tmp_path: Path):
    recorder = _Recorder()
    application, thread_id = _open(tmp_path, recorder, fail=True)
    try:
        _run_turn(application, thread_id, "hello there", status=TurnStatus.FAILED)
        assert not recorder.done.wait(0.3)
        assert recorder.calls == []
        assert application.threads.read(thread_id).title == "New task"
    finally:
        application.close()


def test_second_turn_does_not_rename(tmp_path: Path):
    recorder = _Recorder(RuntimeError("model down"))
    application, thread_id = _open(tmp_path, recorder)
    try:
        _run_turn(application, thread_id, "first question")
        assert recorder.done.wait(3)
        recorder.done.clear()
        recorder.result = "Should not be used"
        _run_turn(application, thread_id, "second question")
        assert not recorder.done.wait(0.3)
        assert len(recorder.calls) == 1
        assert application.threads.read(thread_id).title == "New task"
    finally:
        application.close()


def test_user_renamed_thread_is_not_overwritten(tmp_path: Path):
    recorder = _Recorder()
    application, thread_id = _open(tmp_path, recorder)
    try:
        application.threads.rename(thread_id, "My important chat")
        _run_turn(application, thread_id, "what does this do?")
        assert recorder.done.wait(3)
        assert recorder.calls == []
        assert application.threads.read(thread_id).title == "My important chat"
    finally:
        application.close()


def test_generation_error_keeps_existing_title(tmp_path: Path):
    recorder = _Recorder(TimeoutError("too slow"))
    application, thread_id = _open(tmp_path, recorder)
    try:
        application.threads.rename(thread_id, "explain the repo")
        _run_turn(application, thread_id, "explain the repo")
        assert recorder.done.wait(3)
        assert len(recorder.calls) == 1
        assert application.threads.read(thread_id).title == "explain the repo"
    finally:
        application.close()


@pytest.mark.parametrize(
    ("title", "prompt", "expected"),
    [
        ("New task", "anything", True),
        ("hello", "hello\nmore lines", True),
        ("a" * 60 + "…", "a" * 80, True),
        ("a" * 60, "a" * 80, True),
        ("Renamed by me", "hello", False),
        ("hel", "hello", False),
    ],
)
def test_is_automatic_title(title: str, prompt: str, expected: bool):
    assert is_automatic_title(title, prompt) is expected


def test_clean_title_normalizes_model_output():
    assert clean_title('"Giới thiệu dự án."\nextra') == "Giới thiệu dự án"
    assert clean_title("Title: **Fix the build**") == "Fix the build"
    assert clean_title("") == ""
    assert len(clean_title("x" * 200)) == 61
