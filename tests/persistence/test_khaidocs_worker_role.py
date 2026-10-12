"""KhaiDocs under a user's worker role (what the agent tools really run as):
the 0007 grants suffice and row-level security shows only that user's pages."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from core.auth.provisioning import WorkerRoles
from core.harness.tools import khaidocs as tools
from core.khaidocs import KhaiDocsStore
from core.persistence.database import Database
from tests.persistence.test_worker_roles import _as_role, _user


@pytest.fixture
def worker(tmp_path: Path):
    database = Database(tmp_path / "state")
    database.initialize()
    alice, bob = _user(database, "alice"), _user(database, "bob")
    roles = WorkerRoles(database)
    role, password = roles.issue(alice)
    url = _as_role(database.url, role, password)
    mine = Database(tmp_path / "state", user_id=alice, url=url)
    yield KhaiDocsStore(mine), KhaiDocsStore(database.for_user(bob)), database
    roles.drop(alice)


def run(tool, **kw):
    return asyncio.run(tool.execute(**kw))


def test_agent_tools_work_under_the_worker_role(worker) -> None:
    mine, bobs, _database = worker
    read, write = tools.KhaiDocsReadTool(lambda: mine), tools.KhaiDocsWriteTool(lambda: mine)
    made = run(write, action="create", title="Từ worker", markdown="## Mục\n\nnội dung")
    assert made.startswith("Created"), made
    ref = made.split("[", 1)[1].split("]", 1)[0]
    assert run(write, action="append", page=ref, markdown="thêm").startswith("Appended")
    assert "thêm" in run(read, action="read", page=ref)
    assert "Từ worker" in run(read, action="search", query="noi dung")
    assert run(write, action="trash", page=ref).startswith("Moved")
    assert "Từ worker" in run(read, action="trash")
    assert run(write, action="restore", page=ref).startswith("Restored")
    # Bob (gateway-side, his own binding) sees none of it, and vice versa.
    bobs.create_page(title="Của Bob")
    assert bobs.search("worker") == []
    assert [p["title"] for p in mine.all_pages()] == ["Từ worker"]
