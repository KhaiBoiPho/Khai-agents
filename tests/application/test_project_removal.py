"""Removing a project removes its chats, so reconciliation cannot revive it."""

from __future__ import annotations

from pathlib import Path

from core.application import DeepCodeApplication
from core.domain import TrustState


def test_removed_project_stays_removed_after_reload(tmp_path: Path) -> None:
    workspace = tmp_path / "demo"
    workspace.mkdir()
    application = DeepCodeApplication.open(tmp_path / "state.sqlite3")
    try:
        project = application.projects.add(str(workspace), trust_state=TrustState.TRUSTED)
        thread = application.threads.start(project.id, title="A chat")
        application.threads.materialize_session(thread.id)

        assert application.remove_project(project.id) is True

        # A page load lists threads and projects, reconciling Sessions.
        application.threads.reconcile()
        assert application.threads.list(include_archived=True) == []
        assert [p.canonical_path for p in application.projects.list()] == []
        assert application.session_store.get_session(thread.id) is None
    finally:
        application.close()
