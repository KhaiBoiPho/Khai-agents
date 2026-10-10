---
name: skill-creator
description: Create, improve or review Khai skills (SKILL.md folders with optional scripts, references and assets). Use when the user wants a new skill, wants an existing skill changed, wants a repeated workflow captured as a skill, or asks why a skill does not trigger or behave as intended. Scaffolds with init_skill.py and checks with quick_validate.py.
license: Original Khai-Agents content (see repository license)
---

# Skill creator

A skill is a folder whose `SKILL.md` teaches the agent one repeatable job.
Only the `name` + `description` sit in every turn's context; the body loads
when the skill is chosen; files in `references/`, `scripts/`, `assets/` load
only when a step asks for them. Write for that budget.

## 1. Pin down the job

Get from the user (or from the conversation you are capturing):
- 2–3 real requests that should trigger the skill, and one that should not.
- The finished output for one of them, and what "good" looks like.
- Tools, files, commands, conventions and mistakes the agent would not
  know on its own.
Skip questions the conversation already answers. Do not start writing until
you can state the job in one sentence.

## 2. Decide scope and location

- One skill per job. If two requests need different steps, make two skills.
- Check existing skills first (bundled ones are read-only; extend with a new
  skill instead of copying one).
- Location: project skill → `<workspace>/.agents/skills/<name>/`; personal
  skill for every workspace → `~/.agents/skills/<name>/`. Ask if unclear.
- Name: lowercase, digits, single hyphens, ≤ 64 chars, verb or noun phrase
  (`invoice-check`, `release-notes`). Folder name = `name`.

## 3. Scaffold

```bash
python <skill-dir>/scripts/init_skill.py <name> --path <parent-dir> \
  --resources scripts,references --description "<draft description>" \
  [--interface display_name="..." --interface short_description="..."]
```

`<skill-dir>` is this skill's folder (next to this SKILL.md). It refuses to
overwrite an existing folder. `--interface` writes `agents/openai.yaml`
(UI name, short catalog text, default prompt, brand colour).

## 4. Write SKILL.md

Frontmatter: `name`, `description` (required); `license`, `compatibility`
(environment needs, ≤ 500 chars), `metadata` (string→string),
`allowed-tools` (space-separated) only when needed.

**Description** (≤ 1024 chars) decides whether the skill is ever used.
Khai may shorten catalog entries to ~120 characters, so open with the job
and the trigger nouns, then add "Use when …" cases and a "not for …"
boundary if a neighbour skill exists. Third person, no marketing.

**Body**: imperative steps in execution order, each naming the concrete
tool, command, file or check. Then rules for the mistakes the agent would
otherwise make, and the verification before presenting. Leave out what any
capable model already knows. Target < 200 lines; hard ceiling 500 lines and
64 KB. Details, long examples, API tables → `references/<topic>.md`, each
linked from the step that needs it with when to read it.

Use `scripts/` for anything deterministic or fiddly (parsing, conversions,
validation) and tell the agent to run them, not read them. Use `assets/` for
templates copied into outputs. See `references/writing-guide.md` for
description patterns, freedom levels and examples.

## 5. Validate

```bash
python <skill-dir>/scripts/quick_validate.py <path-to-new-skill>
```

Fix every `error:` line (frontmatter rules, name/folder match, leftover
scaffold placeholders, bad `agents/openai.yaml`). Read the `warning:` lines (unmentioned
resource files, long body) and fix those that matter.

## 6. Test with real requests

1. Run each trigger request from step 1 in a fresh turn (or ask the user to)
   and check the skill is selected; run the non-trigger request and check it
   is not.
2. Compare the output with the expected result; note where the agent
   hesitated, guessed or wasted steps.
3. Edit the skill for those points only, re-validate, re-test. Two or three
   rounds are usually enough.

## 7. Improving an existing skill

Read it fully first. Prefer deleting stale or redundant text over adding
more. Keep the folder name and `name` unchanged unless the user asks
(renaming breaks `$name` references). Re-run validation and the trigger
tests after every change, and summarise what changed and why.
