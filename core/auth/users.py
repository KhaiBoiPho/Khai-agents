"""Accounts: self-registration, administrator review and sign-in.

Lifecycle: ``register`` creates a *pending* account; only an administrator's
``approve`` makes it *active*, and only active accounts sign in. An
administrator may also ``reject`` a pending account, ``disable`` or
``enable`` one, change its role, and allow or forbid running commands
(``can_execute``). The last active administrator can never be demoted or
disabled, so the system cannot lock itself out.

Every method runs in the database's system scope (accounts are not user data
under row-level security); callers authorize the acting user first, which
:meth:`UserService.require_admin` does for the administrative ones.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from core.auth.passwords import (
    PasswordPolicyError,
    check_policy,
    hash_password,
    needs_rehash,
    verify_password,
)
from core.persistence.database import Database
from core.persistence.errors import IntegrityError

USERNAME = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
STATUSES = ("pending", "active", "rejected", "disabled")
ROLES = ("admin", "member")


class AuthError(Exception):
    """A user-facing authentication or authorization failure."""

    code = "AUTH_ERROR"

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        if code:
            self.code = code


class InvalidCredentials(AuthError):
    code = "INVALID_CREDENTIALS"


class AccountNotActive(AuthError):
    code = "ACCOUNT_NOT_ACTIVE"


class Forbidden(AuthError):
    code = "FORBIDDEN"


@dataclass(frozen=True, slots=True)
class User:
    id: str
    username: str
    display_name: str
    role: str
    status: str
    can_execute: bool
    created_at: datetime
    reviewed_at: datetime | None

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "username": self.username,
            "displayName": self.display_name,
            "role": self.role,
            "status": self.status,
            "canExecute": self.can_execute,
            "createdAt": self.created_at.isoformat(),
            "reviewedAt": self.reviewed_at.isoformat() if self.reviewed_at else None,
        }


_COLUMNS = (
    "id, username, display_name, role, status, can_execute, created_at, reviewed_at"
)


def _user(row) -> User:
    return User(
        id=str(row["id"]),
        username=row["username"],
        display_name=row["display_name"],
        role=row["role"],
        status=row["status"],
        can_execute=bool(row["can_execute"]),
        created_at=row["created_at"],
        reviewed_at=row["reviewed_at"],
    )


def normalize_username(username: str) -> str:
    value = (username or "").strip().lower()
    if not USERNAME.match(value):
        raise AuthError(
            "Username must be 3-32 characters: lowercase letters, digits, '.', '_' or '-'.",
            code="INVALID_USERNAME",
        )
    return value


def _display_name(display_name: str, username: str) -> str:
    value = " ".join((display_name or "").split()) or username
    if len(value) > 80:
        raise AuthError("Display name must be at most 80 characters.", code="INVALID_NAME")
    return value


class UserService:
    def __init__(self, database: Database) -> None:
        self._system = database if database.is_system else database.system()

    # -- registration and sign-in ------------------------------------------

    def register(self, username: str, password: str, display_name: str = "") -> User:
        """Create a pending account; the very first account becomes the admin.

        The first-ever account is the operator setting the system up, so it
        is active and administrator immediately; everyone after waits for
        approval. If the single-user setup already created its placeholder
        administrator (which owns the data from before accounts existed), the
        first registration claims that account, data included.
        """

        name = normalize_username(username)
        try:
            check_policy(password, username=name)
        except PasswordPolicyError as exc:
            raise AuthError(str(exc), code="WEAK_PASSWORD") from exc
        hashed = hash_password(password)
        with self._system.transaction() as connection:
            first = (
                connection.execute(
                    "SELECT 1 FROM users WHERE password_hash LIKE '$argon2id$%' LIMIT 1"
                ).fetchone()
                is None
            )
            placeholder = (
                connection.execute(
                    "SELECT id FROM users WHERE role = 'admin' AND status = 'active' "
                    "AND password_hash LIKE '!%' ORDER BY created_at LIMIT 1 FOR UPDATE"
                ).fetchone()
                if first
                else None
            )
            try:
                if placeholder is not None:
                    row = connection.execute(
                        f"UPDATE users SET username = ?, display_name = ?, "
                        f"password_hash = ?, password_changed_at = now(), "
                        f"updated_at = now() WHERE id = ? RETURNING {_COLUMNS}",
                        (name, _display_name(display_name, name), hashed, placeholder[0]),
                    ).fetchone()
                    return _user(row)
                row = connection.execute(
                    f"INSERT INTO users (username, display_name, password_hash, role, "
                    f"status, can_execute) VALUES (?, ?, ?, ?, ?, ?) RETURNING {_COLUMNS}",
                    (
                        name,
                        _display_name(display_name, name),
                        hashed,
                        "admin" if first else "member",
                        "active" if first else "pending",
                        first,
                    ),
                ).fetchone()
            except IntegrityError as exc:
                raise AuthError("That username is taken.", code="USERNAME_TAKEN") from exc
        return _user(row)

    def authenticate(self, username: str, password: str) -> User:
        """The active account for these credentials.

        Wrong username and wrong password fail identically (same message, same
        hashing cost). A correct password for a pending, rejected or disabled
        account says so, since the person evidently owns it.
        """

        try:
            name = normalize_username(username)
        except AuthError:
            verify_password(None, password or "")
            raise InvalidCredentials("Incorrect username or password.") from None
        with self._system.read() as connection:
            row = connection.execute(
                f"SELECT {_COLUMNS}, password_hash FROM users WHERE username = ?",
                (name,),
            ).fetchone()
        if not verify_password(row["password_hash"] if row else None, password or ""):
            raise InvalidCredentials("Incorrect username or password.")
        user = _user(row)
        if user.status != "active":
            raise AccountNotActive(
                {
                    "pending": "Your account is waiting for an administrator's approval.",
                    "rejected": "Your registration was not approved.",
                    "disabled": "Your account has been disabled.",
                }[user.status]
            )
        if needs_rehash(row["password_hash"]):
            self._store_password(user.id, password)
        return user

    def get(self, user_id: str) -> User | None:
        with self._system.read() as connection:
            row = connection.execute(
                f"SELECT {_COLUMNS} FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        return _user(row) if row else None

    def active(self, user_id: str) -> User | None:
        user = self.get(user_id)
        return user if user is not None and user.status == "active" else None

    def change_password(self, user_id: str, current: str, new: str) -> None:
        with self._system.read() as connection:
            row = connection.execute(
                "SELECT username, password_hash FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        if row is None or not verify_password(row["password_hash"], current or ""):
            raise InvalidCredentials("The current password is incorrect.")
        try:
            check_policy(new, username=row["username"])
        except PasswordPolicyError as exc:
            raise AuthError(str(exc), code="WEAK_PASSWORD") from exc
        self._store_password(user_id, new)

    def _store_password(self, user_id: str, password: str) -> None:
        with self._system.transaction() as connection:
            connection.execute(
                "UPDATE users SET password_hash = ?, password_changed_at = now(), "
                "updated_at = now() WHERE id = ?",
                (hash_password(password), user_id),
            )

    # -- administration ------------------------------------------------------

    def require_admin(self, actor_id: str) -> User:
        actor = self.active(actor_id)
        if actor is None or not actor.is_admin:
            raise Forbidden("Only an administrator can do that.")
        return actor

    def list(self, actor_id: str, *, status: str | None = None) -> list[User]:
        self.require_admin(actor_id)
        if status is not None and status not in STATUSES:
            raise AuthError("Unknown status.", code="INVALID_STATUS")
        with self._system.read() as connection:
            rows = connection.execute(
                f"SELECT {_COLUMNS} FROM users WHERE password_hash LIKE '$argon2id$%' "
                + ("AND status = ? " if status else "")
                + "ORDER BY (status = 'pending') DESC, created_at",
                (status,) if status else (),
            ).fetchall()
        return [_user(row) for row in rows]

    def approve(self, actor_id: str, user_id: str) -> User:
        return self._review(actor_id, user_id, "active", allowed_from=("pending", "rejected"))

    def reject(self, actor_id: str, user_id: str) -> User:
        return self._review(actor_id, user_id, "rejected", allowed_from=("pending",))

    def disable(self, actor_id: str, user_id: str) -> User:
        return self._review(actor_id, user_id, "disabled", allowed_from=("active",))

    def enable(self, actor_id: str, user_id: str) -> User:
        return self._review(actor_id, user_id, "active", allowed_from=("disabled",))

    def set_role(self, actor_id: str, user_id: str, role: str) -> User:
        if role not in ROLES:
            raise AuthError("Unknown role.", code="INVALID_ROLE")
        return self._update(actor_id, user_id, "role = ?", (role,))

    def set_can_execute(self, actor_id: str, user_id: str, allowed: bool) -> User:
        return self._update(actor_id, user_id, "can_execute = ?", (bool(allowed),))

    def _review(
        self, actor_id: str, user_id: str, status: str, *, allowed_from: tuple[str, ...]
    ) -> User:
        actor = self.require_admin(actor_id)
        with self._system.transaction() as connection:
            row = connection.execute(
                "SELECT status FROM users WHERE id = ? FOR UPDATE", (user_id,)
            ).fetchone()
            if row is None:
                raise AuthError("No such user.", code="NOT_FOUND")
            if row["status"] not in allowed_from:
                raise AuthError(
                    f"A {row['status']} account cannot become {status}.",
                    code="INVALID_TRANSITION",
                )
            if status == "disabled":
                self._keep_an_admin(connection, user_id)
            updated = connection.execute(
                f"UPDATE users SET status = ?, reviewed_by = ?, reviewed_at = now(), "
                f"updated_at = now() WHERE id = ? RETURNING {_COLUMNS}",
                (status, actor.id, user_id),
            ).fetchone()
        return _user(updated)

    def _update(self, actor_id: str, user_id: str, assignment: str, values: tuple) -> User:
        self.require_admin(actor_id)
        with self._system.transaction() as connection:
            if connection.execute(
                "SELECT 1 FROM users WHERE id = ? FOR UPDATE", (user_id,)
            ).fetchone() is None:
                raise AuthError("No such user.", code="NOT_FOUND")
            if assignment.startswith("role") and values[0] != "admin":
                self._keep_an_admin(connection, user_id)
            row = connection.execute(
                f"UPDATE users SET {assignment}, updated_at = now() WHERE id = ? "
                f"RETURNING {_COLUMNS}",
                (*values, user_id),
            ).fetchone()
        return _user(row)

    @staticmethod
    def _keep_an_admin(connection, user_id: str) -> None:
        """Refuse to remove the last active administrator."""

        others = connection.execute(
            "SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active' "
            "AND id <> ? AND password_hash LIKE '$argon2id$%'",
            (user_id,),
        ).fetchone()[0]
        target = connection.execute(
            "SELECT role, status FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if target["role"] == "admin" and target["status"] == "active" and not others:
            raise AuthError(
                "The last administrator cannot be demoted or disabled.",
                code="LAST_ADMIN",
            )
