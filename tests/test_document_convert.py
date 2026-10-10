"""core.documents.convert + the document_export tool, with subprocesses stubbed."""

from __future__ import annotations

import asyncio
import base64
import shutil
import tempfile
from pathlib import Path

import pytest
from pypdf import PdfWriter

from core.documents import convert
from core.harness.tools.document_export import DocumentExportTool


def _pdf(path: Path, pages: int) -> Path:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=100)
    with path.open("wb") as handle:
        writer.write(handle)
    return path


@pytest.fixture
def env(tmp_path, monkeypatch):
    """Fake binaries + a private temp dir so leftover temp files are visible."""
    temp = tmp_path / "tmp"
    temp.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(temp))
    monkeypatch.setattr(convert, "soffice_binary", lambda: "/usr/bin/soffice")
    monkeypatch.setattr(convert, "pdftoppm_binary", lambda: "/usr/bin/pdftoppm")
    monkeypatch.setattr(convert, "_genoffice_binary", lambda: None)
    monkeypatch.setattr(convert.shutil, "which", lambda name, *a, **k: None)
    calls: list[list[str]] = []

    async def fake_run(argv, *, timeout, env=None, cwd=None):
        calls.append(list(argv))
        name = Path(argv[0]).name
        if name == "soffice":
            src = Path(argv[-1])
            outdir = Path(argv[argv.index("--outdir") + 1])
            _pdf(outdir / f"{src.stem}.pdf", 5)
        elif name == "pdftoppm":
            Path(argv[-1] + ".png").write_bytes(b"\x89PNG fake")
        elif name == "genoffice":
            Path(argv[argv.index("--out") + 1]).write_bytes(b"PK docx")
        return 0, ""

    monkeypatch.setattr(convert, "_run", fake_run)
    workspace = tmp_path / "ws"
    workspace.mkdir()
    return workspace, temp, calls


def test_export_pdf_uses_private_profile_and_cleans_up(env):
    workspace, temp, calls = env
    src = workspace / "-odd name.docx"
    src.write_bytes(b"PK")
    out = asyncio.run(convert.export_pdf(src, workspace / "out" / "r.pdf"))
    assert out.is_file() and convert.pdf_page_count(out) == 5
    argv = calls[0]
    assert any(a.startswith("-env:UserInstallation=file://") and str(temp) in a for a in argv)
    assert "--headless" in argv and argv[-1].endswith("input.docx")
    assert list(temp.iterdir()) == []


def test_export_pdf_html_and_markdown_fallback(env):
    workspace, _, calls = env
    (workspace / "a.html").write_text("<p>xin chào</p>")
    (workspace / "b.md").write_text("# Tiêu đề\n\n| a | b |\n|---|---|\n| 1 | 2 |\n")
    asyncio.run(convert.export_pdf(workspace / "a.html", workspace / "a.pdf"))
    asyncio.run(convert.export_pdf(workspace / "b.md", workspace / "b.pdf"))
    assert "--infilter=HTML (StarWriter)" in calls[0]
    # No GenOffice / pandoc: markdown goes through a generated HTML page.
    assert calls[1][-1].endswith("doc.html") and "--infilter=HTML (StarWriter)" in calls[1]


def test_markdown_prefers_genoffice(env, monkeypatch):
    workspace, _, calls = env
    monkeypatch.setattr(convert, "_genoffice_binary", lambda: "/app/tools/genoffice/genoffice")
    (workspace / "b.md").write_text("# x")
    asyncio.run(convert.export_pdf(workspace / "b.md", workspace / "b.pdf"))
    assert Path(calls[0][0]).name == "genoffice" and calls[0][1:4] == ["convert", calls[0][2], "--to"]
    assert calls[1][-1].endswith("doc.docx")


def test_errors_are_typed(env, monkeypatch):
    workspace, temp, _ = env
    src = workspace / "a.pptx"
    src.write_bytes(b"PK")
    with pytest.raises(convert.ConverterError) as bad:
        asyncio.run(convert.export_pdf(workspace / "a.exe", workspace / "a.pdf"))
    assert bad.value.code in {"not_found", "unsupported"}
    with pytest.raises(convert.ConverterError) as bad_out:
        asyncio.run(convert.export_pdf(src, workspace / "a.png"))
    assert bad_out.value.code == "bad_output"

    async def failing(argv, **_):
        return 77, "Error: source file could not be loaded"

    monkeypatch.setattr(convert, "_run", failing)
    with pytest.raises(convert.ConverterError) as failed:
        asyncio.run(convert.export_pdf(src, workspace / "a.pdf"))
    assert failed.value.code == "conversion_failed" and "exit 77" in str(failed.value)
    assert list(temp.iterdir()) == []
    monkeypatch.setattr(convert, "soffice_binary", lambda: None)
    with pytest.raises(convert.ConverterUnavailable) as missing:
        asyncio.run(convert.export_pdf(src, workspace / "a.pdf"))
    assert missing.value.code == "converter_unavailable"


