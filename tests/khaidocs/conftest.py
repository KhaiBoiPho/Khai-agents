from __future__ import annotations

from pathlib import Path

import pytest

from core.khaidocs import KhaiDocsStore
from core.persistence import Database


def make_user(database: Database, username: str) -> str:
    with database.system().transaction() as connection:
        row = connection.execute(
            "INSERT INTO users (username, display_name, password_hash, role, status) "
            "VALUES (?, ?, '!test', 'member', 'active') RETURNING id",
            (username, username.title()),
        ).fetchone()
    return str(row[0])


@pytest.fixture
def base(tmp_path: Path) -> Database:
    database = Database(tmp_path / "state")
    database.initialize()
    return database


@pytest.fixture
def two_stores(base: Database) -> tuple[KhaiDocsStore, KhaiDocsStore]:
    alice = KhaiDocsStore(base.for_user(make_user(base, "alice")))
    bob = KhaiDocsStore(base.for_user(make_user(base, "bob")))
    return alice, bob


@pytest.fixture
def store(two_stores) -> KhaiDocsStore:
    return two_stores[0]
