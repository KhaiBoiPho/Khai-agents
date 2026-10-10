# Skill writing guide

## Descriptions that route well

Pattern: `<What it does, with the nouns users say>. Use when <situations>.
<Boundary with neighbour skills>.`

- Good: "Turn meeting transcripts into action-item lists with owners and
  dates. Use when the user shares a transcript, call notes or a recording
  summary and asks for follow-ups. Not for writing minutes in full
  (use meeting-minutes)."
- Weak: "A powerful helper for meetings." (no trigger words, no boundary)
- Name file types, tools and verbs explicitly (`.xlsx`, "invoice",
  "reconcile"); synonyms users actually type beat abstract categories.
- Do not claim more than the body delivers; over-broad descriptions steal
  requests from better skills.

## How much freedom to give

| Situation | Write |
| --- | --- |
| Many valid approaches, judgement matters | goals, criteria, one example |
| A preferred approach with some variation | ordered steps with defaults |
| Fragile or exact sequence (formats, migrations, APIs) | exact commands or a script; "do not deviate" |

## Body checklist

- Steps start with a verb and name the tool/command/file.
- Every rule prevents a mistake you have seen or can predict.
- Output location, format and naming are stated.
- A verification step exists and says what to do on failure.
- No duplicated content between SKILL.md and references.
- Cross-skill handoffs name the other skill (`use office-docx for the file`).
- Paths to bundled files are relative to the skill folder.

## Progressive disclosure

- SKILL.md: the route through the job; under ~200 lines.
- references/: one topic per file, a heading per subtopic so a search hits
  the right part; say in SKILL.md *when* to open each file.
- scripts/: executable, `--help` usage, clear exit codes and messages; the
  agent runs them as black boxes.
- assets/: files copied or filled, never loaded for reading.

## Optional `agents/openai.yaml`

```yaml
interface:
  display_name: "Invoice Check"
  short_description: "Check supplier invoices against POs"   # shown in the catalog instead of description, ≤ 300 chars
  default_prompt: "Use $invoice-check on the invoices in inbox/."
  brand_color: "#1F3A5F"
policy:
  allow_implicit_invocation: true    # false = only runs when named with $invoice-check
dependencies:
  tools:
    - type: mcp
      value: "erp"
      description: "ERP MCP server for purchase orders"
```

`short_description` replaces the description in the per-turn catalog, so it
must still carry the trigger words.

## Testing

- Keep 3–5 trigger prompts and 1–2 near-miss prompts with the skill (for
  example in `references/test-prompts.md`) so later edits can be re-checked.
- When output quality matters, write the expected result's key properties
  as a checklist and compare each run against it.
- Change one thing per round so you know what helped.
