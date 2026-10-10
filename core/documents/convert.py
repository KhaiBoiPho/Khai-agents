"""PDF export and page rendering with headless LibreOffice + poppler.

``export_pdf`` turns docx/xlsx/pptx/odt/html/md (and their legacy siblings)
into a PDF; ``render_pages`` rasterizes chosen pages of a document to PNG.
Everything runs as short-lived subprocesses so a hung or crashing office
process can never take the agent down:

* every soffice call gets a fresh, throwaway profile under the OS temp dir
  (works as an unprivileged user on a read-only root filesystem),
* a wall-clock timeout kills the whole process group (no stray soffice.bin),
* a per-process semaphore limits simultaneous soffice runs (memory bound),
* temp dirs are always removed.

Missing binaries raise :class:`ConverterUnavailable` (code
``converter_unavailable``); other failures raise :class:`ConverterError`
with a short, model-readable message.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import signal
import subprocess
import tempfile
import weakref
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

SOFFICE_BIN_ENV = "KHAI_SOFFICE_BIN"
CONCURRENCY_ENV = "KHAI_DOC_CONVERT_CONCURRENCY"
DEFAULT_TIMEOUT_S = 60.0
#: How long a call may queue behind running conversions before giving up.
QUEUE_TIMEOUT_S = 120.0
MAX_SOURCE_BYTES = 100 * 1024 * 1024
MAX_RENDER_WIDTH = 2048
MIN_RENDER_WIDTH = 200

OFFICE_SUFFIXES = frozenset(
    {
        ".docx", ".doc", ".odt", ".rtf", ".txt",
        ".xlsx", ".xlsm", ".xls", ".ods", ".csv",
        ".pptx", ".ppt", ".odp",
    }
)
HTML_SUFFIXES = frozenset({".html", ".htm"})
MARKDOWN_SUFFIXES = frozenset({".md", ".markdown"})
SUPPORTED_SUFFIXES = OFFICE_SUFFIXES | HTML_SUFFIXES | MARKDOWN_SUFFIXES | {".pdf"}


class ConverterError(RuntimeError):
    """A conversion failed; ``code`` is a stable machine-readable tag."""

    code = "conversion_failed"

    def __init__(self, message: str, *, code: str | None = None):
        super().__init__(message)
        if code:
            self.code = code


class ConverterUnavailable(ConverterError):
    code = "converter_unavailable"


@dataclass(frozen=True)
class RenderResult:
    pdf: Path | None  # None when the PDF was a temp file (already removed)
    page_count: int
    pages: list[int]
    images: list[Path] = field(default_factory=list)
    skipped: list[int] = field(default_factory=list)


# ------------------------------------------------------------------ binaries


def soffice_binary() -> str | None:
    explicit = os.environ.get(SOFFICE_BIN_ENV, "").strip()
    if explicit:
        return shutil.which(explicit) or (explicit if os.access(explicit, os.X_OK) else None)
    for name in ("soffice", "libreoffice"):
        found = shutil.which(name)
        if found:
            return found
    mac = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
    return mac if os.access(mac, os.X_OK) else None


def pdftoppm_binary() -> str | None:
    return shutil.which("pdftoppm")


def converter_available() -> bool:
    """True when PDF export (soffice) is possible on this machine."""
    return soffice_binary() is not None


def _genoffice_binary() -> str | None:
    try:
        from core.mcp.genoffice import resolve_genoffice_binary

        found = resolve_genoffice_binary()
    except Exception:  # pragma: no cover - optional dependency
        return None
    return str(found) if found else None


# --------------------------------------------------------------- subprocess

_semaphores: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = (
    weakref.WeakKeyDictionary()
)


def _concurrency() -> int:
    try:
        return max(1, min(4, int(os.environ.get(CONCURRENCY_ENV, "1"))))
    except ValueError:
        return 1


def _office_semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    sem = _semaphores.get(loop)
    if sem is None:
        sem = asyncio.Semaphore(_concurrency())
        _semaphores[loop] = sem
    return sem


def _kill_group(proc: subprocess.Popen) -> None:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except (ProcessLookupError, OSError):
            pass


def _run_blocking(
    argv: Sequence[str],
    timeout: float,
    env: dict[str, str] | None,
    cwd: str | None,
    started: list[subprocess.Popen],
) -> tuple[int, str]:
    # Output goes to a file, not a pipe: a lingering grandchild holding a
    # pipe open can never stall us, and Popen.wait() reaps exactly our pid
    # without depending on an event loop's child watcher.
    with tempfile.TemporaryFile() as log:
        proc = subprocess.Popen(
            list(argv),
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            env=env,
            cwd=cwd,
            start_new_session=True,
        )
        started.append(proc)
        try:
            code = proc.wait(timeout)
        except subprocess.TimeoutExpired:
            _kill_group(proc)
            try:
                proc.wait(5)
            except subprocess.TimeoutExpired:
                pass
            raise ConverterError(
                f"{Path(argv[0]).name} timed out after {timeout:.0f}s", code="timeout"
            ) from None
        finally:
            # soffice may leave a child behind even after a clean exit.
            _kill_group(proc)
        size = log.seek(0, os.SEEK_END)
        log.seek(max(0, size - 800))
        return code, log.read().decode("utf-8", "replace")


async def _run(
    argv: Sequence[str],
    *,
    timeout: float,
    env: dict[str, str] | None = None,
    cwd: str | None = None,
) -> tuple[int, str]:
    """Run ``argv``; return (exit code, output tail).

    On timeout the whole process group is killed and ConverterError raised;
    a cancelled caller kills it too. Tests replace this function.
    """
    started: list[subprocess.Popen] = []
    try:
        return await asyncio.to_thread(_run_blocking, argv, timeout, env, cwd, started)
    except asyncio.CancelledError:
        for proc in started:
            _kill_group(proc)
        raise


# ------------------------------------------------------------------ export


def _check_source(src: Path) -> Path:
    src = Path(src)
    if not src.is_file():
        raise ConverterError(f"not a file: {src}", code="not_found")
    if src.suffix.lower() not in SUPPORTED_SUFFIXES:
        raise ConverterError(
            f"unsupported file type {src.suffix or '(none)'}", code="unsupported"
        )
    if src.stat().st_size > MAX_SOURCE_BYTES:
        raise ConverterError("file too large to convert (limit 100 MB)", code="too_large")
    return src


async def _markdown_to_intermediate(src: Path, work: Path, timeout: float) -> Path:
    """md -> docx (GenOffice, else pandoc) or, as a last resort, simple HTML."""
    target = work / "doc.docx"
    genoffice = _genoffice_binary()
    if genoffice:
        env = {**os.environ, "GENOFFICE_ALLOWED_ROOTS": str(work), "HOME": str(work)}
        code, _ = await _run(
            [genoffice, "convert", str(src), "--to", "docx", "--out", str(target), "--force"],
            timeout=timeout,
            env=env,
            cwd=str(work),
        )
        if code == 0 and target.is_file():
            return target
    pandoc = shutil.which("pandoc")
    if pandoc:
        code, _ = await _run([pandoc, str(src), "-o", str(target)], timeout=timeout, cwd=str(work))
        if code == 0 and target.is_file():
            return target
    from markdown_it import MarkdownIt

    body = MarkdownIt("commonmark").enable("table").render(
        src.read_text(encoding="utf-8", errors="replace")
    )
    html = work / "doc.html"
    html.write_text(
        '<!doctype html><html><head><meta charset="utf-8"><style>'
        "body{font-family:'Liberation Sans','DejaVu Sans',sans-serif}"
        "table{border-collapse:collapse}td,th{border:1px solid #999;padding:2px 6px}"
        f"</style></head><body>{body}</body></html>",
        encoding="utf-8",
    )
    return html


def _soffice_argv(binary: str, profile: Path, src: Path, outdir: Path) -> list[str]:
    argv = [
        binary,
        f"-env:UserInstallation={profile.as_uri()}",
        "--headless",
        "--invisible",
        "--nologo",
        "--nodefault",
        "--nofirststartwizard",
        "--nolockcheck",
        "--norestore",
    ]
    if src.suffix.lower() in HTML_SUFFIXES:
        # Open HTML in Writer proper (Writer/Web has no plain PDF filter).
        argv += ["--infilter=HTML (StarWriter)", "--convert-to", "pdf:writer_pdf_Export"]
    else:
        argv += ["--convert-to", "pdf"]
    return argv + ["--outdir", str(outdir), str(src)]


async def export_pdf(src: Path | str, out: Path | str, *, timeout: float = DEFAULT_TIMEOUT_S) -> Path:
    """Export ``src`` to the PDF file ``out`` (overwritten). Returns ``out``."""
    src = _check_source(Path(src))
    out = Path(out)
    if out.suffix.lower() != ".pdf":
        raise ConverterError("output must be a .pdf file", code="bad_output")
    if src.suffix.lower() == ".pdf":
        if src.resolve() != out.resolve():
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, out)
        return out
    binary = soffice_binary()
    if binary is None:
        raise ConverterUnavailable("LibreOffice (soffice) is not installed on this server")

    work = Path(tempfile.mkdtemp(prefix="khai-docconv-"))
    try:
        profile = work / "lo-profile"
        indir = work / "in"
        outdir = work / "out"
        indir.mkdir()
        outdir.mkdir()
        suffix = src.suffix.lower()
        # A neutral copy: odd file names (leading '-', spaces, unicode) and a
        # read-only workspace never reach soffice's command line.
        staged = indir / f"input{suffix}"
        shutil.copyfile(src, staged)
        if suffix in MARKDOWN_SUFFIXES:
            staged = await _markdown_to_intermediate(staged, indir, timeout)
        env = {
            **os.environ,
            "HOME": str(work),
            "TMPDIR": str(work),
            "SAL_USE_VCLPLUGIN": "svp",
        }
        semaphore = _office_semaphore()
        try:
            await asyncio.wait_for(semaphore.acquire(), QUEUE_TIMEOUT_S)
        except asyncio.TimeoutError:
            raise ConverterError(
                "converter busy: too many conversions running, try again shortly",
                code="busy",
            ) from None
        try:
            code, output = await _run(
                _soffice_argv(binary, profile, staged, outdir),
                timeout=timeout,
                env=env,
                cwd=str(work),
            )
        finally:
            semaphore.release()
        produced = outdir / f"{staged.stem}.pdf"
        if code != 0 or not produced.is_file() or produced.stat().st_size == 0:
            detail = " ".join(output.split())[-300:]
            raise ConverterError(
                f"LibreOffice could not convert {src.name} (exit {code})"
                + (f": {detail}" if detail else "")
            )
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp_out = out.with_name(f".{out.name}.part")
        shutil.copyfile(produced, tmp_out)
        os.replace(tmp_out, out)
        return out
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ------------------------------------------------------------------ render


def pdf_page_count(pdf: Path) -> int:
    from pypdf import PdfReader

    try:
        return len(PdfReader(str(pdf)).pages)
    except Exception as exc:
        raise ConverterError(f"unreadable PDF: {exc}") from exc


def default_pages(page_count: int, limit: int = 3) -> list[int]:
    """First, middle and last page (deduplicated, at most ``limit``)."""
    if page_count <= 0:
        return []
    picks = [1, (page_count + 1) // 2, page_count]
    return sorted(dict.fromkeys(picks))[:limit]


async def render_pages(
    src: Path | str,
    out_dir: Path | str,
    *,
    pages: Sequence[int] | None = None,
    width_px: int = 1024,
    max_pages: int = 6,
    timeout: float = DEFAULT_TIMEOUT_S,
    pdf_out: Path | str | None = None,
) -> RenderResult:
    """Render ``pages`` (1-based; default first/middle/last) of ``src`` to PNG.

    Non-PDF sources are exported first (to ``pdf_out`` when given, else a
    temp file that is removed). Images land in ``out_dir`` as
    ``<stem>-p<N>.png``.
    """
    src = _check_source(Path(src))
    out_dir = Path(out_dir)
    renderer = pdftoppm_binary()
    if renderer is None:
        raise ConverterUnavailable("poppler (pdftoppm) is not installed on this server")
    width = max(MIN_RENDER_WIDTH, min(MAX_RENDER_WIDTH, int(width_px)))
    work = Path(tempfile.mkdtemp(prefix="khai-docrender-"))
    try:
        if src.suffix.lower() == ".pdf":
            pdf = src
        else:
            pdf = Path(pdf_out) if pdf_out else work / "doc.pdf"
            await export_pdf(src, pdf, timeout=timeout)
        count = pdf_page_count(pdf)
        wanted = list(dict.fromkeys(int(p) for p in pages)) if pages else default_pages(count)
        valid = [p for p in wanted if 1 <= p <= count][:max_pages]
        skipped = [p for p in wanted if p not in valid]
        out_dir.mkdir(parents=True, exist_ok=True)
        images: list[Path] = []
        for page in valid:
            prefix = work / f"p{page}"
            code, output = await _run(
                [
                    renderer, "-png", "-f", str(page), "-l", str(page),
                    "-scale-to-x", str(width), "-scale-to-y", "-1",
                    "-singlefile", str(pdf), str(prefix),
                ],
                timeout=timeout,
                cwd=str(work),
            )
            produced = prefix.with_suffix(".png")
            if code != 0 or not produced.is_file():
                raise ConverterError(
                    f"could not render page {page} (exit {code}): {' '.join(output.split())[-200:]}"
                )
            target = out_dir / f"{src.stem}-p{page}.png"
            shutil.move(str(produced), target)
            images.append(target)
        return RenderResult(
            pdf=pdf if (pdf == src or pdf_out) else None,
            page_count=count,
            pages=valid,
            images=images,
            skipped=skipped,
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)


__all__ = [
    "ConverterError",
    "ConverterUnavailable",
    "RenderResult",
    "converter_available",
    "default_pages",
    "export_pdf",
    "pdf_page_count",
    "pdftoppm_binary",
    "render_pages",
    "soffice_binary",
]
