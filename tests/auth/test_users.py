"""Registration, administrator review and sign-in."""

from __future__ import annotations

from pathlib import Path

import pytest

from core.auth.users import (
    AccountNotActive,
    AuthError,
    Forbidden,
    InvalidCredentials,
    UserService,
)
from core.persistence.database import Database

PASSWORD = "correct horse battery"


@pytest.fixture
def users(tmp_path: Path) -> UserService:
    database = Database(tmp_path / "state")
    database.initialize()
    return UserService(database)


def test_first_registration_is_the_active_admin_and_later_ones_wait(users) -> None:
    admin = users.register("khai", PASSWORD, "Khai")
    assert (admin.role, admin.status, admin.can_execute) == ("admin", "active", True)

    friend = users.register("Friend", PASSWORD, "A Friend")
    assert (friend.username, friend.role, friend.status) == ("friend", "member", "pending")
    assert friend.can_execute is False

    with pytest.raises(AccountNotActive, match="waiting"):
        users.authenticate("friend", PASSWORD)

    users.approve(admin.id, friend.id)
    assert users.authenticate("friend", PASSWORD).id == friend.id


def test_first_registration_claims_the_placeholder_admin_and_its_data(
    tmp_path: Path,
) -> None:
    database = Database(tmp_path / "state")
    database.initialize()
    placeholder = database.user_id  # single-user setup: data predating accounts
    admin = UserService(database).register("khai", PASSWORD)
    assert admin.id == placeholder
    assert admin.username == "khai"


def test_wrong_username_and_wrong_password_fail_the_same_way(users) -> None:
    users.register("khai", PASSWORD)
    with pytest.raises(InvalidCredentials) as unknown:
        users.authenticate("nobody", PASSWORD)
    with pytest.raises(InvalidCredentials) as wrong:
        users.authenticate("khai", "not the password")
    assert str(unknown.value) == str(wrong.value)


def test_registration_validates_input(users) -> None:
    with pytest.raises(AuthError, match="Username"):
        users.register("x", PASSWORD)
    with pytest.raises(AuthError, match="at least"):
        users.register("someone", "short")
    with pytest.raises(AuthError, match="username"):
        users.register("someone1234", "someone1234")
    users.register("taken", PASSWORD)
    with pytest.raises(AuthError, match="taken"):
        users.register("TAKEN", PASSWORD)


def test_only_admins_administer(users) -> None:
    admin = users.register("khai", PASSWORD)
    member = users.register("member", PASSWORD)
    users.approve(admin.id, member.id)
    other = users.register("other", PASSWORD)
    with pytest.raises(Forbidden):
        users.approve(member.id, other.id)
    with pytest.raises(Forbidden):
        users.list(member.id)
    assert [user.username for user in users.list(admin.id, status="pending")] == ["other"]


def test_review_transitions(users) -> None:
    admin = users.register("khai", PASSWORD)
    pending = users.register("pending", PASSWORD)
    assert users.reject(admin.id, pending.id).status == "rejected"
    with pytest.raises(AccountNotActive, match="not approved"):
        users.authenticate("pending", PASSWORD)
    assert users.approve(admin.id, pending.id).status == "active"
    assert users.disable(admin.id, pending.id).status == "disabled"
    with pytest.raises(AccountNotActive, match="disabled"):
        users.authenticate("pending", PASSWORD)
    with pytest.raises(AuthError, match="cannot become"):
        users.reject(admin.id, pending.id)
    assert users.enable(admin.id, pending.id).status == "active"


def test_the_last_admin_cannot_be_removed(users) -> None:
    admin = users.register("khai", PASSWORD)
    with pytest.raises(AuthError, match="last administrator"):
        users.set_role(admin.id, admin.id, "member")
    with pytest.raises(AuthError, match="last administrator"):
        users.disable(admin.id, admin.id)
    second = users.register("second", PASSWORD)
    users.approve(admin.id, second.id)
    users.set_role(admin.id, second.id, "admin")
    assert users.set_role(second.id, admin.id, "member").role == "member"


def test_change_password_requires_the_current_one(users) -> None:
    admin = users.register("khai", PASSWORD)
    with pytest.raises(InvalidCredentials):
        users.change_password(admin.id, "wrong password!", "another good one")
    users.change_password(admin.id, PASSWORD, "another good one")
    with pytest.raises(InvalidCredentials):
        users.authenticate("khai", PASSWORD)
    assert users.authenticate("khai", "another good one").id == admin.id
