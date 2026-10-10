#!/usr/bin/env python3
"""Check a skill folder against the Agent Skills v1 rules Khai enforces.

Usage: quick_validate.py <skill-dir> [<skill-dir> ...]

Prints one line per problem; exit 0 when every folder is valid, 1 otherwise.
Warnings (long body, unreferenced resources) do not fail the check.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - PyYAML ships with Khai
    yaml = None

NAME_RE = re.compile(r"^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")
FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", re.S)
ALLOWED_KEYS = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
INTERFACE_LIMITS = {
    "display_name": 120,
    "short_description": 300,
    "default_prompt": 2000,
    "brand_color": 7,
    "icon_small": 500,
    "icon_large": 500,
}
MAX_SKILL_BYTES = 64 * 1024
SOFT_MAX_LINES = 500


def load_yaml(text: str):
    if yaml is not None:
        return yaml.safe_load(text)
    data: dict = {}
    parent = None  # minimal fallback: top-level keys plus one nested level
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.strip().partition(":")
        if not sep:
            continue
        value = value.strip().strip("\"'")
        if line.startswith((" ", "\t")) and isinstance(parent, dict):
            parent[key.strip()] = value
        elif value:
            data[key.strip()], parent = value, None
        else:
            data[key.strip()] = parent = {}
    return data


def check_frontmatter(meta, directory: Path, errors: list[str]) -> None:
    if not isinstance(meta, dict):
        errors.append("frontmatter must be a YAML mapping")
        return
    extra = sorted(set(map(str, meta)) - ALLOWED_KEYS)
    if extra:
        errors.append(f"unsupported frontmatter keys: {', '.join(extra)} "
                      "(put custom fields under metadata:)")
    name = meta.get("name")
    if not isinstance(name, str) or len(name) > 64 or not NAME_RE.fullmatch(name):
        errors.append("name must be 1-64 lowercase letters, digits or single hyphens")
    elif name != directory.name:
        errors.append(f"name {name!r} must match folder name {directory.name!r}")
    description = meta.get("description")
    if not isinstance(description, str) or not description.strip():
        errors.append("description must be a non-empty string")
    else:
        if len(description) > 1024:
            errors.append(f"description is {len(description)} characters (max 1024)")
        if "TODO" in description:
            errors.append("description still contains TODO")
    compatibility = meta.get("compatibility")
    if compatibility is not None and (
        not isinstance(compatibility, str) or not 0 < len(compatibility) <= 500
    ):
        errors.append("compatibility must be a 1-500 character string")
    if "license" in meta and not isinstance(meta["license"], str):
        errors.append("license must be a string")
    custom = meta.get("metadata")
    if custom is not None and (
        not isinstance(custom, dict)
        or any(not isinstance(k, str) or not isinstance(v, str) for k, v in custom.items())
    ):
        errors.append("metadata must map strings to strings")
    tools = meta.get("allowed-tools")
    if tools is not None and (not isinstance(tools, str) or not tools.strip()):
        errors.append("allowed-tools must be a non-empty space-separated string")


def check_openai_yaml(directory: Path, errors: list[str]) -> None:
    path = directory / "agents" / "openai.yaml"
    if not path.is_file():
        return
    try:
        raw = load_yaml(path.read_text(encoding="utf-8")) or {}
    except Exception as exc:  # noqa: BLE001 - report any parse failure
        errors.append(f"agents/openai.yaml does not parse: {exc}")
        return
    if not isinstance(raw, dict):
        errors.append("agents/openai.yaml must be a mapping")
        return
    interface = raw.get("interface") or {}
    if not isinstance(interface, dict):
        errors.append("agents/openai.yaml interface must be a mapping")
        return
    for key, value in interface.items():
        if key not in INTERFACE_LIMITS:
            errors.append(f"agents/openai.yaml: unknown interface key {key!r}")
        elif not isinstance(value, str) or not value.strip():
            errors.append(f"agents/openai.yaml: interface.{key} must be non-empty text")
        elif len(value.strip()) > INTERFACE_LIMITS[key]:
            errors.append(f"agents/openai.yaml: interface.{key} is too long")
        elif key == "brand_color" and not re.fullmatch(r"#[0-9a-fA-F]{6}", value.strip()):
            errors.append("agents/openai.yaml: brand_color must use #RRGGBB")
        elif key.startswith("icon_") and not (directory / value.strip()).is_file():
            errors.append(f"agents/openai.yaml: {key} file not found")
    policy = raw.get("policy") or {}
    if not isinstance(policy, dict) or not isinstance(
        policy.get("allow_implicit_invocation", True), bool
    ):
        errors.append("agents/openai.yaml: policy.allow_implicit_invocation must be a boolean")


def validate(directory: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    skill_file = directory / "SKILL.md"
    if not skill_file.is_file():
        return [f"{skill_file} not found"], warnings
    data = skill_file.read_bytes()
    if len(data) > MAX_SKILL_BYTES:
        errors.append(f"SKILL.md is {len(data)} bytes (max {MAX_SKILL_BYTES})")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return errors + ["SKILL.md must be UTF-8"], warnings
    match = FRONTMATTER_RE.match(text)
    if not match:
        return errors + ["SKILL.md must start with a --- frontmatter block ---"], warnings
    try:
        check_frontmatter(load_yaml(match.group(1)), directory, errors)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"frontmatter does not parse: {exc}")
    body = text[match.end():].strip()
    if not body:
        errors.append("SKILL.md has no instructions after the frontmatter")
    if "TODO" in body:
        errors.append("SKILL.md body still contains TODO placeholders")
    if body.count("\n") + 1 > SOFT_MAX_LINES:
        warnings.append(f"body is over {SOFT_MAX_LINES} lines; move detail to references/")
    for folder in ("scripts", "references", "assets"):
        sub = directory / folder
        if sub.is_dir():
            for item in sorted(p for p in sub.rglob("*") if p.is_file()):
                rel = item.relative_to(directory).as_posix()
                if rel not in text and item.name not in text:
                    warnings.append(f"{rel} is never mentioned in SKILL.md")
    check_openai_yaml(directory, errors)
    return errors, warnings


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__.strip())
        return 1
    ok = True
    for arg in argv:
        directory = Path(arg).expanduser().resolve()
        errors, warnings = validate(directory)
        for warning in warnings:
            print(f"warning: {directory.name}: {warning}")
        for error in errors:
            print(f"error: {directory.name}: {error}")
        if errors:
            ok = False
        else:
            print(f"ok: {directory.name}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
