"""A user's worker role cannot reach other users' data, even with its own
credentials in hand and the session settings under its control."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest

from core.auth.provisioning import WorkerRoles, worker_role
from core.persistence.database import Database

NOW = "2026-10-09T00:00:00Z"


def _user(database: Database, username: str) -> str:
    with database.system().transaction() as connection:
        return str(
            connection.execute(
                "INSERT INTO users (username, display_name, password_hash, role, status) "
                "VALUES (?, ?, '!x', 'member', 'active') RETURNING id",
                (username, username),
            ).fetchone()[0]
        )


def _as_role(url: str, role: str, password: str) -> str:
    parts = urlsplit(url)
    host = parts.netloc.rsplit("@", 1)[-1]
    return urlunsplit(parts._replace(netloc=f"{role}:{password}@{host}"))


@pytest.fixture
def setup(tmp_path: Path):
    database = Database(tmp_path / "state")
    database.initialize()
    alice, bob = _user(database, "alice"), _user(database, "bob")
    for owner, project in ((alice, "p-alice"), (bob, "p-bob")):
        with database.for_user(owner).transaction() as connection:
            connection.execute(
                "INSERT INTO projects (id, canonical_path, display_name, trust_state, "
                "created_at, updated_at, last_opened_at) VALUES (?, ?, ?, 'trusted', ?, ?, ?)",
                (project, "/" + project, project, NOW, NOW, NOW),
            )
    roles = WorkerRoles(database)
    role, password = roles.issue(alice)
    yield database, roles, alice, bob, _as_role(database.url, role, password)
    roles.drop(alice)
    roles.drop(bob)


def _connect(url: str, schema: str) -> psycopg.Connection:
    connection = psycopg.connect(url, autocommit=True)
    connection.execute("SELECT set_config('search_path', %s, false)", (schema,))
    return connection


def test_worker_role_sees_only_its_user(setup) -> None:
    database, _roles, alice, bob, url = setup
    with _connect(url, database.schema) as connection:
        assert [r[0] for r in connection.execute("SELECT id FROM projects")] == ["p-alice"]
        # Session settings cannot switch tenant or reach system scope.
        connection.execute("SELECT set_config('app.user_id', %s, false)", (bob,))
        connection.execute("SELECT set_config('app.system', 'on', false)")
        assert [r[0] for r in connection.execute("SELECT id FROM projects")] == ["p-alice"]
        assert connection.execute(
            "UPDATE projects SET display_name = 'x' WHERE id = 'p-bob'"
        ).rowcount == 0


def test_worker_role_cannot_read_accounts_or_escalate(setup) -> None:
    database, _roles, alice, _bob, url = setup
    with _connect(url, database.schema) as connection:
        rows = connection.execute("SELECT username FROM users").fetchall()
        assert rows == [("alice",)]
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("SELECT password_hash FROM users")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("UPDATE users SET role = 'admin'")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("CREATE ROLE intruder")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("CREATE TABLE stash (x int)")


def test_worker_role_cannot_write_into_another_user(setup) -> None:
    database, _roles, alice, bob, url = setup
    with _connect(url, database.schema) as connection:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(
                "INSERT INTO projects (id, user_id, canonical_path, display_name, "
                "trust_state, created_at, updated_at, last_opened_at) "
                "VALUES ('forged', %s, '/f', 'f', 'trusted', 'n', 'n', 'n')",
                (bob,),
            )


def test_worker_database_runs_the_application_as_its_user(
    setup, monkeypatch: pytest.MonkeyPatch
) -> None:
    database, _roles, alice, _bob, url = setup
    monkeypatch.setenv("KHAI_USER_ID", alice)
    worker = Database(database.path, url=url)
    worker.initialize()  # up to date: never attempts DDL
    with worker.read() as connection:
        assert [r[0] for r in connection.execute("SELECT id FROM projects")] == ["p-alice"]


def test_locked_role_cannot_sign_in(setup) -> None:
    database, roles, alice, _bob, url = setup
    roles.lock(alice)
    with pytest.raises(psycopg.OperationalError):
        psycopg.connect(url).close()
    role, password = roles.issue(alice)
    assert role == worker_role(alice)
    psycopg.connect(_as_role(database.url, role, password)).close()
