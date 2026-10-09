"""Password hashing (argon2id) and the password policy.

Hashes are PHC strings from argon2-cffi with its RFC 9106 "low memory"
profile (64 MiB, 3 passes), which keeps a sign-in near 50 ms on a small
server. A stored hash that does not start with ``$argon2id$`` never verifies:
the generated administrator and disabled credentials use a ``!`` marker.
"""

from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from argon2.profiles import RFC_9106_LOW_MEMORY

MIN_LENGTH = 10
MAX_LENGTH = 256

_hasher = PasswordHasher.from_parameters(RFC_9106_LOW_MEMORY)
# Verified against when the username does not exist, so an unknown account
# costs the same time as a wrong password (no account enumeration by timing).
_DUMMY_HASH = _hasher.hash("khai-agents-timing-equalizer")


class PasswordPolicyError(ValueError):
    """The password does not meet the policy; the message is user-facing."""


def check_policy(password: str, *, username: str = "") -> None:
    if not isinstance(password, str):
        raise PasswordPolicyError("Password is required.")
    if len(password) < MIN_LENGTH:
        raise PasswordPolicyError(f"Password must be at least {MIN_LENGTH} characters.")
    if len(password) > MAX_LENGTH:
        raise PasswordPolicyError(f"Password must be at most {MAX_LENGTH} characters.")
    if username and password.strip().lower() == username.strip().lower():
        raise PasswordPolicyError("Password must not be the username.")
    if len(set(password)) < 4:
        raise PasswordPolicyError("Password is too repetitive.")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str | None, password: str) -> bool:
    """Constant-work verification; ``stored_hash=None`` means "no such user"."""

    if not stored_hash or not stored_hash.startswith("$argon2id$"):
        try:
            _hasher.verify(_DUMMY_HASH, password)
        except VerificationError:
            pass
        return False
    try:
        return _hasher.verify(stored_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except InvalidHashError:
        return True
