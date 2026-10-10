"""Each user's backend ("worker"): started on demand, stopped when idle.

A worker is the ordinary app service in worker mode (``KHAI_WORKER_TOKEN``,
see app_server/service.py) bound to one user:

* its database role ``u_<id>`` with a password rotated on every start
  (core/auth/provisioning.py), so the database itself confines it;
* its own home (sessions, settings, provider keys, MCP, skills) and
  workspace under ``<data root>/users/<id>/``;
* a random bearer token only the gateway knows;
* the server's model provider keys, for administrators only (members add
  their own in Settings, since a worker's code can read its environment).

Two backends start workers. ``docker`` (the hosted deployment) runs one
locked-down container per user: no capabilities, no new privileges, CPU,
memory and process limits, an optional gVisor runtime, only that user's
directory mounted, on a network that reaches the database and the internet
but not the gateway's Redis or Docker. ``process`` (development) runs a
local subprocess with the same environment.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import secrets
import socket
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

import aiohttp

from app_server.gateway.qdrant import QdrantProvisioner
from core.auth.provisioning import WorkerRoles

logger = logging.getLogger(__name__)

WORKER_PORT = 8080


class WorkerUnavailable(RuntimeError):
    """The user's worker could not be started (capacity, Docker, timeout)."""


@dataclass(slots=True)
class Worker:
    user_id: str
    url: str  # base URL the gateway reaches the worker at
    token: str
    handle: object = None
    connections: int = 0
    last_used: float = field(default_factory=time.monotonic)

    def touch(self) -> None:
        self.last_used = time.monotonic()


@dataclass(frozen=True, slots=True)
class WorkerLaunch:
    user_id: str
    token: str
    environment: dict[str, str]
    data_directory: Path


class Backend(Protocol):
    async def start(self, launch: WorkerLaunch) -> tuple[str, object]: ...

    async def stop(self, handle: object) -> None: ...

    async def alive(self, handle: object) -> bool: ...


# Shared with every worker: which connection and model to start with, and
# the server's spend limits (a user's own config cannot loosen them).
SHARED_VARIABLES = (
    "DEEPCODE_LOG_LEVEL",
    "KHAI_DEFAULT_CONNECTION",
    "KHAI_DEFAULT_MODEL",
    "KHAI_RAG_EMBEDDING_MODEL",
    "KHAI_MAX_TURN_COST_USD",
    "KHAI_MAX_SESSION_COST_USD",
)
# The server's provider keys, given only to administrators' workers.
ADMIN_VARIABLES = (
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "NVIDIA_API_KEY",
    "FIRECRAWL_API_KEY",
)


@dataclass(frozen=True, slots=True)
class WorkerSettings:
    data_root: Path
    database_url: str
    database_schema: str = ""
    idle_seconds: int = 30 * 60
    max_workers: int = 12
    start_timeout: float = 90.0
    extra_environment: dict[str, str] = field(default_factory=dict)
    admin_environment: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_environment(cls, database_url: str) -> WorkerSettings:
        passthrough = {
            name: os.environ[name] for name in SHARED_VARIABLES if os.environ.get(name)
        }
        keys = {name: os.environ[name] for name in ADMIN_VARIABLES if os.environ.get(name)}
        return cls(
            data_root=Path(os.environ.get("KHAI_DATA_ROOT", "/data")).expanduser(),
            database_url=os.environ.get("KHAI_WORKER_DATABASE_URL", "") or database_url,
            database_schema=os.environ.get("KHAI_DATABASE_SCHEMA", ""),
            idle_seconds=int(os.environ.get("KHAI_WORKER_IDLE_SECONDS", 30 * 60)),
            max_workers=int(os.environ.get("KHAI_MAX_WORKERS", 12)),
            extra_environment=passthrough,
            admin_environment=keys,
        )


def _with_credentials(url: str, role: str, password: str) -> str:
    parts = urlsplit(url)
    host = parts.netloc.rsplit("@", 1)[-1]
    return urlunsplit(parts._replace(netloc=f"{role}:{password}@{host}"))


