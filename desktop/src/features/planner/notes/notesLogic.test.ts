import { describe, expect, it } from "vitest";

import { matchChecklistLine, toggleChecklistLine } from "./checklist";
import { applyFormat } from "./markdownFormat";
import {
  EMPTY_FILTER,
  filterNotes,
  normalizeNotesData,
  noteName,
  seedNotes,
  sortNotes,
  type Note,
} from "./noteStore";

function note(partial: Partial<Note> & { id: string }): Note {
  return {
    title: null,
    content: "",
    color: "yellow",
    pinned: false,
    createdBy: "me",
    categoryIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("checklist toggling in the Markdown source", () => {
  const source = "# Shopping\n- [ ] Milk\n- [x] Bread\n- [ ] Milk\nnot a box";

  it("ticks exactly the indexed line, even when another line has the same text", () => {
    const result = toggleChecklistLine(source, 3, true, "- [ ] Milk");
    expect(result).toEqual({
      ok: true,
      changed: true,
      content: "# Shopping\n- [ ] Milk\n- [x] Bread\n- [x] Milk\nnot a box",
    });
  });

  it("unticks, and treats an already-matching state as a no-op", () => {
    const untick = toggleChecklistLine(source, 2, false);
    expect(untick.ok && untick.content).toBe(
      "# Shopping\n- [ ] Milk\n- [ ] Bread\n- [ ] Milk\nnot a box",
    );
    expect(toggleChecklistLine(source, 2, true)).toEqual({
      ok: true,
      changed: false,
      content: source,
    });
  });

  it("keeps CRLF line endings of untouched lines", () => {
    const crlf = "- [ ] a\r\n- [ ] b\r\n";
    const result = toggleChecklistLine(crlf, 1, true);
    expect(result.ok && result.content).toBe("- [ ] a\r\n- [x] b\r\n");
  });

  it("refuses stale, out-of-range and non-checklist lines", () => {
    expect(toggleChecklistLine(source, 1, true, "- [ ] Eggs")).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(toggleChecklistLine(source, 99, true)).toEqual({
      ok: false,
      reason: "out_of_range",
    });
    expect(toggleChecklistLine(source, 4, true)).toEqual({
      ok: false,
      reason: "not_a_checklist_line",
    });
  });

  it("recognises nested and numbered task items", () => {
    expect(matchChecklistLine("    - [X] nested")?.checked).toBe(true);
    expect(matchChecklistLine("2. [ ] numbered")?.text).toBe("numbered");
    expect(matchChecklistLine("- [ ]")).toBeNull();
  });
});

describe("search, filter and ordering", () => {
  const notes = [
    note({
      id: "a",
      title: "Groceries",
      content: "milk",
      updatedAt: "2026-01-03T00:00:00Z",
    }),
    note({
      id: "b",
      content: "Deploy the APP",
      createdBy: "linh",
      categoryIds: ["c1", "c2"],
      createdAt: "2026-01-05T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    }),
    note({
      id: "c",
      title: "Archive",
      content: "old",
      pinned: true,
      categoryIds: ["c1"],
      updatedAt: "2026-01-01T00:00:00Z",
    }),
  ];

  it("searches title and content case-insensitively", () => {
    expect(
      filterNotes(notes, { ...EMPTY_FILTER, query: "  app " }).map((n) => n.id),
    ).toEqual(["b"]);
    expect(
      filterNotes(notes, { ...EMPTY_FILTER, query: "GROC" }).map((n) => n.id),
    ).toEqual(["a"]);
  });

  it("filters by creator and requires every selected category", () => {
    expect(
      filterNotes(notes, { ...EMPTY_FILTER, creator: "linh" }).map((n) => n.id),
    ).toEqual(["b"]);
    expect(
      filterNotes(notes, { ...EMPTY_FILTER, categoryIds: ["c1"] }).map(
        (n) => n.id,
      ),
    ).toEqual(["b", "c"]);
    expect(
      filterNotes(notes, { ...EMPTY_FILTER, categoryIds: ["c1", "c2"] }).map(
        (n) => n.id,
      ),
    ).toEqual(["b"]);
  });

  it("puts pinned notes first, then sorts by the chosen key", () => {
    expect(sortNotes(notes).map((n) => n.id)).toEqual(["c", "a", "b"]);
    expect(sortNotes(notes, "created").map((n) => n.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(sortNotes(notes, "title").map((n) => n.id)).toEqual(["c", "b", "a"]);
  });

  it("names untitled notes by their first line without Markdown marks", () => {
    expect(noteName({ title: null, content: "\n- [ ] **Buy** milk" })).toBe(
      "Buy milk",
    );
    expect(noteName({ title: "  ", content: "" })).toBe("Note");
  });

  it("repairs a stale stored shape", () => {
    const seed = seedNotes();
    expect(normalizeNotesData([1, 2], seed)).toBe(seed);
    const repaired = normalizeNotesData(
      {
        categories: [{ id: "c1", name: "Work", scope: "household" }],
        notes: [
          {
            id: "x",
            content: "hi",
            color: "#FF0000",
            categoryIds: ["c1", "gone"],
          },
          null,
        ],
      },
      seed,
    );
    expect(repaired.notes).toHaveLength(1);
    expect(repaired.notes[0]).toMatchObject({
      color: "yellow",
      pinned: false,
      categoryIds: ["c1"],
    });
  });
});

describe("markdown toolbar formats", () => {
  it("wraps the selection and selects the inner text", () => {
    expect(applyFormat("say hi", 4, 6, "bold")).toEqual({
      value: "say **hi**",
      selectionStart: 6,
      selectionEnd: 8,
    });
  });

  it("starts a checklist item on a fresh line", () => {
    expect(applyFormat("Milk", 4, 4, "checklist").value).toBe("Milk\n- [ ] ");
    expect(applyFormat("", 0, 0, "checklist").value).toBe("- [ ] ");
  });

  it("renumbers a selection instead of double-prefixing", () => {
    expect(applyFormat("3. a\nb", 0, 6, "ordered-list").value).toBe(
      "1. a\n2. b",
    );
  });

  it("cycles heading levels", () => {
    expect(applyFormat("Title", 2, 2, "heading").value).toBe("## Title");
    expect(applyFormat("### Title", 2, 2, "heading").value).toBe("Title");
  });
});
