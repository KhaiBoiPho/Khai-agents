"""/api/preview-pdf: cached LibreOffice PDF renditions for the Files panel."""

from __future__ import annotations

import asyncio
import os

from core.documents import convert
from core.domain import TrustState
from tests.app_server.support import control_server
from tests.app_server.test_web_surface import browser_headers


def test_preview_pdf_caches_by_mtime_and_falls_back(tmp_path, monkeypatch):
    conversions: list[str] = []

    async def fake_export(src, out, **_):
        conversions.append(src.name)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"%PDF-1.7 " + src.read_bytes())
        return out

    available = {"value": True}
    monkeypatch.setattr(convert, "export_pdf", fake_export)
    monkeypatch.setattr(convert, "converter_available", lambda: available["value"])

    async def scenario():
        async with control_server(tmp_path) as (control, client):
            app = control.host.application
            workspace = tmp_path / "workspace"
            workspace.mkdir()
            project = app.projects.add(str(workspace), trust_state=TrustState.TRUSTED)
            thread = app.threads.start(project.id, title="Preview")
            deck = workspace / "deck.pptx"
            deck.write_bytes(b"v1")
            url = f"/api/preview-pdf?threadId={thread.id}&path=deck.pptx"
            # Before sign-in (the test client keeps the session cookie after).
            assert (await client.get(url)).status == 401
            headers = await browser_headers(control, client)
            first = await client.get(url, headers=headers)
            assert first.status == 200
            assert first.headers["Content-Type"] == "application/pdf"
            assert await first.read() == b"%PDF-1.7 v1"
            assert (await client.get(url, headers=headers)).status == 200
            assert conversions == ["deck.pptx"]  # served from the cache
            deck.write_bytes(b"v2-changed")
            os.utime(deck, ns=(1, 2_000_000_000))
            again = await client.get(url, headers=headers)
            assert await again.read() == b"%PDF-1.7 v2-changed"
            assert conversions == ["deck.pptx", "deck.pptx"]
            cached = list((workspace / ".deepcode" / "preview-cache").glob("*.pdf"))
            assert len(cached) == 2
            (workspace / "notes.txt").write_text("x")
            assert (
                await client.get(
                    f"/api/preview-pdf?threadId={thread.id}&path=notes.txt", headers=headers
                )
            ).status == 400
            assert (
                await client.get(
                    f"/api/preview-pdf?threadId={thread.id}&path=../deck.pptx",
                    headers=headers,
                )
            ).status == 403
            available["value"] = False
            missing = await client.get(url, headers=headers)
            assert missing.status == 404 and await missing.text() == "converter_unavailable"

    asyncio.run(asyncio.wait_for(scenario(), 20))
