"""Zip safety: traversal, bombs, links, limits (no database)."""

from __future__ import annotations

import io
import stat
import zipfile

import pytest

from core.khaidocs.errors import Invalid, TooLarge
from core.khaidocs.safezip import SafeZip, normalize_path, safe_filename


def make(entries: dict, *, compress=zipfile.ZIP_DEFLATED) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compress) as z:
        for name, data in entries.items():
            z.writestr(name, data)
    return out.getvalue()


def test_normal_archive_and_vietnamese_names() -> None:
    z = SafeZip(make({"Thư mục/Trang một.md": "# a", "img/a.png": b"x", "dir/": ""}))
    assert sorted(z.names) == ["Thư mục/Trang một.md", "img/a.png"]
    assert z.read("img/a.png") == b"x"
    assert z.resolve("Thư mục", "../img/a.png") == "img/a.png"
    assert z.resolve("Thư mục", "../img/a%2Epng") == "img/a.png"
    assert z.resolve("", "https://x/a.png") is None and z.resolve("", "/etc/passwd") is None
    assert z.resolve("", "../../etc/passwd") is None


@pytest.mark.parametrize("bad", ["../evil.md", "a/../../evil.md", "/abs.md", "C:/win.md", "a\\..\\..\\x.md"])
def test_path_traversal_entries_are_skipped_and_reported(bad) -> None:
    z = SafeZip(make({bad: "x", "ok.md": "fine"}))
    assert z.names == ["ok.md"]
    assert z.skipped and "unsafe" in z.skipped[0]


def test_normalize_path() -> None:
    assert normalize_path("a//b/./c.md") == "a/b/c.md"
    assert normalize_path("a\\b.md") == "a/b.md"
    assert normalize_path("../x") is None and normalize_path("") is None and normalize_path("a\x00b") is None


def test_symlinks_junk_and_encrypted_are_skipped() -> None:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        link = zipfile.ZipInfo("link.md")
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        z.writestr(link, "/etc/passwd")
        z.writestr("__MACOSX/._a.md", "x")
        z.writestr("a/.DS_Store", "x")
        z.writestr("real.md", "ok")
    z = SafeZip(out.getvalue())
    assert z.names == ["real.md"] and any("symlink" in s for s in z.skipped)


def test_zip_bomb_by_ratio_is_refused() -> None:
    with pytest.raises(Invalid, match="bomb"):
        SafeZip(make({"zeros.md": b"\0" * (30 * 1024 * 1024)}))


def test_limits_on_entries_total_and_entry_size() -> None:
    many = make({f"{i}.md": "x" for i in range(30)}, compress=zipfile.ZIP_STORED)
    with pytest.raises(TooLarge):
        SafeZip(many, max_entries=10)
    big = make({"a.bin": b"abcdefgh" * 100_000, "b.bin": b"ijklmnop" * 100_000}, compress=zipfile.ZIP_STORED)
    with pytest.raises(TooLarge):
        SafeZip(big, max_total=1_000_000)
    z = SafeZip(big, max_entry=500_000)
    assert z.names == [] and len(z.skipped) == 2


def test_lying_header_is_caught_on_read() -> None:
    data = bytearray(make({"a.md": b"x" * 5000}, compress=zipfile.ZIP_STORED))
    z = SafeZip(bytes(data))
    z._infos["a.md"].file_size = 10  # the header claims less than the data holds
    with pytest.raises(Invalid):
        z.read("a.md")


def test_not_a_zip() -> None:
    with pytest.raises(Invalid, match="not a valid zip"):
        SafeZip(b"PK\x03\x04 nonsense")


def test_safe_filename() -> None:
    assert safe_filename('a/b\\c:d*e?"<>|') == "a_b_c_d_e_"
    assert safe_filename("  ..  ") == "Untitled"
    assert safe_filename("Phở bò" * 40, limit=20) == ("Phở bò" * 40)[:20]
    assert "/" not in safe_filename("../../etc/passwd")
