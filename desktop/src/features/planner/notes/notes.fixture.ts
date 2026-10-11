/** Test fixture: the sample notes the board used to start with. */

import type { Note, NoteCategory, NotesData } from "./noteStore";

function daysAgo(days: number, hours = 0): string {
  return new Date(
    Date.now() - days * 86_400_000 - hours * 3_600_000,
  ).toISOString();
}

export function notesFixture(): NotesData {
  const categories: NoteCategory[] = [
    { id: "cat-research", name: "Research", scope: "household" },
    { id: "cat-release", name: "Release", scope: "household" },
    { id: "cat-reading", name: "Reading", scope: "personal" },
  ];
  const notes: Note[] = [
    {
      id: "welcome",
      title: "Welcome to Notes",
      content: [
        "A board for plans, snippets and research next to your chats.",
        "",
        "- [x] Pin the notes you need every day",
        "- [ ] Tick a box right on the card",
        "- [ ] Open a note to switch between **Read** and **Edit**",
        "",
        "Formatting is plain *Markdown* — the toolbar writes it for you.",
      ].join("\n"),
      color: "yellow",
      pinned: true,
      createdBy: "agent",
      categoryIds: [],
      createdAt: daysAgo(6),
      updatedAt: daysAgo(0, 2),
    },
    {
      id: "release",
      title: "Release checklist",
      content: [
        "- [x] Bump the version in core/version.py",
        "- [x] Run the desktop test suite",
        "- [ ] Smoke-test the web build",
        "- [ ] Write the changelog entry",
      ].join("\n"),
      color: "green",
      pinned: true,
      createdBy: "linh",
      categoryIds: ["cat-release"],
      createdAt: daysAgo(3),
      updatedAt: daysAgo(1),
    },
    {
      id: "shell",
      title: "Learning the shell",
      content: [
        "Reading order for `genoffice/apps/shell`:",
        "",
        "1. package.json — scripts and entry point",
        "2. src/main/index.ts — app lifecycle and windows",
        "3. src/main/tab-manager.ts — tabs",
        "4. src/preload — the bridge",
        "5. src/renderer — the UI",
      ].join("\n"),
      color: "blue",
      pinned: false,
      createdBy: "me",
      categoryIds: ["cat-research", "cat-reading"],
      createdAt: daysAgo(5),
      updatedAt: daysAgo(1, 4),
    },
    {
      id: "ideas",
      title: "Ideas",
      content: [
        "- Split view for two chats",
        "- Inline diff comments",
        "- Vietnamese UI",
        "",
        "> Ask the agent to draft a spec for the first one.",
      ].join("\n"),
      color: "purple",
      pinned: false,
      createdBy: "me",
      categoryIds: [],
      createdAt: daysAgo(4),
      updatedAt: daysAgo(2),
    },
    {
      id: "prompt",
      title: null,
      content: [
        "Prompt that worked well for refactors:",
        "",
        "`Keep behaviour identical; list every file you touch first.`",
      ].join("\n"),
      color: "teal",
      pinned: false,
      createdBy: "minh",
      categoryIds: ["cat-research"],
      createdAt: daysAgo(8),
      updatedAt: daysAgo(3),
    },
  ];
  return { notes, categories };
}
