"""Per-user database roles for the hosted deployment.

Each approved user's backend connects as ``u_<user id hex>``, a member of
``khai_worker`` (core/persistence/schema/0003_worker_roles.sql). The role's
password is random and rotated every time the user's container starts, so it
is never stored: the gateway sets it, hands it to the new container and
forgets it. Locking a user turns the role's LOGIN off; deleting a user drops
it.
"""

from __future__ import annotations

import secrets
from uuid import UUID

from psycopg import sql

from core.persistence.database import Database


def worker_role(user_id: str | UUID) -> str:
    return "u_" + UUID(str(user_id)).hex


class WorkerRoles:
    def __init__(self, database: Database) -> None:
        self._system = database if database.is_system else database.system()

    def issue(self, user_id: str | UUID, *, connection_limit: int = 16) -> tuple[str, str]:
        """Create or re-enable the user's role with a fresh password.

        Returns ``(role, password)``; the password is not kept anywhere.
        """

        role = worker_role(user_id)
        password = secrets.token_urlsafe(32)
        with self._system.transaction() as connection:
            raw = connection.raw
            exists = raw.execute(
                "SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)
            ).fetchone()
            if exists is None:
                raw.execute(
                    sql.SQL(
                        "CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE "
                        "NOBYPASSRLS NOREPLICATION IN ROLE khai_worker "
                        "CONNECTION LIMIT {} PASSWORD {}"
                    ).format(
                        sql.Identifier(role),
                        sql.Literal(int(connection_limit)),
                        sql.Literal(password),
                    )
                )
            else:
                raw.execute(
                    sql.SQL("ALTER ROLE {} LOGIN PASSWORD {}").format(
                        sql.Identifier(role), sql.Literal(password)
                    )
                )
            database = raw.execute("SELECT current_database()").fetchone()[0]
            raw.execute(
                sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                    sql.Identifier(database), sql.Identifier(role)
                )
            )
        return role, password

    def lock(self, user_id: str | UUID) -> None:
        """Refuse new connections for the user's role (existing ones end with
        the container)."""

        role = worker_role(user_id)
        with self._system.transaction() as connection:
            if connection.raw.execute(
                "SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)
            ).fetchone():
                connection.raw.execute(
                    sql.SQL("ALTER ROLE {} NOLOGIN PASSWORD NULL").format(
                        sql.Identifier(role)
                    )
                )

    def drop(self, user_id: str | UUID) -> None:
        role = worker_role(user_id)
        with self._system.transaction() as connection:
            raw = connection.raw
            if raw.execute(
                "SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)
            ).fetchone() is None:
                return
            database = raw.execute("SELECT current_database()").fetchone()[0]
            raw.execute(
                sql.SQL("REVOKE CONNECT ON DATABASE {} FROM {}").format(
                    sql.Identifier(database), sql.Identifier(role)
                )
            )
            raw.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))