class WorkerManager:
    def __init__(
        self,
        settings: WorkerSettings,
        roles: WorkerRoles,
        backend: Backend,
        *,
        qdrant: QdrantProvisioner | None = None,
    ) -> None:
        self.settings = settings
        self._roles = roles
        self._backend = backend
        self._qdrant = qdrant
        self._workers: dict[str, Worker] = {}
        self._starting: dict[str, asyncio.Future[Worker]] = {}
        self._lock = asyncio.Lock()
        self._reaper: asyncio.Task | None = None

    # -- lifecycle -------------------------------------------------------------

    def start_reaper(self) -> None:
        if self._reaper is None:
            self._reaper = asyncio.create_task(self._reap_forever())

    async def close(self) -> None:
        if self._reaper is not None:
            self._reaper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reaper
        for user_id in list(self._workers):
            await self.stop(user_id)

    def user_directory(self, user_id: str) -> Path:
        return self.settings.data_root / "users" / UUID(user_id).hex

    async def acquire(
        self, user_id: str, *, allow_commands: bool = False, administrator: bool = False
    ) -> Worker:
        """The user's running worker, started if needed.

        ``allow_commands`` (the account's "run commands" permission) and
        ``administrator`` (whether it gets the server's provider keys) apply
        when the worker starts; changing either means stopping the worker.
        """

        user_id = str(UUID(user_id))
        async with self._lock:
            worker = self._workers.get(user_id)
            if worker is not None:
                worker.touch()
                return worker
            pending = self._starting.get(user_id)
            if pending is None:
                running = len(self._workers) + len(self._starting)
                if running >= self.settings.max_workers:
                    raise WorkerUnavailable(
                        "The server is at capacity; try again in a few minutes."
                    )
                pending = asyncio.get_running_loop().create_future()
                self._starting[user_id] = pending
                asyncio.create_task(
                    self._launch(user_id, pending, allow_commands, administrator)
                )
        return await asyncio.shield(pending)

    async def stop(self, user_id: str) -> None:
        async with self._lock:
            worker = self._workers.pop(str(UUID(user_id)), None)
        if worker is not None:
            await self._backend.stop(worker.handle)

    async def _launch(
        self,
        user_id: str,
        future: asyncio.Future[Worker],
        allow_commands: bool,
        administrator: bool,
    ) -> None:
        try:
            worker = await self._start(user_id, allow_commands, administrator)
        except BaseException as exc:  # noqa: BLE001 - handed to the waiters
            async with self._lock:
                self._starting.pop(user_id, None)
            if not future.done():
                future.set_exception(
                    exc if isinstance(exc, WorkerUnavailable)
                    else WorkerUnavailable(f"Could not start your workspace: {exc}")
                )
            logger.exception("worker start failed for %s", user_id)
            return
        async with self._lock:
            self._starting.pop(user_id, None)
            self._workers[user_id] = worker
        future.set_result(worker)

    async def _start(self, user_id: str, allow_commands: bool, administrator: bool) -> Worker:
        role, password = await asyncio.to_thread(self._roles.issue, user_id)
        token = secrets.token_urlsafe(48)
        directory = self.user_directory(user_id)
        environment = {
            **self.settings.extra_environment,
            **(self.settings.admin_environment if administrator else {}),
            "KHAI_USER_ID": user_id,
            "KHAI_WORKER_TOKEN": token,
            "KHAI_DATABASE_URL": _with_credentials(
                self.settings.database_url, role, password
            ),
            "KHAI_DATABASE_SCHEMA": self.settings.database_schema,
            "KHAI_DATABASE_POOL_MAX": "4",
            "KHAI_ALLOW_COMMANDS": "1" if allow_commands else "0",
        }
        if self._qdrant is not None:
            environment.update(await self._qdrant.environment(user_id))
        launch = WorkerLaunch(user_id, token, environment, directory)
        url, handle = await self._backend.start(launch)
        worker = Worker(user_id=user_id, url=url, token=token, handle=handle)
        deadline = time.monotonic() + self.settings.start_timeout
        delay = 0.1
        next_alive_check = time.monotonic() + 2
        async with aiohttp.ClientSession() as http:
            while True:
                try:
                    async with http.get(
                        f"{url}/health/ready", timeout=aiohttp.ClientTimeout(total=3)
                    ) as response:
                        if response.status == 200:
                            return worker
                except (aiohttp.ClientError, TimeoutError):
                    pass
                now = time.monotonic()
                dead = False
                if now >= next_alive_check:
                    # Asking Docker costs a round trip; do it every 2 seconds.
                    next_alive_check = now + 2
                    dead = not await self._backend.alive(handle)
                if now > deadline or dead:
                    await self._backend.stop(handle)
                    raise WorkerUnavailable("Your workspace did not start in time.")
                # Poll quickly while a start is likely imminent, then back off.
                await asyncio.sleep(delay)
                delay = min(delay * 1.5, 0.5)

    # -- connection accounting and idle shutdown ---------------------------

    def opened(self, worker: Worker) -> None:
        worker.connections += 1
        worker.touch()

    def closed(self, worker: Worker) -> None:
        worker.connections = max(0, worker.connections - 1)
        worker.touch()

    async def _reap_forever(self) -> None:
        while True:
            await asyncio.sleep(30)
            try:
                await self.reap()
            except Exception:  # noqa: BLE001 - keep reaping
                logger.exception("worker reaper pass failed")

    async def reap(self) -> None:
        now = time.monotonic()
        async with self._lock:
            idle = [
                user_id
                for user_id, worker in self._workers.items()
                if worker.connections == 0
                and now - worker.last_used > self.settings.idle_seconds
            ]
            running = [
                (user_id, worker)
                for user_id, worker in self._workers.items()
                if user_id not in idle
            ]
        # Ask the backend outside the lock: acquire() runs on every request.
        dead = [
            user_id
            for user_id, worker in running
            if not await self._backend.alive(worker.handle)
        ]
        for user_id in idle:
            logger.info("stopping idle worker %s", user_id)
            await self.stop(user_id)
        for user_id in dead:
            logger.warning("worker %s exited; it starts again on next use", user_id)
            async with self._lock:
                # Unless it was replaced meanwhile.
                if self._workers.get(user_id) is dict(running).get(user_id):
                    self._workers.pop(user_id, None)


