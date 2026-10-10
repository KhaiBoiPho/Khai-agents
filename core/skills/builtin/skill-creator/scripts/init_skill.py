#!/usr/bin/env python3
"""Scaffold a new Agent Skill folder for Khai-Agents.

Usage:
    init_skill.py <name> [--path DIR] [--description TEXT]
                  [--resources scripts,references,assets]
                  [--interface key=value ...]

Creates <DIR>/<name>/SKILL.md (with placeholders to replace), the requested
resource folders, and agents/openai.yaml when --interface is given.
Exit codes: 0 created, 1 refused (exists or invalid input).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

NAME_RE = re.compile(r"^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")
RESOURCE_DIRS = ("scripts", "references", "assets")
INTERFACE_KEYS = {
    "display_name": 120,
    "short_description": 300,
    "default_prompt": 2000,
    "brand_color": 7,
}
DEFAULT_ROOT = Path(".agents") / "skills"

SKILL_TEMPLATE = """---
name: {name}
description: {description}
---

# {title}

TODO: one sentence on what this skill produces.

## Steps

1. TODO: first concrete action (tool, command or check).
2. TODO: next action.
3. TODO: how to verify the result before presenting it.

## Rules

- TODO: constraints the agent would otherwise get wrong.
{resource_section}"""


def fail(message: str) -> int:
    print(f"Error: {message}")
    return 1


def parse_interface(pairs: list[str]) -> dict[str, str] | str:
    values: dict[str, str] = {}
    for pair in pairs:
        key, sep, value = pair.partition("=")
        key, value = key.strip(), value.strip()
        if not sep or not value:
            return f"--interface expects key=value, got {pair!r}"
        if key not in INTERFACE_KEYS:
            allowed = ", ".join(sorted(INTERFACE_KEYS))
            return f"unknown interface key {key!r} (allowed: {allowed})"
        if len(value) > INTERFACE_KEYS[key]:
            return f"interface.{key} exceeds {INTERFACE_KEYS[key]} characters"
        if key == "brand_color" and not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            return "interface.brand_color must use #RRGGBB"
        values[key] = value
    return values


def yaml_string(value: str) -> str:
    # A JSON string literal is a valid YAML double-quoted scalar.
    return json.dumps(value, ensure_ascii=False)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create a new skill folder.")
    parser.add_argument("name", help="lowercase-hyphenated skill name")
    parser.add_argument(
        "--path",
        default=str(DEFAULT_ROOT),
        help="parent directory (default: .agents/skills in the current directory)",
    )
    parser.add_argument("--description", default="", help="frontmatter description")
    parser.add_argument(
        "--resources",
        default="",
        help="comma-separated folders to create: scripts, references, assets",
    )
    parser.add_argument(
        "--interface",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        help="agents/openai.yaml interface field (repeatable)",
    )
    args = parser.parse_args(argv)

    name = args.name.strip()
    if len(name) > 64 or not NAME_RE.fullmatch(name):
        return fail(
            "name must be 1-64 lowercase letters, digits or single hyphens, "
            "not starting or ending with a hyphen"
        )

    resources = [item.strip() for item in args.resources.split(",") if item.strip()]
    unknown = [item for item in resources if item not in RESOURCE_DIRS]
    if unknown:
        return fail(f"unknown resource folder(s): {', '.join(unknown)}")

    interface = parse_interface(args.interface)
    if isinstance(interface, str):
        return fail(interface)

    description = " ".join(args.description.split()) or (
        f"TODO: what {name} does and when to use it (front-load the trigger words)."
    )
    if len(description) > 1024:
        return fail("description exceeds 1024 characters")

    target = Path(args.path).expanduser() / name
    if target.exists():
        return fail(f"{target} already exists; pick another name or edit it")

    resource_lines = []
    notes = {
        "scripts": "deterministic helpers; run them, do not paste them",
        "references": "detail loaded only when a step needs it",
        "assets": "templates and files copied into outputs",
    }
    for folder in resources:
        resource_lines.append(f"- `{folder}/` — TODO: list files ({notes[folder]}).")
    resource_section = (
        "\n## Resources\n\n" + "\n".join(resource_lines) + "\n" if resource_lines else ""
    )

    target.mkdir(parents=True)
    title = " ".join(part.capitalize() for part in name.split("-"))
    (target / "SKILL.md").write_text(
        SKILL_TEMPLATE.format(
            name=name,
            description=yaml_string(description),
            title=title,
            resource_section=resource_section,
        ),
        encoding="utf-8",
    )
    for folder in resources:
        (target / folder).mkdir()
    if interface:
        (target / "agents").mkdir()
        lines = ["interface:"]
        lines += [f"  {key}: {yaml_string(value)}" for key, value in interface.items()]
        (target / "agents" / "openai.yaml").write_text(
            "\n".join(lines) + "\n", encoding="utf-8"
        )

    print(f"Created {target}")
    print("Next: replace every TODO in SKILL.md, add resources, then run")
    print(f"  python {Path(__file__).parent / 'quick_validate.py'} {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
