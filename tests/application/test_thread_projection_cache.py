"""Listing and opening Threads only re-project Sessions whose files changed."""

from pathlib import Path
from unittest.mock import patch

from core.application import DeepCodeApplication
from core.domain import TrustState
from core.persistence.execution_repository import ItemRepository
from core.sessions.store import SessionStore


def _open(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    application = DeepCodeApplication.open(tmp_path / "state.sqlite3")
    project = application.projects.add(str(workspace), trust_state=TrustState.TRUSTED)
    return application, project, workspace


def _conversation(application, thread_id: str) -> list[str]:
    with application.database.read() as connection:
        items = ItemRepository(connection).conversation_for_thread(thread_id)
    return [str(item.payload.get("text", item.summary)) for item in items]


def test_list_skips_reconcile_when_nothing_changed(tmp_path: Path) -> None:
    application, project, _workspace = _open(tmp_path)
    thread = application.threads.start(project.id, title="Cached")
    application.threads.list(project.id)

    service = application.threads
    with (
        patch.object(
            service, "_ensure_projection", wraps=service._ensure_projection
        ) as projected,
        patch.object(
            application.session_store,
            "_list_sessions_scan",
            wraps=application.session_store._list_sessions_scan,
        ) as scanned,
    ):
        assert service.list(project.id) == [thread]
        assert service.list(project.id) == [thread]
        service.reconcile_if_changed()

    assert projected.call_count == 0
    assert scanned.call_count == 0


def test_list_picks_up_sessions_written_by_another_process(tmp_path: Path) -> None:
    application, project, workspace = _open(tmp_path)
    existing = application.threads.start(project.id, title="Existing")
    application.threads.list(project.id)

    # A second store instance stands in for the CLI writing the same root.
    other = SessionStore(application.session_store.root)
    created = other.create_session(
        title="From the CLI",
        metadata={"workspace": str(workspace), "kind": "desktop"},
    )
    listed = application.threads.list(project.id)
    assert {thread.id for thread in listed} == {existing.id, created.session_id}

    other.append_message(existing.id, "user", "written elsewhere")
    other.append_message(existing.id, "assistant", "seen")
    service = application.threads
    with patch.object(
        service, "_ensure_projection", wraps=service._ensure_projection
    ) as projected:
        service.list(project.id)
    # Only the Session whose file moved is projected again.
    assert [call.args[0].session_id for call in projected.call_args_list] == [
        existing.id
    ]
    assert _conversation(application, existing.id) == ["written elsewhere", "seen"]

    assert other.delete_session(created.session_id)
    assert [thread.id for thread in service.list(project.id)] == [existing.id]


def test_list_reconciles_fully_after_project_changes(tmp_path: Path) -> None:
    application, project, workspace = _open(tmp_path)
    application.threads.start(project.id, title="Thread")
    application.threads.list(project.id)

    nested = workspace / "nested"
    nested.mkdir()
    service = application.threads
    application.projects.add(str(nested))
    with patch.object(service, "reconcile", wraps=service.reconcile) as reconciled:
        service.list()
        service.list()
    assert reconciled.call_count == 1


def test_read_and_resume_skip_projection_until_the_session_changes(
    tmp_path: Path,
) -> None:
    application, project, _workspace = _open(tmp_path)
    thread = application.threads.start(project.id, title="Open me")
    service = application.threads
    service.read(thread.id)

    with patch.object(
        service, "_ensure_projection", wraps=service._ensure_projection
    ) as projected:
        assert service.read(thread.id) == thread
        assert service.resume(thread.id) == thread
        assert projected.call_count == 0

        SessionStore(application.session_store.root).append_message(
            thread.id, "user", "new prompt"
        )
        service.read(thread.id)
        assert projected.call_count == 1
        service.read(thread.id)
        assert projected.call_count == 1

    assert _conversation(application, thread.id) == ["new prompt"]
    # Mutations through the service still project and publish immediately.
    assert service.rename(thread.id, "Renamed").title == "Renamed"
    assert service.read(thread.id).title == "Renamed"


def test_read_reprojects_when_the_thread_row_is_missing(tmp_path: Path) -> None:
    application, project, _workspace = _open(tmp_path)
    thread = application.threads.start(project.id, title="Dropped row")
    application.threads.read(thread.id)

    with application.database.transaction() as connection:
        connection.execute("DELETE FROM threads WHERE id = ?", (thread.id,))

    assert application.threads.read(thread.id).id == thread.id
