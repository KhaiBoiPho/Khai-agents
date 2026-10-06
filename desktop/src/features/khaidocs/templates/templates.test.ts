/* Original KhaiDocs code, MIT. */

import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES, TEMPLATE_CATEGORIES } from "./manifest";
import {
  buildTemplateDocument,
  fillPlaceholders,
  filterTemplates,
  formatLocalDate,
  pageToTemplateMarkdown,
  splitTitle,
  templateFileName,
} from "./template-markdown";
import {
  USER_TEMPLATES_KEY,
  addUserTemplate,
  deleteUserTemplate,
  loadUserTemplates,
} from "./user-templates";
import { pickDefaultSpace } from "../docmost/lib/khaidocs-mode";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe("built-in template manifest", () => {
  it("has eight templates with unique ids and complete metadata", () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(8);
    expect(new Set(BUILTIN_TEMPLATES.map((t) => t.id)).size).toBe(8);
    for (const template of BUILTIN_TEMPLATES) {
      expect(template.title.trim()).not.toBe("");
      expect(template.description.trim()).not.toBe("");
      expect(template.icon.trim()).not.toBe("");
      expect(TEMPLATE_CATEGORIES).toContain(template.category);
      expect(template.category).not.toBe("My templates");
    }
  });

  it("loads every Markdown file, each starting with a title heading", () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(template.markdown.length).toBeGreaterThan(100);
      expect(splitTitle(template.markdown).title).not.toBe("");
      expect(splitTitle(template.markdown).body).toMatch(/^## |^\*\*/m);
    }
  });
});

describe("template markdown helpers", () => {
  const now = new Date(2026, 9, 6, 9, 30);

  it("fills {{date}} with the local date", () => {
    expect(formatLocalDate(now)).toBe("2026-10-06");
    expect(fillPlaceholders("a {{date}} b {{ date }}", now)).toBe(
      "a 2026-10-06 b 2026-10-06",
    );
  });

  it("splits a leading heading from the body", () => {
    expect(splitTitle("\n# Hello  \n\nBody\n")).toEqual({ title: "Hello", body: "Body" });
    expect(splitTitle("## Not a title\ntext")).toEqual({
      title: "",
      body: "## Not a title\ntext",
    });
    expect(splitTitle("﻿# T\r\nx")).toEqual({ title: "T", body: "x" });
  });

  it("builds the import document with a title heading and file name", () => {
    const doc = buildTemplateDocument(
      { title: "Meeting notes", markdown: "# Meeting — {{date}}\n\n## Agenda" },
      now,
    );
    expect(doc.title).toBe("Meeting — 2026-10-06");
    expect(doc.markdown).toBe("# Meeting — 2026-10-06\n\n## Agenda\n");
    expect(doc.fileName).toBe("Meeting — 2026-10-06.md");

    const untitled = buildTemplateDocument({ title: "Plan", markdown: "Body only" }, now);
    expect(untitled.markdown).toBe("# Plan\n\nBody only\n");
  });

  it("makes safe file names", () => {
    expect(templateFileName('a/b:c*?"<>|d')).toBe("a b c d.md");
    expect(templateFileName("   ")).toBe("Untitled.md");
  });

  it("turns a page into template markdown", () => {
    expect(pageToTemplateMarkdown(" Page ", "\nBody\n")).toBe("# Page\n\nBody\n");
    expect(pageToTemplateMarkdown("", "Body")).toBe("Body\n");
  });

  it("filters by category and every query word", () => {
    expect(filterTemplates(BUILTIN_TEMPLATES, "", "Engineering").map((t) => t.id)).toEqual([
      "technical-design",
      "bug-report",
      "decision-record",
    ]);
    expect(filterTemplates(BUILTIN_TEMPLATES, "ADR").map((t) => t.id)).toEqual([
      "decision-record",
    ]);
    expect(filterTemplates(BUILTIN_TEMPLATES, "weekly plan").map((t) => t.id)).toEqual([
      "weekly-report",
    ]);
    expect(filterTemplates(BUILTIN_TEMPLATES, "zzz")).toEqual([]);
  });
});

describe("user templates in storage", () => {
  it("adds newest first, loads and deletes", () => {
    const storage = new MemoryStorage();
    expect(loadUserTemplates(storage)).toEqual([]);

    const first = addUserTemplate({ title: " One ", markdown: "# One\n" }, storage);
    const second = addUserTemplate(
      { title: "Two", description: "d", icon: "🚀", markdown: "# Two\n" },
      storage,
    );
    expect(first).toMatchObject({ title: "One", icon: "ti:file-text", category: "My templates", user: true });
    const loaded = loadUserTemplates(storage);
    expect(loaded.map((t) => t.title)).toEqual(["Two", "One"]);
    expect(loaded[0]).toMatchObject({ description: "d", icon: "🚀" });

    expect(deleteUserTemplate(second!.id, storage)).toBe(true);
    expect(loadUserTemplates(storage).map((t) => t.id)).toEqual([first!.id]);
  });

  it("survives corrupt, foreign or missing storage", () => {
    const storage = new MemoryStorage();
    storage.setItem(USER_TEMPLATES_KEY, "{not json");
    expect(loadUserTemplates(storage)).toEqual([]);
    storage.setItem(USER_TEMPLATES_KEY, JSON.stringify([{ id: 1 }, null, { id: "x", title: "X", markdown: "m" }]));
    expect(loadUserTemplates(storage).map((t) => t.id)).toEqual(["x"]);

    expect(loadUserTemplates(null)).toEqual([]);
    expect(addUserTemplate({ title: "T", markdown: "" }, null)).toBeNull();

    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(addUserTemplate({ title: "T", markdown: "" }, full)).toBeNull();
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    };
    expect(loadUserTemplates(throwing)).toEqual([]);
  });
});

describe("single-user default space", () => {
  it("picks the oldest space", () => {
    const spaces = [
      { id: "b", createdAt: "2026-02-01T00:00:00Z" },
      { id: "a", createdAt: "2026-01-01T00:00:00Z" },
      { id: "c", createdAt: "2026-01-01T00:00:00Z" },
    ] as unknown as { id: string; createdAt: Date }[];
    expect(pickDefaultSpace(spaces)?.id).toBe("a");
    expect(pickDefaultSpace([])).toBeUndefined();
    expect(pickDefaultSpace(undefined)).toBeUndefined();
  });
});
