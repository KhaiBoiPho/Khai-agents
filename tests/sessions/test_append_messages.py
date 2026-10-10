"""Batched transcript appends keep the JSONL format and rewrite once."""

import json
import os
from pathlib import Path
from unittest.mock import patch

from core.sessions.store import SessionStore


def _lines(store: SessionStore, session_id: str) -> list[dict]:
    path = store.root / session_id / "session.jsonl"
    return [json.loads(line) for line in path.read_text("utf-8").splitlines()]


def test_append_messages_writes_once_and_round_trips(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions")
    session = store.create_session(title="")
    store.append_message(session.session_id, "user", "first prompt")

    with patch("core.sessions.store.os.replace", wraps=os.replace) as replaced:
        added = store.append_messages(
            session.session_id,
            [
                {"role": "assistant", "content": "answer", "metadata": {"k": 1}},
                {"role": "tool", "content": "output", "task_id_ref": "t1"},
                {"role": "assistant", "content": "done"},
            ],
        )
    assert replaced.call_count == 1
    assert [message.content for message in added] == ["answer", "output", "done"]

    rows = _lines(store, session.session_id)
    assert rows[0]["_type"] == "metadata"
    assert rows[0]["title"] == "first prompt"
    assert rows[0]["updated_at"] == added[-1].timestamp
    assert [row["_type"] for row in rows[1:]] == ["message"] * 4
    assert rows[2]["metadata"] == {"k": 1}
    assert rows[3]["task_id_ref"] == "t1"

    fresh = SessionStore(store.root).get_session(session.session_id)
    assert fresh is not None
    assert [m.content for m in fresh.messages] == [
        "first prompt",
        "answer",
        "output",
        "done",
    ]
    assert fresh.updated_at == added[-1].timestamp
    cached = store.get_session(session.session_id)
    assert [m.to_dict() for m in cached.messages] == [
        m.to_dict() for m in fresh.messages
    ]


def test_append_messages_follows_writes_from_another_store(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions")
    session = store.create_session(title="shared")
    store.append_message(session.session_id, "user", "mine")

    SessionStore(store.root).append_message(session.session_id, "assistant", "theirs")
    store.append_messages(session.session_id, [{"role": "user", "content": "again"}])

    fresh = SessionStore(store.root).get_session(session.session_id)
    assert [m.content for m in fresh.messages] == ["mine", "theirs", "again"]


def test_append_messages_missing_session_and_empty_batch(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions")
    assert store.append_messages("missing", [{"role": "user", "content": "x"}]) is None
    session = store.create_session(title="t")
    before = store.disk_signature(session.session_id)
    assert store.append_messages(session.session_id, []) == []
    assert store.disk_signature(session.session_id) == before


def test_failed_batch_does_not_leave_messages_in_the_cache(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions")
    session = store.create_session(title="t")
    with patch.object(store, "_rewrite_metadata", side_effect=OSError("disk full")):
        try:
            store.append_messages(
                session.session_id, [{"role": "user", "content": "x"}]
            )
        except OSError:
            pass
    assert store.get_session(session.session_id).messages == []


def test_disk_signatures_track_sessions(tmp_path: Path) -> None:
    store = SessionStore(tmp_path / "sessions")
    first = store.create_session(title="a")
    second = store.create_session(title="b")
    signatures = store.disk_signatures()
    assert set(signatures) == {first.session_id, second.session_id}

    store.append_message(first.session_id, "user", "hi")
    moved = store.disk_signatures()
    assert moved[first.session_id] != signatures[first.session_id]
    assert moved[second.session_id] == signatures[second.session_id]