def test_concurrency_is_limited(env, monkeypatch):
    workspace, _, _ = env
    src = workspace / "a.docx"
    src.write_bytes(b"PK")
    active = peak = 0

    async def slow(argv, **_):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.02)
        outdir = Path(argv[argv.index("--outdir") + 1])
        _pdf(outdir / f"{Path(argv[-1]).stem}.pdf", 1)
        active -= 1
        return 0, ""

    monkeypatch.setattr(convert, "_run", slow)
    monkeypatch.setenv(convert.CONCURRENCY_ENV, "1")

    async def many():
        await asyncio.gather(
            *(convert.export_pdf(src, workspace / f"o{i}.pdf") for i in range(4))
        )

    asyncio.run(many())
    assert peak == 1


@pytest.mark.skipif(shutil.which("sleep") is None, reason="needs sleep(1)")
def test_real_run_times_out_and_kills():
    with pytest.raises(convert.ConverterError) as timed_out:
        asyncio.run(convert._run(["sleep", "5"], timeout=0.2))
    assert timed_out.value.code == "timeout"


@pytest.mark.skipif(shutil.which("sh") is None, reason="needs sh")
def test_real_run_does_not_wait_for_lingering_children():
    import time

    started = time.monotonic()
    code, output = asyncio.run(convert._run(["sh", "-c", "sleep 30 & echo done"], timeout=10))
    assert code == 0 and "done" in output
    assert time.monotonic() - started < 5


def test_default_pages():
    assert convert.default_pages(1) == [1]
    assert convert.default_pages(2) == [1, 2]
    assert convert.default_pages(9) == [1, 5, 9]
    assert convert.default_pages(0) == []


def test_render_pages_selects_and_skips(env):
    workspace, temp, calls = env
    src = workspace / "deck.pptx"
    src.write_bytes(b"PK")
    result = asyncio.run(
        convert.render_pages(src, workspace / "png", pages=[2, 9, 2], width_px=5000)
    )
    assert result.pages == [2] and result.skipped == [9] and result.page_count == 5
    assert [p.name for p in result.images] == ["deck-p2.png"]
    render = calls[-1]
    assert render[render.index("-scale-to-x") + 1] == str(convert.MAX_RENDER_WIDTH)
    assert result.pdf is None and list(temp.iterdir()) == []
    default = asyncio.run(convert.render_pages(src, workspace / "png"))
    assert default.pages == [1, 3, 5]


def test_tool_preview_pdf_and_confinement(env):
    workspace, _, _ = env
    (workspace / "deck.pptx").write_bytes(b"PK")
    tool = DocumentExportTool(str(workspace))
    preview = asyncio.run(tool.execute(action="preview", path="deck.pptx", pages=[1, 2]))
    assert not getattr(preview, "is_error", False)
    assert "Rendered page(s) 1, 2 of 5" in preview and ".deepcode/previews/deck-p1.png" in preview
    assert len(preview) < 200  # short text: paths + one line
    images = preview.metadata["images"]
    assert [i["mimeType"] for i in images] == ["image/png", "image/png"]
    assert base64.b64decode(images[0]["data"]) == b"\x89PNG fake"
    exported = asyncio.run(tool.execute(action="pdf", path="deck.pptx"))
    assert exported.startswith("Exported deck.pdf (5 pages")
    assert (workspace / "deck.pdf").is_file()
    for bad in ({"path": "../x.docx"}, {"path": "deck.pptx", "out": "/etc/x.pdf"}):
        result = asyncio.run(tool.execute(action="pdf", **bad))
        assert result.is_error and "inside the workspace" in result


def test_tool_reports_unavailable(env, monkeypatch):
    workspace, _, _ = env
    (workspace / "a.docx").write_bytes(b"PK")
    monkeypatch.setattr(convert, "soffice_binary", lambda: None)
    result = asyncio.run(DocumentExportTool(str(workspace)).execute(action="pdf", path="a.docx"))
    assert result.is_error and result.metadata["errorCode"] == "converter_unavailable"


def test_registered_only_with_a_converter(tmp_path, monkeypatch):
    from core.harness.tools import default_coding_tools

    monkeypatch.setattr(convert, "soffice_binary", lambda: None)
    assert "document_export" not in set(default_coding_tools(str(tmp_path)).tool_names)
    monkeypatch.setattr(convert, "soffice_binary", lambda: "/usr/bin/soffice")
    assert "document_export" in set(default_coding_tools(str(tmp_path)).tool_names)


@pytest.mark.skipif(convert.soffice_binary() is None, reason="LibreOffice not installed")
def test_integration_real_libreoffice(tmp_path):
    src = tmp_path / "page.html"
    src.write_text('<html><meta charset="utf-8"><body><h1>Xin chào Việt Nam</h1></body></html>')
    out = asyncio.run(convert.export_pdf(src, tmp_path / "page.pdf"))
    assert convert.pdf_page_count(out) >= 1
    if convert.pdftoppm_binary():
        result = asyncio.run(convert.render_pages(out, tmp_path / "png", pages=[1]))
        assert result.images[0].read_bytes()[:4] == b"\x89PNG"
