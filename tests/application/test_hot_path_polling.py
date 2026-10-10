"""Regression tests for the cheap polling paths (relay, projection, admission)."""

from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest

from core.application.event_service import DurableEventRelay, EventBroker
from core.application.execution_coordinator import (
    ExecutionCoordinator,
    ExecutionDispatch,
)
from core.application.turn_projection import TurnEventProjector
from core.domain.event import DomainEvent
from core.domain.project import Project
from core.domain.thread import Thread, ThreadMode
from core.domain.turn import Turn
from core.events import AgentMessageCompleted, AgentMessageDelta, Event
from core.persistence.database import Database
from core.persistence.event_repository import EventRepository
from core.persistence.execution_repository import ItemRepository, TurnRepository
from core.persistence.project_repository import ProjectRepository
from core.persistence.thread_repository import ThreadRepository


def _database_with_threads(tmp_path: Path, count: int) -> tuple[Database, list[Thread]]:
    database = Database(tmp_path / "state.sqlite3")
    database.initialize()
    project = Project(canonical_path=str(tmp_path), display_name="Hot paths")
    threads = [
        Thread(
            project_id=project.id,
            title=f"Stream {index}",
            mode=ThreadMode.CODE,
            workspace_path=str(tmp_path),
        )
        for index in range(count)
    ]
    with database.transaction() as connection:
        ProjectRepository(connection).add(project)
        for thread in threads:
            ThreadRepository(connection).add(thread)
    return database, threads


def _append(database: Database, thread_id: str, event_type: str) -> DomainEvent:
    with database.transaction() as connection:
        return EventRepository(connection).append(
            thread_id=thread_id,
            type=event_type,
            payload={"type": event_type},
        )


# -- durable event relay -------------------------------------------------------


