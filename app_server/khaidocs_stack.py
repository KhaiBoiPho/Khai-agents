"""Bring KhaiDocs (Docmost) up with the service and sign in without a form.

When the service starts, a background thread runs ``docker/khaidocs/up.sh``
(idempotent ``docker compose up -d``), waits for Docmost, and makes sure the
proxy holds working credentials:

* no workspace yet  -> create one through Docmost's first-run setup with a
  random password nobody types;
* workspace exists but the stored credentials fail -> run
  ``link-account.sh``, which resets the owner's password to a fresh random
  one.

Either way the result lands in the checkout's ``.env`` (git-ignored, owner
only) as KHAIDOCS_EMAIL / KHAIDOCS_PASSWORD and is handed to the proxy, so the
browser never sees Docmost's login page. Set KHAIDOCS_AUTOSTART=0 to skip all
of this and run KhaiDocs yourself.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path

logger = logging.getLogger(__name__)

CHECKOUT = Path(__file__).resolve().parents[1]
STACK_DIR = CHECKOUT / "docker" / "khaidocs"
ENV_FILE = CHECKOUT / ".env"
OWNER_EMAIL = "owner@khai-agents.local"


def start_in_background(
    server: str, on_credentials: Callable[[str, str], None]
) -> threading.Thread | None:
    if os.environ.get("KHAIDOCS_AUTOSTART", "1").strip() == "0":
        return None
    if not (STACK_DIR / "docker-compose.yml").is_file() or shutil.which("docker") is None:
        logger.info("KhaiDocs autostart skipped: Docker or the compose file is missing")
        return None
    thread = threading.Thread(
        target=_run, args=(server, on_credentials), name="khaidocs-stack", daemon=True
    )
    thread.start()
    return thread


def _run(server: str, on_credentials: Callable[[str, str], None]) -> None:
    try:
        subprocess.run(
            ["sh", str(STACK_DIR / "up.sh")],
            cwd=STACK_DIR,
            check=True,
            capture_output=True,
            timeout=900,
        )
        if not _wait_healthy(server, timeout=180):
            logger.warning("KhaiDocs did not become healthy in time")
            return
        credentials = _ensure_credentials(server)
        if credentials:
            on_credentials(*credentials)
            logger.info("KhaiDocs ready with single sign-on")
    except subprocess.CalledProcessError as exc:
        logger.warning("KhaiDocs failed to start: %s", (exc.stderr or b"")[-400:])
    except Exception:  # noqa: BLE001 - never take the service down with it
        logger.exception("KhaiDocs autostart failed")


def _request(server: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        server + path,
        data=data,
        method="POST" if data is not None else "GET",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read() or b"{}")
        except ValueError:
            return exc.code, {}


def _wait_healthy(server: str, *, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            status, _ = _request(server, "/api/health")
            if status == 200:
                return True
        except OSError:
            pass
        time.sleep(2)
    return False


def _login_ok(server: str, email: str, password: str) -> bool:
    if not email or not password:
        return False
    status, _ = _request(server, "/api/auth/login", {"email": email, "password": password})
    return status in (200, 201)


def _ensure_credentials(server: str) -> tuple[str, str] | None:
    email = os.environ.get("KHAIDOCS_EMAIL", "").strip()
    password = os.environ.get("KHAIDOCS_PASSWORD", "")
    if _login_ok(server, email, password):
        return email, password

    # First run: create the workspace ourselves.
    fresh = secrets.token_hex(24)
    status, payload = _request(
        server,
        "/api/auth/setup",
        {
            "workspaceName": "Khai-Agents",
            "name": "Khai",
            "email": OWNER_EMAIL,
            "password": fresh,
        },
    )
    if status in (200, 201):
        _write_env(OWNER_EMAIL, fresh)
        return OWNER_EMAIL, fresh
    if status != 403:
        logger.warning("KhaiDocs setup failed (%s): %s", status, payload)
        return None

    # A workspace exists but our credentials are stale: hand the owner
    # account to this service with a new random password.
    subprocess.run(
        ["sh", str(STACK_DIR / "link-account.sh")],
        cwd=STACK_DIR,
        check=True,
        capture_output=True,
        timeout=120,
    )
    values = _read_env()
    email, password = values.get("KHAIDOCS_EMAIL", ""), values.get("KHAIDOCS_PASSWORD", "")
    if _login_ok(server, email, password):
        return email, password
    logger.warning("KhaiDocs owner account could not be linked")
    return None


def _read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            name, sep, value = line.partition("=")
            if sep and not line.lstrip().startswith("#"):
                values[name.strip()] = value.strip().strip("'\"")
    except OSError:
        pass
    return values


def _write_env(email: str, password: str) -> None:
    lines: list[str] = []
    try:
        lines = [
            line
            for line in ENV_FILE.read_text(encoding="utf-8").splitlines()
            if not line.startswith(("KHAIDOCS_EMAIL=", "KHAIDOCS_PASSWORD="))
        ]
    except OSError:
        pass
    lines += [f"KHAIDOCS_EMAIL={email}", f"KHAIDOCS_PASSWORD={password}"]
    old_umask = os.umask(0o077)
    try:
        ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    finally:
        os.umask(old_umask)
    os.chmod(ENV_FILE, 0o600)
