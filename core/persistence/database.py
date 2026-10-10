"""PostgreSQL connection and transaction boundary.

Every ``read()``/``transaction()`` borrows a pooled connection, opens one
transaction and pins it to a tenant before any statement runs:

* ``app.user_id`` — the user this ``Database`` is bound to. Row-level
  security (core/persistence/schema) shows and accepts only that user's rows,
  and fills ``user_id`` on insert, so repositories never filter by hand.
* ``app.system`` — set only by :meth:`Database.system`, for the few
  cross-user jobs (sign-in, user administration, scheduling sweeps).

A ``Database`` built without a user binds to the primary administrator (the
single-user setup and its existing data). With ``KHAI_MULTI_USER=1`` — the
hosted deployment — that fallback is refused: every caller must say whose
data it touches, via :meth:`for_user`.

``path`` is not the database: it anchors this instance's local state (service
files, the application lease) on disk, as it always has. The data lives at
``KHAI_DATABASE_URL``. When ``KHAI_DATABASE_SCHEMA_PER_PATH`` is set (the
test suite sets a per-run prefix) each path gets its own schema, so tests stay
isolated without one server per test.
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
import threading
import weakref
import atexit
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any
from uuid import UUID

import psycopg
from psycopg import errors as pg_errors
from psycopg_pool import ConnectionPool

from core.config import deepcode_home
from core.persistence.errors import (
    DatabaseError,
    IntegrityError,
    OperationalError,
    UserScopeError,
)

SCHEMA_DIRECTORY = Path(__file__).with_name("schema")
LATEST_SCHEMA_VERSION = max(
    int(path.name.split("_", 1)[0]) for path in SCHEMA_DIRECTORY.glob("[0-9]*.sql")
)
# Session-level advisory lock taken while migrating, so concurrent processes
# install the schema once.
_MIGRATION_LOCK = 0x4B4841490001  # "KHAI" + 1
_SCHEMA_NAME = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


def default_database_path() -> Path:
    """Anchor for local state files; the data itself lives in PostgreSQL."""

    return deepcode_home() / "state" / "khai"


def database_url() -> str:
    url = os.environ.get("KHAI_DATABASE_URL", "").strip()
    if not url:
        raise OperationalError(
            "KHAI_DATABASE_URL is not set; start docker/stack/up.sh and export the URL it prints"
        )
    return url


def multi_user_mode() -> bool:
    return os.environ.get("KHAI_MULTI_USER", "").strip() == "1"


# ---------------------------------------------------------------------------
# Rows and connections


class Row(tuple):
    """A result row readable by position or column name, like ``sqlite3.Row``."""

    __slots__ = ()
    _columns: dict[str, int]

    def __getitem__(self, key):  # type: ignore[override]
        if isinstance(key, str):
            return tuple.__getitem__(self, self._columns[key])
        return tuple.__getitem__(self, key)

    def keys(self) -> list[str]:
        return list(self._columns)

    def get(self, key: str, default: Any = None) -> Any:
        index = self._columns.get(key)
        return default if index is None else tuple.__getitem__(self, index)


@lru_cache(maxsize=256)
def _row_class(columns: tuple[str, ...]) -> type[Row]:
    return type(
        "Row",
        (Row,),
        {"__slots__": (), "_columns": {name: i for i, name in enumerate(columns)}},
    )


def _row_factory(cursor: psycopg.Cursor[Any]):
    description = cursor.description
    if description is None:
        return tuple
    row_class = _row_class(tuple(column.name for column in description))
    return lambda values: tuple.__new__(row_class, values)


@lru_cache(maxsize=2048)
def _translate(sql: str) -> str:
    """``?`` placeholders to ``%s`` and literal ``%`` to ``%%``, outside quotes."""

    out: list[str] = []
    quote: str | None = None
    index = 0
    length = len(sql)
    while index < length:
        char = sql[index]
        if quote:
            out.append("%%" if char == "%" else char)
            if char == quote:
                quote = None
        elif char in ("'", '"'):
            quote = char
            out.append(char)
        elif char == "-" and sql.startswith("--", index):
            end = sql.find("\n", index)
            end = length if end < 0 else end
            out.append(sql[index:end].replace("%", "%%"))
            index = end
            continue
        elif char == "?":
            out.append("%s")
        elif char == "%":
            out.append("%%")
        else:
            out.append(char)
        index += 1
    return "".join(out)


def _translate_error(exc: psycopg.Error) -> DatabaseError:
    if isinstance(exc, pg_errors.IntegrityError) or (
        isinstance(exc, pg_errors.RaiseException) and exc.sqlstate == "23000"
    ):
        error: DatabaseError = IntegrityError(str(exc))
    elif isinstance(exc, psycopg.OperationalError | pg_errors.LockNotAvailable):
        error = OperationalError(str(exc))
    else:
        error = DatabaseError(str(exc))
    error.sqlstate = getattr(exc, "sqlstate", None)  # type: ignore[attr-defined]
    return error


class Cursor:
    def __init__(self, cursor: psycopg.Cursor[Any]) -> None:
        self._cursor = cursor

    @property
    def rowcount(self) -> int:
        return self._cursor.rowcount

    @property
    def description(self):
        return self._cursor.description

    def fetchone(self):
        return self._cursor.fetchone() if self._cursor.description else None

    def fetchall(self) -> list:
        return self._cursor.fetchall() if self._cursor.description else []

    def __iter__(self):
        return iter(self.fetchall())


class Connection:
    """One transaction's connection with the ``sqlite3``-style call surface
    the repositories use: ``execute(sql, params)`` with ``?`` placeholders."""

    def __init__(self, connection: psycopg.Connection[Any]) -> None:
        self._connection = connection

    @property
    def raw(self) -> psycopg.Connection[Any]:
        return self._connection

    @property
    def in_transaction(self) -> bool:
        return not self._connection.autocommit

    def execute(
        self, sql: str, parameters: Sequence[Any] | Mapping[str, Any] = ()
    ) -> Cursor:
        cursor = self._connection.cursor(row_factory=_row_factory)
        try:
            if parameters:
                cursor.execute(_translate(sql), parameters)
            else:
                cursor.execute(sql)
        except psycopg.Error as exc:
            raise _translate_error(exc) from exc
        return Cursor(cursor)

    def executemany(self, sql: str, rows: Sequence[Sequence[Any]]) -> Cursor:
        cursor = self._connection.cursor(row_factory=_row_factory)
        try:
            cursor.executemany(_translate(sql), rows)
        except psycopg.Error as exc:
            raise _translate_error(exc) from exc
        return Cursor(cursor)

    @contextmanager
    def savepoint(self) -> Iterator[None]:
        """Undo only the enclosed statements on error; PostgreSQL otherwise
        aborts the whole transaction at the first failed statement."""

        try:
            with self._connection.transaction():
                yield
        except psycopg.Error as exc:
            raise _translate_error(exc) from exc


# ---------------------------------------------------------------------------
# Pools


_pools: dict[str, ConnectionPool] = {}
_pools_lock = threading.Lock()


def _search_path(schema: str) -> str:
    # Only the schema itself: a per-path schema must never resolve a table it
    # lacks to the same-named one in public.
    return schema


def _pool(url: str) -> ConnectionPool:
    with _pools_lock:
        pool = _pools.get(url)
        if pool is None:
            # Server-side prepared statements are per connection and keyed by
            # SQL text; with a schema per path (tests) one connection meets the
            # same text over different tables, so they are off there.
            per_path = bool(os.environ.get("KHAI_DATABASE_SCHEMA_PER_PATH", "").strip())
            pool = ConnectionPool(
                url,
                min_size=int(os.environ.get("KHAI_DATABASE_POOL_MIN", "1")),
                max_size=int(os.environ.get("KHAI_DATABASE_POOL_MAX", "16")),
                kwargs={
                    "autocommit": False,
                    "application_name": "khai-agents",
                    "prepare_threshold": None if per_path else 5,
                    # A stuck statement or an abandoned transaction must not
                    # hold a user's write lock forever.
                    "options": (
                        "-c statement_timeout="
                        + os.environ.get("KHAI_DATABASE_STATEMENT_TIMEOUT_MS", "120000")
                        + " -c idle_in_transaction_session_timeout=60000"
                    ),
                },
                open=True,
                timeout=30,
            )
            _pools[url] = pool
        return pool


atexit.register(lambda: close_pools())


# The (schema, user, system) each pooled connection is currently pinned to.
# The settings are session-level, so a connection keeps them between
# borrowings and only a change costs a round trip. Every borrowing passes
# through _apply_scope, so a connection never runs a statement under a stale
# tenant.
_connection_scopes: weakref.WeakKeyDictionary[
    psycopg.Connection[Any], tuple[str, str, str]
] = weakref.WeakKeyDictionary()


def _apply_scope(raw: psycopg.Connection[Any], scope: tuple[str, str, str]) -> None:
    if _connection_scopes.get(raw) == scope:
        return
    _connection_scopes.pop(raw, None)
    schema, user_id, system = scope
    raw.execute(
        "SELECT set_config('search_path', %s, false), "
        "set_config('app.user_id', %s, false), set_config('app.system', %s, false)",
        (_search_path(schema), user_id, system),
    )
    _connection_scopes[raw] = scope


def _forget_scope(raw: psycopg.Connection[Any]) -> None:
    _connection_scopes.pop(raw, None)


def close_pools() -> None:
    with _pools_lock:
        pools = list(_pools.values())
        _pools.clear()
    for pool in pools:
        pool.close()


def _schema_for(path: Path) -> str:
    prefix = os.environ.get("KHAI_DATABASE_SCHEMA_PER_PATH", "").strip()
    if prefix:
        # "1" or a run-specific prefix such as "t_3f9a2c" (the test suite).
        prefix = "t" if prefix == "1" else prefix
        if not _SCHEMA_NAME.match(prefix) or len(prefix) > 30:
            raise OperationalError(f"invalid KHAI_DATABASE_SCHEMA_PER_PATH: {prefix!r}")
        digest = hashlib.sha256(os.fspath(path).encode()).hexdigest()[:24]
        return f"{prefix}_{digest}"
    schema = os.environ.get("KHAI_DATABASE_SCHEMA", "").strip() or "public"
    if not _SCHEMA_NAME.match(schema):
        raise OperationalError(f"invalid KHAI_DATABASE_SCHEMA: {schema!r}")
    return schema


# ---------------------------------------------------------------------------
# Database


class Database:
    def __init__(
        self,
        path: Path | str | None = None,
        *,
        user_id: UUID | str | None = None,
        url: str | None = None,
        system: bool = False,
    ) -> None:
        self.path = (
            Path(path).expanduser().resolve() if path else default_database_path()
        )
        self.url = url or database_url()
        self.schema = _schema_for(self.path)
        self._user_id = str(UUID(str(user_id))) if user_id is not None else None
        self._system = system
        self._resolved_lock = threading.Lock()

    # -- scope ---------------------------------------------------------------

    @property
    def user_id(self) -> str:
        """The user this instance reads and writes as."""

        if self._system:
            raise UserScopeError("a system-scope Database has no user")
        if self._user_id is None:
            with self._resolved_lock:
                if self._user_id is None and os.environ.get("KHAI_USER_ID", "").strip():
                    # A user's worker: its database role decides the tenant;
                    # this only tells the application whose data it holds.
                    self._user_id = str(UUID(os.environ["KHAI_USER_ID"].strip()))
                if self._user_id is None:
                    if multi_user_mode():
                        raise UserScopeError(
                            "multi-user mode: this Database is not bound to a user"
                        )
                    self._user_id = self._primary_admin()
        return self._user_id

    def for_user(self, user_id: UUID | str) -> Database:
        """A sibling bound to ``user_id``, sharing the pool."""

        sibling = Database(self.path, user_id=user_id, url=self.url)
        sibling.schema = self.schema
        return sibling

    def system(self) -> Database:
        """A sibling in system scope (all rows). For cross-user jobs only."""

        sibling = Database(self.path, url=self.url, system=True)
        sibling.schema = self.schema
        return sibling

    @property
    def is_system(self) -> bool:
        return self._system

    # -- lifecycle -----------------------------------------------------------

    def close(self) -> None:
        """Pools are shared per process; see :func:`close_pools`."""

    @property
    def restore_marker(self) -> Path:
        return self.path.with_name(self.path.name + ".restore.json")

    @property
    def restore_recovery_marker(self) -> Path:
        return self.path.with_name(self.path.name + ".restored.json")

    def initialize(self, *, target_version: int = LATEST_SCHEMA_VERSION) -> None:
        if self.restore_marker.exists():
            raise RuntimeError(
                "A state restore is pending. Resume it with deepcode service restore before starting the application."
            )
        installed = self.schema_version()
        if installed == target_version:
            # Up to date: nothing to install, and a user's worker role (which
            # may not run DDL) never reaches the migrator.
            return
        if installed > target_version:
            raise OperationalError(
                f"database schema {installed} is newer than supported {target_version}"
            )
        with _pool(self.url).connection() as connection:
            _forget_scope(connection)
            connection.autocommit = True
            try:
                connection.execute("SELECT pg_advisory_lock(%s)", (_MIGRATION_LOCK,))
                try:
                    if self.schema != "public":
                        connection.execute(
                            f'CREATE SCHEMA IF NOT EXISTS "{self.schema}"'
                        )
                    connection.execute(
                        "SELECT set_config('search_path', %s, false)",
                        (_search_path(self.schema),),
                    )
                    _migrate(connection, target_version)
                finally:
                    connection.execute("RESET search_path")
                    connection.execute(
                        "SELECT pg_advisory_unlock(%s)", (_MIGRATION_LOCK,)
                    )
            except psycopg.Error as exc:
                raise _translate_error(exc) from exc
            finally:
                connection.autocommit = False

    def schema_version(self) -> int:
        with _pool(self.url).connection() as connection:
            _apply_scope(connection, (self.schema, "", ""))
            connection.commit()
            try:
                row = connection.execute(
                    "SELECT coalesce(max(version), 0) FROM schema_migrations"
                ).fetchone()
            except pg_errors.UndefinedTable:
                connection.rollback()
                return 0
            connection.rollback()
            return int(row[0]) if row else 0

    # -- transactions ----------------------------------------------------------

    @contextmanager
    def read(self) -> Iterator[Connection]:
        with self._scoped(serialize=False) as connection:
            yield connection

    @contextmanager
    def transaction(self) -> Iterator[Connection]:
        """One write transaction, committed on success and fully rolled back
        on error. Writers of the same user are serialized (the guarantee
        SQLite's BEGIN IMMEDIATE gave); different users never wait on each
        other."""

        with self._scoped(serialize=True) as connection:
            yield connection

    @contextmanager
    def _scoped(self, *, serialize: bool) -> Iterator[Connection]:
        scope = (
            (self.schema, "", "on") if self._system else (self.schema, self.user_id, "")
        )
        with _pool(self.url).connection() as raw:
            # The scope is applied in autocommit, so no later rollback can
            # undo it behind the cache. Reads then stay in autocommit (one
            # round trip per statement, as the SQLite reads did); writes are
            # one transaction.
            raw.autocommit = True
            try:
                _apply_scope(raw, scope)
                raw.autocommit = not serialize
                if serialize:
                    raw.execute(
                        "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                        (scope[1] or "system",),
                    )
            except psycopg.Error as exc:
                _forget_scope(raw)
                if not raw.autocommit:
                    raw.rollback()
                raise _translate_error(exc) from exc
            try:
                yield Connection(raw)
            except BaseException:
                if not raw.autocommit:
                    raw.rollback()
                raise
            else:
                if not raw.autocommit:
                    try:
                        raw.commit()
                    except psycopg.Error as exc:
                        raise _translate_error(exc) from exc
            finally:
                if raw.autocommit and not raw.closed:
                    raw.autocommit = False

    # -- primary administrator ------------------------------------------------

    def _primary_admin(self) -> str:
        """The first active administrator, created on first use.

        The created account has no usable password (a "!" hash never
        verifies); the operator sets one with ``deepcode users set-password``.
        """

        with self.system().transaction() as connection:
            row = connection.execute(
                "SELECT id FROM users WHERE role = 'admin' AND status = 'active' "
                "ORDER BY created_at, id LIMIT 1"
            ).fetchone()
            if row is None:
                row = connection.execute(
                    "INSERT INTO users (username, display_name, password_hash, role, "
                    "status, can_execute) "
                    "VALUES ('owner', 'Owner', ?, 'admin', 'active', true) "
                    "ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username "
                    "RETURNING id",
                    ("!" + secrets.token_hex(32),),
                ).fetchone()
        return str(row[0])


# ---------------------------------------------------------------------------
# Migrations


def _migrate(connection: psycopg.Connection[Any], target_version: int) -> None:
    connection.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "version integer PRIMARY KEY, name text NOT NULL, "
        "applied_at timestamptz NOT NULL DEFAULT now())"
    )
    installed = {
        int(row[0])
        for row in connection.execute("SELECT version FROM schema_migrations")
    }
    if installed and max(installed) > target_version:
        raise OperationalError(
            f"database schema {max(installed)} is newer than supported {target_version}"
        )
    for path in sorted(SCHEMA_DIRECTORY.glob("[0-9]*.sql")):
        version = int(path.name.split("_", 1)[0])
        if version in installed or version > target_version:
            continue
        with connection.transaction():
            connection.execute(path.read_text(encoding="utf-8"))
            connection.execute(
                "INSERT INTO schema_migrations (version, name) VALUES (%s, %s)",
                (version, path.stem),
            )
