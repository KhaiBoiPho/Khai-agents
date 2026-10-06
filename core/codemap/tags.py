"""Definitions and references in one source file.

Tree-sitter with Aider's tag queries (``queries/*-tags.scm``) when the
``tree_sitter`` and ``tree_sitter_language_pack`` packages are installed; a
small regex extractor otherwise, so the repo map still works without them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

QUERY_DIR = Path(__file__).with_name("queries")

# Extension -> (tree-sitter language, query file stem).
LANGUAGES: dict[str, tuple[str, str]] = {
    ".py": ("python", "python"),
    ".pyi": ("python", "python"),
    ".js": ("javascript", "javascript"),
    ".mjs": ("javascript", "javascript"),
    ".cjs": ("javascript", "javascript"),
    ".jsx": ("javascript", "javascript"),
    ".ts": ("typescript", "typescript"),
    ".mts": ("typescript", "typescript"),
    ".cts": ("typescript", "typescript"),
    ".tsx": ("tsx", "typescript"),
    ".go": ("go", "go"),
    ".rs": ("rust", "rust"),
    ".java": ("java", "java"),
    ".kt": ("kotlin", "kotlin"),
    ".scala": ("scala", "scala"),
    ".c": ("c", "c"),
    ".h": ("c", "c"),
    ".cc": ("cpp", "cpp"),
    ".cpp": ("cpp", "cpp"),
    ".cxx": ("cpp", "cpp"),
    ".hpp": ("cpp", "cpp"),
    ".cs": ("csharp", "c_sharp"),
    ".rb": ("ruby", "ruby"),
    ".php": ("php", "php"),
    ".swift": ("swift", "swift"),
    ".dart": ("dart", "dart"),
    ".lua": ("lua", "lua"),
    ".ex": ("elixir", "elixir"),
    ".exs": ("elixir", "elixir"),
    ".hs": ("haskell", "haskell"),
    ".zig": ("zig", "zig"),
    ".jl": ("julia", "julia"),
    ".sh": ("bash", "bash"),
    ".el": ("elisp", "elisp"),
    ".ml": ("ocaml", "ocaml"),
}


@dataclass(frozen=True, slots=True)
class Tag:
    name: str
    kind: str  # "def" | "ref"
    line: int  # 0-based


def supported(path: str) -> bool:
    return Path(path).suffix.lower() in LANGUAGES


def extract(path: str, source: str) -> list[Tag]:
    suffix = Path(path).suffix.lower()
    spec = LANGUAGES.get(suffix)
    if spec is None:
        return []
    tags = _tree_sitter_tags(spec, source)
    if tags is None:
        tags = _regex_tags(suffix, source)
    return tags


# ---- tree-sitter ------------------------------------------------------------


@lru_cache(maxsize=64)
def _compiled(language_name: str, query_stem: str):
    try:
        from tree_sitter import Query
        from tree_sitter_language_pack import get_language, get_parser
    except ImportError:
        return None
    path = QUERY_DIR / f"{query_stem}-tags.scm"
    if not path.is_file():
        return None
    try:
        language = get_language(language_name)
        parser = get_parser(language_name)
        query = Query(language, path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - unknown grammar or query mismatch
        return None
    return parser, query


def _captures(query, node) -> dict[str, list]:
    """Name -> nodes across tree-sitter API generations."""
    try:
        from tree_sitter import QueryCursor  # 0.25+

        return QueryCursor(query).captures(node)
    except ImportError:
        result = query.captures(node)
        if isinstance(result, dict):
            return result
        grouped: dict[str, list] = {}
        for found, name in result:
            grouped.setdefault(name, []).append(found)
        return grouped


def _tree_sitter_tags(spec: tuple[str, str], source: str) -> list[Tag] | None:
    compiled = _compiled(*spec)
    if compiled is None:
        return None
    parser, query = compiled
    try:
        tree = parser.parse(source.encode("utf-8", "replace"))
        groups = _captures(query, tree.root_node)
    except Exception:  # noqa: BLE001
        return None
    tags: list[Tag] = []
    for capture, nodes in groups.items():
        if capture.startswith("name.definition."):
            kind = "def"
        elif capture.startswith("name.reference."):
            kind = "ref"
        else:
            continue
        for node in nodes:
            name = node.text.decode("utf-8", "replace") if node.text else ""
            if name:
                tags.append(Tag(name, kind, node.start_point[0]))
    return tags


# ---- regex fallback ---------------------------------------------------------

_DEF_PATTERNS: dict[str, list[re.Pattern[str]]] = {
    "python": [re.compile(r"^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)")],
    "js": [
        re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)"),
        re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)"),
        re.compile(r"^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)"),
        re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function|[A-Za-z_$][\w$]*\s*=>)"),
    ],
    "go": [re.compile(r"^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)"), re.compile(r"^\s*type\s+([A-Za-z_]\w*)")],
    "rust": [re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|trait|type|mod)\s+([A-Za-z_]\w*)")],
    "java": [re.compile(r"^\s*(?:public|private|protected|static|final|abstract|\s)*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)")],
}
_FAMILY = {
    ".py": "python", ".pyi": "python",
    ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "js",
    ".ts": "js", ".mts": "js", ".cts": "js", ".tsx": "js",
    ".go": "go", ".rs": "rust", ".java": "java", ".kt": "java", ".scala": "java",
}
_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]{2,}")


def _regex_tags(suffix: str, source: str) -> list[Tag]:
    patterns = _DEF_PATTERNS.get(_FAMILY.get(suffix, ""), [])
    tags: list[Tag] = []
    defined_lines: set[int] = set()
    for number, line in enumerate(source.splitlines()):
        for pattern in patterns:
            found = pattern.match(line)
            if found:
                tags.append(Tag(found.group(1), "def", number))
                defined_lines.add(number)
                break
    for number, line in enumerate(source.splitlines()):
        if number in defined_lines:
            continue
        for name in _IDENT.findall(line):
            tags.append(Tag(name, "ref", number))
    return tags
