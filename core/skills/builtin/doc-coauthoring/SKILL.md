---
name: doc-coauthoring
description: Collaborative drafting workflow for substantial written documents — proposals, specs, design docs, reports, policies, articles, grant or decision memos. Clarify goal and audience, agree an outline, draft section by section with the user's feedback, run a cold-reader review, then finalise to a file. Use when the user wants to write or co-write a document with you rather than get a one-shot draft.
license: Original Khai-Agents content (see repository license)
---

# Document co-authoring

Work in short rounds; the user steers, you draft. Keep each message about
one step. Skip a step only when the user already supplied what it produces.

## 1. Brief (one message)

Ask only what you cannot infer, at most five questions:
- Goal: what should the reader think, decide or do afterwards?
- Reader: who, how much context they have, how they will read it (skim,
  study, present).
- Type and constraints: format, length, deadline, template, tone, language.
- Material: notes, data, prior docs, links — read every file given before
  drafting.
- Must-say / must-avoid points.
Restate the brief in 3–4 lines and confirm.

## 2. Outline for approval

Propose headings with one line each on what the section must establish and
which evidence supports it. Lead with the conclusion or ask. Flag gaps
("need Q3 churn figure") instead of inventing content. Wait for approval;
apply changes before drafting.

## 3. Draft section by section

- Draft one section (or two short ones) per round; show it, then ask one or
  two targeted questions ("Is the 6-week estimate firm?") rather than "any
  feedback?".
- Fold feedback in and keep a running list of open points and decisions.
- Keep a working copy in the workspace (`drafts/<name>.md`) and update it
  each round, so nothing lives only in chat.
- Style: plain words, short paragraphs, specific numbers with sources,
  active voice, one idea per paragraph, consistent terms.

## 4. Reader test

When all sections exist, review the whole draft as the target reader with no
prior context. If Khai can spawn a sub-agent, give it only the draft and
the reader description; otherwise do the pass yourself. Check:
- Can the reader state the main point and the ask after the first section?
- Undefined terms, acronyms, missing context, unsupported claims?
- Contradictions, repetition, sections that can go?
- Does the length fit how it will be read?
Report the findings as a short list with proposed fixes; apply the ones the
user accepts.

## 5. Finalise

- Final pass: headings parallel, numbers and names consistent, open points
  resolved or explicitly marked.
- Ask for the output format if not set. For docx/pdf/pptx use the matching
  office-* skill with a `document-design` style; Markdown stays as the
  workspace file.
- Present the file path, a two-line summary, and any remaining open points.