# ---------------------------------------------------------------------------
# Development backend: one local subprocess per user.


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class ProcessBackend:
    """Run each worker as a local ``python -m app_server.service`` process.

    For development only: processes share the host's filesystem and user, so
    they are isolated in the database but not on disk.
    """

    def __init__(self, *, python: str = sys.executable) -> None:
        self._python = python

    async def start(self, launch: WorkerLaunch) -> tuple[str, object]:
        home = launch.data_directory / "home"
        workspace = launch.data_directory / "workspace"
        for directory in (home, workspace):
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        port = _free_port()
        environment = {
            **{
                name: value
                for name, value in os.environ.items()
                if not name.startswith(("KHAI_", "DEEPCODE_"))
            },
            **launch.environment,
            "DEEPCODE_HOME": str(home),
            "KHAI_WORKSPACE_ROOT": str(workspace),
            "KHAI_BIND_HOST": "127.0.0.1",
        }
        # The worker's output, for debugging a worker that will not start.
        with open(launch.data_directory / "worker.log", "ab") as log:
            process = await asyncio.create_subprocess_exec(
                self._python,
                "-m",
                "app_server.service",
                "--port",
                str(port),
                "--database",
                str(home / "state" / "khai"),
                env=environment,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=log,
                stderr=log,
            )
        return f"http://127.0.0.1:{port}", process

    async def stop(self, handle: object) -> None:
        process: asyncio.subprocess.Process = handle  # type: ignore[assignment]
        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 15)
            except TimeoutError:
                process.kill()
                await process.wait()

    async def alive(self, handle: object) -> bool:
        return handle.returncode is None  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Hosted backend: one container per user, through the Docker Engine API.


@dataclass(frozen=True, slots=True)
class DockerSettings:
    image: str
    network: str
    host_data_root: str  # the data root as the Docker host sees it
    memory_bytes: int = 1024 * 1024 * 1024
    nano_cpus: int = 1_000_000_000
    pids_limit: int = 512
    runtime: str | None = None  # "runsc" for gVisor
    socket: str = "/var/run/docker.sock"

    @classmethod
    def from_environment(cls) -> DockerSettings:
        return cls(
            image=os.environ.get("KHAI_WORKER_IMAGE", "khai-agents:latest"),
            network=os.environ.get("KHAI_WORKER_NETWORK", "khai-workers"),
            host_data_root=os.environ.get("KHAI_HOST_DATA_ROOT")
            or os.environ.get("KHAI_DATA_ROOT", "/data"),
            memory_bytes=int(float(os.environ.get("KHAI_WORKER_MEMORY_GB", "1")) * 1024**3),
            nano_cpus=int(float(os.environ.get("KHAI_WORKER_CPUS", "1")) * 1e9),
            pids_limit=int(os.environ.get("KHAI_WORKER_PIDS", "512")),
            runtime=os.environ.get("KHAI_WORKER_RUNTIME") or None,
            socket=os.environ.get("KHAI_DOCKER_SOCKET", "/var/run/docker.sock"),
        )


