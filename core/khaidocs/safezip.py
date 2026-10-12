"""Reading untrusted zip archives safely, and safe file names.

Nothing is ever extracted to disk: entries are read into memory by their
normalised name, under hard limits (entry count, per-entry and total
uncompressed size, compression ratio), and entries with unsafe paths
(absolute, drive letters, ``..``, NULs), symlinks and encrypted entries are
skipped and reported. The size actually read is checked, not the (forgeable)
size in the header.
"""

from __future__ import annotations

import io
import os
import posixpath
import re
import stat
import unicodedata
import zipfile
import zlib

from core.khaidocs.errors import Invalid, TooLarge

MAX_ENTRIES = int(os.environ.get("KHAIDOCS_ZIP_MAX_ENTRIES", "5000"))
MAX_TOTAL = int(float(os.environ.get("KHAIDOCS_ZIP_MAX_MB", "500")) * 1024 * 1024)
MAX_ENTRY = int(float(os.environ.get("KHAIDOCS_MAX_UPLOAD_MB", "50")) * 1024 * 1024)
MAX_RATIO = 200
RATIO_FLOOR = 1024 * 1024  # small entries may compress extremely well
_JUNK = ("__MACOSX/", ".DS_Store", "Thumbs.db", "desktop.ini")
_BAD_CHARS = re.compile(r"[\\/:*?\"<>|\x00-\x1f]+")


def normalize_path(raw: str) -> str | None:
    """A safe relative POSIX path for a zip entry name, or None."""

    name = unicodedata.normalize("NFC", raw).replace("\\", "/")
    if not name or "\x00" in name or name.startswith("/") or re.match(r"^[A-Za-z]:", name):
        return None
    parts = [p for p in name.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        return None
    return "/".join(parts)


def safe_filename(name: str, default: str = "Untitled", limit: int = 100) -> str:
    """A file name without separators or control characters, NFC, bounded."""

    cleaned = _BAD_CHARS.sub("_", unicodedata.normalize("NFC", name or "")).strip(" .")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned[:limit].rstrip(" .") or default


class SafeZip:
    def __init__(self, data: bytes, *, max_entries: int = MAX_ENTRIES, max_total: int = MAX_TOTAL,
                 max_entry: int = MAX_ENTRY) -> None:
        self.max_entry = max_entry
        self.skipped: list[str] = []
        try:
            self._zip = zipfile.ZipFile(io.BytesIO(data))
        except (zipfile.BadZipFile, ValueError, OSError):
            raise Invalid("The file is not a valid zip archive") from None
        infos = self._zip.infolist()
        if len(infos) > max_entries:
            raise TooLarge(f"The archive has more than {max_entries} entries")
        self._infos: dict[str, zipfile.ZipInfo] = {}
        total = 0
        for info in infos:
            if info.is_dir():
                continue
            name = normalize_path(info.filename)
            if name is None:
                self.skipped.append(f"unsafe path: {info.filename[:80]!r}")
                continue
            if any(name.startswith(j) or name.endswith("/" + j.rstrip("/")) or name == j.rstrip("/")
                   for j in _JUNK):
                continue
            mode = (info.external_attr >> 16) & 0xFFFF
            if mode and stat.S_ISLNK(mode):
                self.skipped.append(f"symlink: {name[:80]}")
                continue
            if info.flag_bits & 0x1:
                self.skipped.append(f"encrypted: {name[:80]}")
                continue
            if info.file_size > max_entry:
                self.skipped.append(f"too large: {name[:80]}")
                continue
            if info.file_size > RATIO_FLOOR and info.file_size > MAX_RATIO * max(info.compress_size, 1):
                raise Invalid("The archive looks like a zip bomb (compression ratio)")
            total += info.file_size
            if total > max_total:
                raise TooLarge(f"The archive expands to more than {max_total // (1024 * 1024)} MB")
            self._infos[name] = info

    @property
    def names(self) -> list[str]:
        return list(self._infos)

    def read(self, name: str) -> bytes:
        info = self._infos[name]
        try:
            with self._zip.open(info) as handle:
                data = handle.read(info.file_size + 1)
        except (zipfile.BadZipFile, zlib.error, RuntimeError, NotImplementedError, EOFError) as exc:
            raise Invalid(f"The archive entry {name[:60]!r} is damaged") from exc
        if len(data) > info.file_size or len(data) > self.max_entry:
            raise Invalid("The archive looks like a zip bomb (entry larger than declared)")
        return data

    def has(self, name: str) -> bool:
        return name in self._infos

    def resolve(self, base_dir: str, href: str) -> str | None:
        """The entry a relative reference points at (``..`` allowed inside the archive)."""

        from urllib.parse import unquote

        target = unquote(href.split("#")[0].split("?")[0])
        if not target or re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith("/"):
            return None
        joined = posixpath.normpath(posixpath.join(base_dir, target.replace("\\", "/")))
        if joined.startswith("..") or joined == ".":
            return None
        joined = unicodedata.normalize("NFC", joined)
        if joined in self._infos:
            return joined
        folded = {k.casefold(): k for k in self._infos}
        return folded.get(joined.casefold())