def test_relay_polls_by_transaction_cursor_without_full_scans(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database, (first, second) = _database_with_threads(tmp_path, 2)
    _append(database, first.id, "thread.started")
    broker = EventBroker()
    relay = DurableEventRelay(database, broker)
    relay.start(background=False)
    token = broker.subscribe()

    def no_full_scan(self: EventRepository) -> dict[str, int]:
        raise AssertionError("polls must not group the whole event log")

    monkeypatch.setattr(EventRepository, "sequence_heads", no_full_scan)
    writer = Database(database.path)
    external = _append(writer, second.id, "automation.updated")

    assert relay.poll_once() == 1
    assert broker.drain(token).events == (external,)
    assert relay.poll_once() == 0
    relay.close()


def test_relay_delivers_rows_committed_out_of_transaction_order(
    tmp_path: Path,
) -> None:
    """An older transaction committing after a newer one is still relayed."""

    database, (first, second) = _database_with_threads(tmp_path, 2)
    broker = EventBroker()
    relay = DurableEventRelay(database, broker)
    relay.start(background=False)
    token = broker.subscribe()
    writer = Database(database.path)

    # A raw transaction (no per-user write lock) stays open across a newer
    # commit and a relay poll.
    with writer.read() as slow:
        slow.execute("BEGIN")
        slow_event = EventRepository(slow).append(
            thread_id=first.id,
            type="approval.requested",
            payload={},
        )
        fast_event = _append(writer, second.id, "thread.renamed")

        assert relay.poll_once() == 1
        assert broker.drain(token).events == (fast_event,)

        slow.execute("COMMIT")

    assert relay.poll_once() == 1
    assert [event.id for event in broker.drain(token).events] == [slow_event.id]
    assert relay.poll_once() == 0
    relay.close()


def test_relay_pages_a_backlog_after_its_rows_leave_the_window(
    tmp_path: Path,
) -> None:
    database, (thread,) = _database_with_threads(tmp_path, 1)
    broker = EventBroker()
    relay = DurableEventRelay(database, broker, batch_size=1)
    relay.start(background=False)
    token = broker.subscribe()
    writer = Database(database.path)
    appended = [_append(writer, thread.id, f"event.{index}") for index in range(3)]

    delivered: list[DomainEvent] = []
    for _ in range(3):
        assert relay.poll_once() == 1
        delivered.extend(broker.drain(token).events)
    assert delivered == appended
    assert relay.poll_once() == 0
    relay.close()


def test_relay_backs_off_when_idle_and_resets_on_activity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database = Database(tmp_path / "state.sqlite3")
    broker = EventBroker()
    relay = DurableEventRelay(database, broker, poll_interval=0.1)
    assert relay.idle_poll_interval == pytest.approx(1.6)

    # Per poll: rows observed by the poll, and whether this process published
    # an event while the relay slept before it.
    script = iter(
        [
            (0, False),
            (0, False),
            (0, False),
            (0, False),
            (0, False),
            (0, False),
            (2, False),  # another process wrote: back to fast
            (0, False),
            (0, True),  # a local publish: back to fast
            None,
        ]
    )
    sleeps: list[tuple[str, float]] = []

    def fake_poll() -> int:
        step = next(script)
        if step is None:
            relay._stop.set()
            return 0
        observed, local = step
        relay._last_observed = observed
        if local:
            other = DomainEvent(
                sequence=1, type="turn.started", thread_id="thr_local", payload={}
            )
            assert broker.publish(other)
        return observed

    def fast_wait(timeout: float | None = None) -> bool:
        sleeps.append(("fast", timeout or 0))
        return False

    def idle_wait(timeout: float | None = None) -> bool:
        sleeps.append(("idle", timeout or 0))
        return False

    monkeypatch.setattr(relay, "poll_once", fake_poll)
    monkeypatch.setattr(relay._stop, "wait", fast_wait)
    monkeypatch.setattr(relay._local_activity, "wait", idle_wait)
    thread = threading.Thread(target=relay._run)
    thread.start()
    thread.join(timeout=5)
    assert not thread.is_alive()

    delays = [round(delay, 3) for _, delay in sleeps]
    assert delays[:9] == [0.2, 0.4, 0.8, 1.6, 1.6, 1.6, 0.1, 0.2, 0.1]
    # Idle sleeps are the interruptible ones; fast sleeps only watch stop.
    assert [kind for kind, _ in sleeps[:9]] == [
        "idle",
        "idle",
        "idle",
        "idle",
        "idle",
        "idle",
        "fast",
        "idle",
        "fast",
    ]
    relay.close()


def test_local_publish_cuts_an_idle_relay_sleep_short(tmp_path: Path) -> None:
    database, (thread,) = _database_with_threads(tmp_path, 1)
    broker = EventBroker()
    relay = DurableEventRelay(
        database, broker, poll_interval=0.05, idle_poll_interval=30.0
    )
    relay.start()
    token = broker.subscribe()
    try:
        time.sleep(0.6)  # let the relay back off into a long idle sleep
        local = _append(database, thread.id, "turn.started")
        assert broker.publish(local)
        external = _append(Database(database.path), thread.id, "item.delta")
        assert broker.wait_for_events(token, timeout=1.0)
        deadline = time.monotonic() + 2.0
        seen: list[DomainEvent] = []
        while external not in seen and time.monotonic() < deadline:
            seen.extend(broker.drain(token).events)
            broker.wait_for_events(token, timeout=0.05)
        assert external in seen
    finally:
        relay.close()


def test_relay_rejects_invalid_idle_interval(tmp_path: Path) -> None:
    database = Database(tmp_path / "state.sqlite3")
    with pytest.raises(ValueError):
        DurableEventRelay(database, EventBroker(), idle_poll_interval=0)


# -- streaming projection --------------------------------------------------------


def _projector(tmp_path: Path) -> tuple[Database, TurnEventProjector, EventBroker]:
    database, (thread,) = _database_with_threads(tmp_path, 1)
    turn = Turn(thread_id=thread.id, ordinal=1, prompt="Stream")
    with database.transaction() as connection:
        TurnRepository(connection).add(turn)
    broker = EventBroker()
    projector = TurnEventProjector(
        database, broker, thread_id=thread.id, turn_id=turn.id
    )
    return database, projector, broker


def _event(message: object) -> Event:
    return Event(id="sub_test", msg=message)  # type: ignore[arg-type]


def test_stream_flush_skips_the_item_read_when_the_row_is_unchanged(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database, projector, broker = _projector(tmp_path)
    token = broker.subscribe()
    projector.project(_event(AgentMessageDelta(delta="Hel", message_id="m1")))
    reads: list[str] = []
    real_get = ItemRepository.get

    def counting_get(self: ItemRepository, item_id: str):  # noqa: ANN202
        reads.append(item_id)
        return real_get(self, item_id)

    monkeypatch.setattr(ItemRepository, "get", counting_get)
    projector._append_item_delta(
        projector._assistant_item_ids["m1"], delta="lo", summary="Hello"
    )
    assert reads == []

    item_id = projector._assistant_item_ids["m1"]
    with database.read() as connection:
        item = real_get(ItemRepository(connection), item_id)
    assert item is not None
    assert item.payload["text"] == "Hello"
    events = broker.drain(token).events
    assert [event.type for event in events] == ["item.created", "item.delta"]
    assert events[-1].payload["delta"] == "lo"
    assert set(events[-1].payload) == {"delta", "summary", "streaming", "updatedAt"}


def test_stream_flush_rereads_an_item_changed_by_another_writer(
    tmp_path: Path,
) -> None:
    database, projector, _ = _projector(tmp_path)
    projector.project(_event(AgentMessageDelta(delta="Hel", message_id="m1")))
    item_id = projector._assistant_item_ids["m1"]
    from dataclasses import replace

    from core.domain.common import utc_now

    with database.transaction() as connection:
        items = ItemRepository(connection)
        current = items.get(item_id)
        assert current is not None
        items.update(
            replace(
                current,
                payload={**current.payload, "note": "external"},
                updated_at=utc_now(),
            )
        )

    projector._append_item_delta(item_id, delta="lo", summary="Hello")
    with database.read() as connection:
        item = ItemRepository(connection).get(item_id)
    assert item is not None
    assert item.payload["text"] == "Hello"
    assert item.payload["note"] == "external"

    projector.project(
        _event(AgentMessageCompleted(text="Hello world", message_id="m1"))
    )
    with database.read() as connection:
        item = ItemRepository(connection).get(item_id)
    assert item is not None
    assert item.payload["text"] == "Hello world"
    assert item.payload["streaming"] is False


def test_stream_flush_of_a_deleted_item_is_a_no_op(tmp_path: Path) -> None:
    database, projector, _ = _projector(tmp_path)
    projector.project(_event(AgentMessageDelta(delta="Hel", message_id="m1")))
    item_id = projector._assistant_item_ids["m1"]
    with database.transaction() as connection:
        connection.execute("DELETE FROM items WHERE id = ?", (item_id,))
    assert projector._append_item_delta(item_id, delta="lo", summary="x") is None


# -- execution coordinator ---------------------------------------------------------


def test_idle_coordinator_skips_dispatch_transactions_but_sees_new_work(
    tmp_path: Path,
) -> None:
    database, (thread,) = _database_with_threads(tmp_path, 1)
    started: list[ExecutionDispatch] = []
    coordinator = ExecutionCoordinator(
        database,
        started.append,
        worker_id="worker_idle_probe",
        heartbeat_interval=0.02,
    )
    calls: list[float] = []
    real_dispatch = coordinator.dispatch_once

    def counting_dispatch(**kwargs: int) -> tuple[ExecutionDispatch, ...]:
        calls.append(time.monotonic())
        return real_dispatch(**kwargs)

    coordinator.dispatch_once = counting_dispatch  # type: ignore[method-assign]
    coordinator.start()
    try:
        time.sleep(0.3)
        # Only the first pass claims; idle passes probe without the lock.
        assert len(calls) == 1

        # Queued by another process: no offer() reaches this coordinator.
        turn = Turn(thread_id=thread.id, ordinal=1, prompt="Queued elsewhere")
        with database.transaction() as connection:
            TurnRepository(connection).add(turn)
        deadline = time.monotonic() + 3.0
        while not started and time.monotonic() < deadline:
            time.sleep(0.02)
        assert [dispatch.turn_id for dispatch in started] == [turn.id]
    finally:
        coordinator.quiesce()