class DockerBackend:
    LABEL = "ink.khai-agents.worker"

    def __init__(self, settings: DockerSettings) -> None:
        self.settings = settings
        self._docker: aiohttp.ClientSession | None = None

    @contextlib.asynccontextmanager
    async def _session(self):
        """The one Docker Engine API client, kept open across calls."""

        if self._docker is None or self._docker.closed:
            self._docker = aiohttp.ClientSession(
                connector=aiohttp.UnixConnector(path=self.settings.socket),
                base_url="http://docker",
                timeout=aiohttp.ClientTimeout(total=60),
            )
        yield self._docker

    def _name(self, user_id: str) -> str:
        return f"khai-worker-{UUID(user_id).hex}"

    # The image's "khai" user (Dockerfile); keep the two in step.
    WORKER_UID = 10001

    def _prepare_directory(self, directory: Path) -> None:
        """The user's private tree, owned by the unprivileged worker user."""

        for path in (directory, directory / "home", directory / "workspace"):
            path.mkdir(mode=0o700, parents=True, exist_ok=True)
            path.chmod(0o700)
            if os.geteuid() == 0:
                os.chown(path, self.WORKER_UID, self.WORKER_UID)

    async def start(self, launch: WorkerLaunch) -> tuple[str, object]:
        await asyncio.to_thread(self._prepare_directory, launch.data_directory)
        name = self._name(launch.user_id)
        user_root = f"{self.settings.host_data_root.rstrip('/')}/users/{UUID(launch.user_id).hex}"
        environment = {
            **launch.environment,
            "HOME": "/data/home",
            "DEEPCODE_HOME": "/data/home",
            "KHAI_WORKSPACE_ROOT": "/data/workspace",
            "KHAI_BIND_HOST": "0.0.0.0",
            "PORT": str(WORKER_PORT),
        }
        body = {
            "Image": self.settings.image,
            "Entrypoint": ["/app/docker/worker-entrypoint.sh"],
            "Env": [f"{key}={value}" for key, value in environment.items()],
            "Labels": {self.LABEL: launch.user_id},
            "User": f"{self.WORKER_UID}:{self.WORKER_UID}",
            "HostConfig": {
                "Binds": [f"{user_root}:/data:rw"],
                "NetworkMode": self.settings.network,
                "Memory": self.settings.memory_bytes,
                "MemorySwap": self.settings.memory_bytes,
                "NanoCpus": self.settings.nano_cpus,
                "PidsLimit": self.settings.pids_limit,
                "CapDrop": ["ALL"],
                "SecurityOpt": ["no-new-privileges:true"],
                "ReadonlyRootfs": True,
                # A tiny init as PID 1 reaps orphaned children (e.g. a
                # LibreOffice conversion's helpers) and forwards signals.
                "Init": True,
                "Tmpfs": {"/tmp": "rw,nosuid,nodev,size=512m"},
                "RestartPolicy": {"Name": "no"},
                "AutoRemove": True,
                **({"Runtime": self.settings.runtime} if self.settings.runtime else {}),
            },
        }
        async with self._session() as docker:
            # A container left by a crashed gateway is replaced, never reused:
            # its token and database password are unknown here.
            async with docker.delete(f"/containers/{name}", params={"force": "true"}):
                pass
            async with docker.post(
                "/containers/create", params={"name": name}, json=body
            ) as response:
                if response.status >= 300:
                    raise WorkerUnavailable(
                        f"Docker refused the workspace container: {await response.text()}"
                    )
            async with docker.post(f"/containers/{name}/start") as response:
                if response.status >= 300:
                    raise WorkerUnavailable(
                        f"Docker could not start the workspace: {await response.text()}"
                    )
        return f"http://{name}:{WORKER_PORT}", name

    async def stop(self, handle: object) -> None:
        async with self._session() as docker:
            async with docker.post(
                f"/containers/{handle}/stop", params={"t": "15"}
            ):
                pass
            async with docker.delete(f"/containers/{handle}", params={"force": "true"}):
                pass

    async def alive(self, handle: object) -> bool:
        async with self._session() as docker:
            async with docker.get(f"/containers/{handle}/json") as response:
                if response.status != 200:
                    return False
                state = (await response.json()).get("State") or {}
                return bool(state.get("Running"))
