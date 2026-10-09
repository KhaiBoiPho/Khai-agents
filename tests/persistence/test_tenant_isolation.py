"""Row-level security: one user's Database never sees or touches another's rows."""

from __future__ import annotations

from pathlib import Path

import pytest

from core.domain import Project, Thread, ThreadMode
from core.persistence import Database, ProjectRepository, ThreadRepository
from core.persistence.errors import DatabaseError, UserScopeError


def _user(database: Database, username: str, *, role: str = "member") -> str:
    with database.system().transaction() as connection:
        row = connection.execute(
            "INSERT INTO users (username, display_name, password_hash, role, status) "
            "VALUES (?, ?, '!test', ?, 'active') RETURNING id",
            (username, username.title(), role),
        ).fetchone()
    return str(row[0])


@pytest.fixture
def two_users(tmp_path: Path) -> tuple[Database, Database]:
    base = Database(tmp_path / "state")
    base.initialize()
    alice = base.for_user(_user(base, "alice"))
    bob = base.for_user(_user(base, "bob"))
    return alice, bob


def _add_project(database: Database, path: str) -> Project:
    project = Project(canonical_path=path, display_name=path)
    with database.transaction() as connection:
        ProjectRepository(connection).add(project)
    return project


def test_each_user_sees_only_their_own_rows(two_users) -> None:
    alice, bob = two_users
    alice_project = _add_project(alice, "/work")
    bob_project = _add_project(bob, "/work")  # same path: unique per user only

    with alice.read() as connection:
        assert [p.id for p in ProjectRepository(connection).list()] == [alice_project.id]
        assert ProjectRepository(connection).get(bob_project.id) is None
    with bob.read() as connection:
        assert [p.id for p in ProjectRepository(connection).list()] == [bob_project.id]


def test_a_user_cannot_change_or_delete_another_users_rows(two_users) -> None:
    alice, bob = two_users
    project = _add_project(alice, "/alice")

    with bob.transaction() as connection:
        assert (
            connection.execute(
                "UPDATE projects SET display_name = 'taken' WHERE id = ?", (project.id,)
            ).rowcount
            == 0
        )
        assert connection.execute(
            "DELETE FROM projects WHERE id = ?", (project.id,)
        ).rowcount == 0
    with alice.read() as connection:
        assert ProjectRepository(connection).get(project.id).display_name == "/alice"


def test_a_user_cannot_write_rows_owned_by_someone_else(two_users) -> None:
    alice, bob = two_users
    with pytest.raises(DatabaseError):
        with bob.transaction() as connection:
            connection.execute(
                "INSERT INTO projects (id, user_id, canonical_path, display_name, "
                "trust_state, created_at, updated_at, last_opened_at) "
                "VALUES ('proj_forged', ?, '/x', 'x', 'trusted', 'now', 'now', 'now')",
                (alice.user_id,),
            )
    bob_project = _add_project(bob, "/bob")
    # RLS's WITH CHECK rejects handing a row to another owner.
    with pytest.raises(DatabaseError):
        with bob.transaction() as connection:
            connection.execute(
                "UPDATE projects SET user_id = ? WHERE id = ?",
                (alice.user_id, bob_project.id),
            )


def test_child_rows_follow_the_same_owner(two_users) -> None:
    alice, bob = two_users
    project = _add_project(alice, "/alice")
    thread = Thread(
        project_id=project.id,
        title="Private",
        mode=ThreadMode.CODE,
        workspace_path="/alice",
    )
    with alice.transaction() as connection:
        ThreadRepository(connection).add(thread)
    with bob.read() as connection:
        assert ThreadRepository(connection).get(thread.id) is None
    # Bob cannot hang a thread off Alice's project: the project is invisible
    # to him, so the foreign key has nothing to point at.
    with pytest.raises(DatabaseError):
        with bob.transaction() as connection:
            ThreadRepository(connection).add(
                Thread(
                    project_id=project.id,
                    title="Intruder",
                    mode=ThreadMode.CODE,
                    workspace_path="/alice",
                )
            )


def test_users_see_only_their_own_account(two_users) -> None:
    alice, _bob = two_users
    with alice.read() as connection:
        names = [row["username"] for row in connection.execute("SELECT username FROM users")]
    assert names == ["alice"]
    # Only system scope (the administration service) may change accounts.
    with pytest.raises(DatabaseError):
        with alice.transaction() as connection:
            connection.execute("UPDATE users SET role = 'admin' WHERE username = 'alice'")


def test_system_scope_sees_every_user(two_users) -> None:
    alice, bob = two_users
    _add_project(alice, "/a")
    _add_project(bob, "/b")
    with alice.system().read() as connection:
        assert connection.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 2


def test_multi_user_mode_refuses_an_unbound_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database = Database(tmp_path / "state")
    database.initialize()
    monkeypatch.setenv("KHAI_MULTI_USER", "1")
    with pytest.raises(UserScopeError):
        with database.read():
            pass


def test_an_unbound_database_uses_the_primary_administrator(tmp_path: Path) -> None:
    database = Database(tmp_path / "state")
    database.initialize()
    with database.read() as connection:
        row = connection.execute(
            "SELECT username, role, status FROM users WHERE id = ?", (database.user_id,)
        ).fetchone()
    assert (row["username"], row["role"], row["status"]) == ("owner", "admin", "active")
    # The generated administrator cannot sign in until a password is set.
    with database.system().read() as connection:
        hashed = connection.execute(
            "SELECT password_hash FROM users WHERE id = ?", (database.user_id,)
        ).fetchone()[0]
    assert hashed.startswith("!")
