"""A token-budgeted map of a repository's most important definitions.

The idea and the ranking follow Aider's repo map (Apache-2.0): tags are
extracted per file, cached by modification time, ranked with a personalized
PageRank, and the best definitions are printed as ``path`` followed by the
source line of each definition — enough for an agent to know where things
live before it reads a single file.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from core.codemap.rank import rank_definitions
from core.codemap.tags import LANGUAGES, Tag, extract, supported


def _family(path: str) -> str:
    stem = LANGUAGES.get(Path(path).suffix.lower(), ("", ""))[1]
    return "js" if stem in {"javascript", "typescript"} else stem

MAX_FILE_BYTES = 512 * 1024
MAX_FILES = 6000
SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "env", "__pycache__", "dist",
    "build", "out", "target", ".next", ".nuxt", ".cache", "coverage",
    ".mypy_cache", ".pytest_cache", ".tox", "vendor", ".idea", ".vscode",
}


def _approx_tokens(text: str) -> int:
    return len(text) // 4


@dataclass(frozen=True, slots=True)
class RepoMapResult:
    text: str
    files_scanned: int
    files_total: int
    complete: bool


class RepoMap:
    def __init__(self, root: str | Path, cache_dir: str | Path | None = None):
        self.root = Path(root).expanduser().resolve()
        if cache_dir is None:
            from core.config import deepcode_home

            cache_dir = deepcode_home() / "codemap"
        cache_dir = Path(cache_dir)
        cache_dir.mkdir(parents=True, exist_ok=True)
        key = hashlib.sha256(str(self.root).encode()).hexdigest()[:20]
        self._cache_path = cache_dir / f"{key}.json"
        self._lock = threading.Lock()

    # ---- files --------------------------------------------------------------

    def source_files(self) -> list[str]:
        files: list[str] = []
        try:
            listed = subprocess.run(
                ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                cwd=self.root,
                capture_output=True,
                timeout=15,
                check=True,
            ).stdout.decode("utf-8", "replace")
            files = [path for path in listed.split("\0") if path and supported(path)]
        except (OSError, subprocess.SubprocessError):
            for directory, dirnames, filenames in os.walk(self.root):
                dirnames[:] = [
                    name for name in dirnames
                    if name not in SKIP_DIRS and not name.startswith(".")
                ]
                for name in filenames:
                    if supported(name):
                        full = Path(directory, name)
                        files.append(full.relative_to(self.root).as_posix())
                if len(files) >= MAX_FILES:
                    break
        files = [
            path for path in files
            if not any(part in SKIP_DIRS for part in path.split("/")[:-1])
        ]
        return sorted(files)[:MAX_FILES]

    # ---- tag cache ------------------------------------------------------------

    def _load_cache(self) -> dict[str, list]:
        """path -> [mtime_ns, size, tags]; a missing or corrupt cache is empty."""
        try:
            value = json.loads(self._cache_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return value if isinstance(value, dict) else {}

    def _save_cache(self, cache: dict[str, list]) -> None:
        temporary = self._cache_path.with_name(
            f".{self._cache_path.name}.{os.getpid()}.tmp"
        )
        try:
            temporary.write_text(json.dumps(cache, separators=(",", ":")), encoding="utf-8")
            os.replace(temporary, self._cache_path)
        except OSError:
            temporary.unlink(missing_ok=True)

    def _tags_for(
        self, cache: dict[str, list], path: str
    ) -> tuple[list[Tag], bool] | None:
        """(tags, from_cache) or None when the file cannot be read."""
        full = self.root / path
        try:
            stat = full.stat()
        except OSError:
            return None
        if stat.st_size > MAX_FILE_BYTES:
            return [], True
        entry = cache.get(path)
        if entry and entry[0] == stat.st_mtime_ns and entry[1] == stat.st_size:
            return [Tag(*tag) for tag in entry[2]], True
        try:
            source = full.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None
        tags = extract(path, source)
        cache[path] = [
            stat.st_mtime_ns,
            stat.st_size,
            [(tag.name, tag.kind, tag.line) for tag in tags],
        ]
        return tags, False

    # ---- rendering ------------------------------------------------------------

    def render(
        self,
        *,
        max_tokens: int = 2000,
        focus_files: set[str] = frozenset(),
        mentioned: set[str] = frozenset(),
        time_budget: float | None = None,
    ) -> RepoMapResult:
        started = time.monotonic()
        files = self.source_files()
        defines: dict[str, set[str]] = defaultdict(set)
        references: dict[str, list[str]] = defaultdict(list)
        definition_lines: dict[tuple[str, str], set[int]] = defaultdict(set)
        scanned = 0
        complete = True
        with self._lock:
            cache = self._load_cache()
            changed = False
            try:
                for path in files:
                    if (
                        time_budget is not None
                        and time.monotonic() - started > time_budget
                    ):
                        complete = False
                        break
                    found = self._tags_for(cache, path)
                    if found is None:
                        continue
                    tags, cached = found
                    changed = changed or not cached
                    scanned += 1
                    for tag in tags:
                        if tag.kind == "def":
                            defines[tag.name].add(path)
                            definition_lines[(path, tag.name)].add(tag.line)
                        else:
                            references[tag.name].append(path)
            finally:
                if changed:
                    self._save_cache(cache)

        ranked = rank_definitions(
            defines, references, files[:scanned] if not complete else files,
            focus_files=set(focus_files), mentioned=set(mentioned),
            family=_family,
        )
        text = self._fit(ranked, definition_lines, max_tokens)
        return RepoMapResult(text, scanned, len(files), complete)

    def _fit(self, ranked, definition_lines, max_tokens: int) -> str:
        """Binary-search how many top definitions fit in ``max_tokens``."""
        low, high, best = 1, len(ranked), ""
        while low <= high:
            middle = (low + high) // 2
            text = self._format(ranked[:middle], definition_lines)
            if _approx_tokens(text) <= max_tokens:
                best, low = text, middle + 1
            else:
                high = middle - 1
        return best

    def _format(self, ranked, definition_lines) -> str:
        by_file: dict[str, set[int]] = {}
        order: list[str] = []
        for (path, name), _score in ranked:
            if path not in by_file:
                by_file[path] = set()
                order.append(path)
            by_file[path].update(definition_lines.get((path, name), ()))
        chunks: list[str] = []
        for path in order:
            lines = self._source_lines(path)
            chunks.append(f"{path}:")
            for number in sorted(by_file[path]):
                if 0 <= number < len(lines):
                    snippet = lines[number].rstrip()
                    if len(snippet) > 160:
                        snippet = snippet[:157] + "..."
                    chunks.append(f"{number + 1:>5}│ {snippet}")
        return "\n".join(chunks)

    def _source_lines(self, path: str) -> list[str]:
        try:
            return (self.root / path).read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            return []


def repo_map_section(
    workspace: str | Path, *, max_tokens: int = 1800, time_budget: float = 4.0
) -> str:
    """System-prompt section with the repo map, or "" when there is none."""
    try:
        result = RepoMap(workspace).render(max_tokens=max_tokens, time_budget=time_budget)
    except Exception:  # noqa: BLE001 - the map is a convenience, never a blocker
        return ""
    if not result.text.strip():
        return ""
    note = (
        ""
        if result.complete
        else f" (partial: {result.files_scanned} of {result.files_total} files scanned so far;"
        " the rest is indexed on later turns)"
    )
    return (
        "## Repository map\n"
        "The most-referenced definitions in this workspace, ranked by how the rest "
        "of the code uses them (path, then `line│ source`). Use it to decide what "
        "to open; call `repo_map` with focus files or symbols for a closer view"
        f"{note}.\n\n" + result.text
    )
