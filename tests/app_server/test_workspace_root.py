from __future__ import annotations

import asyncio
from urllib.parse import quote

import aiohttp

import pytest

from app_server.workspace_root import relative_path
from tests.app_server.support import control_server
from tests.app_server.test_web_surface import browser_headers


@pytest.mark.parametrize(
    "raw", ["", "/etc/passwd", "../x", "a/../b", "a//b", "./a", "a\\b", "a\x00"]
)
def test_relative_path_rejects_escapes(raw):
    with pytest.raises(ValueError):
        relative_path(raw)


def test_relative_path_accepts_nested_files():
    assert str(relative_path("app/src/main.py")) == "app/src/main.py"


def test_workspace_upload_and_confinement(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    monkeypatch.setenv("KHAI_WORKSPACE_ROOT", str(root))

    async def scenario():
        async with control_server(tmp_path) as (control, client):
            headers = await browser_headers(control, client)

            def form(files):
                data = aiohttp.FormData()
                for path, body in files.items():
                    data.add_field(quote(path, safe=""), body, filename="file")
                return data

            async def upload(files):
                return await client.post(
                    "/api/workspace/upload", headers=headers, data=form(files)
                )

            response = await upload({"app/src/main.py": b"print(1)", "app/README.md": b"hi"})
            assert response.status == 200
            assert (await response.json())["files"] == ["app/src/main.py", "app/README.md"]
            assert (root / "app/src/main.py").read_bytes() == b"print(1)"
            assert (await upload({"../escape.txt": b"x"})).status == 400
            outside = tmp_path / "outside"
            outside.mkdir()
            (root / "link").symlink_to(outside)
            assert (await upload({"link/x.txt": b"x"})).status == 403
            assert not (outside / "x.txt").exists()
            assert not list(root.rglob("*.part"))

    asyncio.run(scenario())


def test_directory_list_stays_in_workspace(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    (root / "project").mkdir(parents=True)
    monkeypatch.setenv("KHAI_WORKSPACE_ROOT", str(root))
    from app_server.dispatcher import Dispatcher
    from core.application.errors import InvalidArgumentError

    listing = Dispatcher._directory_list

    class Params:
        def __init__(self, path=""):
            self.path = path

        def only(self, *names):
            return None

        def string(self, name, **kwargs):
            return self.path

    result = listing(None, Params())
    assert result["path"] == str(root.resolve())
    assert result["parent"] is None
    assert result["workspaceRoot"] == str(root.resolve())
    assert [entry["name"] for entry in result["entries"]] == ["project"]
    with pytest.raises(InvalidArgumentError):
        listing(None, Params(str(tmp_path)))
