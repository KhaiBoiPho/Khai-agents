/* Original KhaiDocs code, MIT. */

import { describe, expect, it } from "vitest";
import {
  ICON_COLORS,
  encodeTablerIcon,
  folderIcon,
  iconAsText,
  isFolderIcon,
  parsePageIcon,
  sortFoldersFirst,
} from "./page-icon-codec";
import { CURATED_ICONS, getCuratedIcon } from "./icon-set";
import { filterIcons } from "./icon-search";
import {
  BUILTIN_COVERS,
  COVER_KEY_PREFIX,
  builtinCoverValue,
  coverBackground,
  getPageCover,
  imageCoverValue,
  parseCover,
  randomBuiltinCover,
  setPageCover,
} from "./covers";
import {
  RECENTS_KEY,
  RECENTS_LIMIT,
  loadRecents,
  recordVisit,
  removeRecentPage,
  updateRecentPage,
  withVisit,
} from "./recents";
import { BUILTIN_TEMPLATES } from "../templates/manifest";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

describe("page icon encoding", () => {
  it("parses emoji, line icons and nothing", () => {
    expect(parsePageIcon("📝")).toEqual({ kind: "emoji", value: "📝" });
    expect(parsePageIcon("ti:notebook:blue")).toEqual({ kind: "tabler", name: "notebook", color: "blue" });
    expect(parsePageIcon("ti:book-2")).toEqual({ kind: "tabler", name: "book-2", color: "default" });
    expect(parsePageIcon(null)).toBeNull();
    expect(parsePageIcon(undefined)).toBeNull();
    expect(parsePageIcon("   ")).toBeNull();
  });

  it("falls back to the default colour and rejects malformed ti: strings", () => {
    expect(parsePageIcon("ti:notebook:chartreuse")).toEqual({ kind: "tabler", name: "notebook", color: "default" });
    expect(parsePageIcon("ti:")).toBeNull();
    expect(parsePageIcon("ti:Bad Name:blue")).toBeNull();
    expect(parsePageIcon("ti:a:b:c")).toBeNull();
  });

  it("round-trips every curated icon in every colour", () => {
    for (const { name } of CURATED_ICONS) {
      for (const color of ICON_COLORS) {
        const encoded = encodeTablerIcon(name, color);
        expect(parsePageIcon(encoded)).toEqual({ kind: "tabler", name, color });
      }
    }
    expect(encodeTablerIcon("notebook")).toBe("ti:notebook");
    expect(() => encodeTablerIcon("No Spaces")).toThrow();
  });

  it("only has text for emoji", () => {
    expect(iconAsText("🚀")).toBe("🚀");
    expect(iconAsText("ti:rocket:red")).toBe("");
    expect(iconAsText(null)).toBe("");
  });
});

describe("curated icon set", () => {
  it("has about 120+ unique, resolvable icons", () => {
    const names = CURATED_ICONS.map((i) => i.name);
    expect(names.length).toBeGreaterThanOrEqual(120);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(getCuratedIcon(name)).toBeTruthy();
    expect(getCuratedIcon("not-an-icon")).toBeNull();
  });

  it("is searchable by name, group and synonyms", () => {
    expect(filterIcons(CURATED_ICONS, "").length).toBe(CURATED_ICONS.length);
    expect(filterIcons(CURATED_ICONS, "money").map((i) => i.name)).toContain("coin");
    expect(filterIcons(CURATED_ICONS, "todo").map((i) => i.name)).toContain("checklist");
    expect(filterIcons(CURATED_ICONS, "BUG").map((i) => i.name)).toContain("bug");
    expect(filterIcons(CURATED_ICONS, "zzzz-nothing")).toEqual([]);
  });

  it("is what the built-in templates use", () => {
    for (const template of BUILTIN_TEMPLATES) {
      const parsed = parsePageIcon(template.icon);
      expect(parsed?.kind).toBe("tabler");
      if (parsed?.kind === "tabler") expect(getCuratedIcon(parsed.name)).toBeTruthy();
    }
  });
});

describe("folders", () => {
  it("are pages with a ti:folder icon", () => {
    expect(folderIcon()).toBe("ti:folder:gray");
    expect(folderIcon("blue")).toBe("ti:folder:blue");
    expect(isFolderIcon("ti:folder")).toBe(true);
    expect(isFolderIcon("ti:folder:green")).toBe(true);
    expect(isFolderIcon("ti:folder-open:green")).toBe(false);
    expect(isFolderIcon("📁")).toBe(false);
    expect(isFolderIcon(null)).toBe(false);
  });

  it("sort first on every level, keeping order otherwise", () => {
    const tree = [
      { id: "a", icon: null, children: [] },
      { id: "f1", icon: "ti:folder", children: [
        { id: "x", icon: "📝" },
        { id: "f3", icon: "ti:folder:red" },
      ] },
      { id: "b", icon: "ti:book" },
      { id: "f2", icon: "ti:folder:blue" },
    ];
    const sorted = sortFoldersFirst(tree as any[]);
    expect(sorted.map((n) => n.id)).toEqual(["f1", "f2", "a", "b"]);
    expect(sorted[0].children.map((n: any) => n.id)).toEqual(["f3", "x"]);
    // input untouched
    expect(tree.map((n) => n.id)).toEqual(["a", "f1", "b", "f2"]);
  });

  it("keeps identity when nothing moves", () => {
    const leaf = { id: "p", icon: null, children: [] };
    const folder = { id: "f", icon: "ti:folder", children: [{ id: "c" }] };
    const tree = [folder, leaf];
    const sorted = sortFoldersFirst(tree);
    expect(sorted).toBe(tree);
    expect(sorted[0]).toBe(folder);
  });
});

describe("covers", () => {
  it("parses built-in and image covers, rejecting anything else", () => {
    const first = BUILTIN_COVERS[0];
    expect(parseCover(builtinCoverValue(first.id))).toEqual({ kind: "builtin", cover: first });
    expect(parseCover("g:nope")).toBeNull();
    expect(parseCover(imageCoverValue("/api/files/abc/photo%20one.png"))).toEqual({
      kind: "image",
      url: "/api/files/abc/photo%20one.png",
    });
    expect(parseCover("img:javascript:alert(1)")).toBeNull();
    expect(parseCover('img:/api/files/a")')).toBeNull();
    expect(parseCover(null)).toBeNull();
  });

  it("gives a CSS background", () => {
    const parsed = parseCover(builtinCoverValue("dawn"))!;
    expect(coverBackground(parsed)).toContain("gradient");
    expect(coverBackground(parseCover("img:/api/files/a/b.png")!)).toContain('url("/api/files/a/b.png")');
  });

  it("are stored per page", () => {
    const s = memoryStorage();
    setPageCover("p1", builtinCoverValue("dusk"), s);
    expect(getPageCover("p1", s)).toBe("g:dusk");
    expect(s.map.has(COVER_KEY_PREFIX + "p1")).toBe(true);
    expect(getPageCover("p2", s)).toBeNull();
    setPageCover("p1", null, s);
    expect(getPageCover("p1", s)).toBeNull();
  });

  it("random covers are gradients", () => {
    expect(randomBuiltinCover(() => 0).group).toBe("Gradients");
    expect(randomBuiltinCover(() => 0.9999).group).toBe("Gradients");
  });
});

describe("recents", () => {
  const page = (id: string) => ({ id, slugId: "s" + id, title: "T" + id, icon: null, spaceSlug: "general" });

  it("puts the latest visit first without duplicates, capped", () => {
    let list = withVisit([], page("1"));
    list = withVisit(list, page("2"));
    list = withVisit(list, page("1"));
    expect(list.map((r) => r.id)).toEqual(["1", "2"]);
    for (let i = 0; i < RECENTS_LIMIT + 5; i++) list = withVisit(list, page(`x${i}`));
    expect(list.length).toBe(RECENTS_LIMIT);
  });

  it("persists, updates and removes", () => {
    const s = memoryStorage();
    recordVisit(page("a"), s);
    recordVisit(page("b"), s);
    expect(loadRecents(s).map((r) => r.id)).toEqual(["b", "a"]);
    updateRecentPage("a", { icon: "ti:bug:red", title: "Bugs" }, s);
    expect(loadRecents(s).find((r) => r.id === "a")).toMatchObject({ icon: "ti:bug:red", title: "Bugs" });
    removeRecentPage("b", s);
    expect(loadRecents(s).map((r) => r.id)).toEqual(["a"]);
  });

  it("ignores corrupt storage", () => {
    const s = memoryStorage();
    s.setItem(RECENTS_KEY, "{not json");
    expect(loadRecents(s)).toEqual([]);
    s.setItem(RECENTS_KEY, JSON.stringify([{ id: 1 }, page("ok") && { ...page("ok"), visitedAt: "2026-10-06T00:00:00Z" }]));
    expect(loadRecents(s).map((r) => r.id)).toEqual(["ok"]);
  });
});

describe("pruneRecents", () => {
  it("drops trashed and deleted pages and keeps live ones", async () => {
    const { pruneRecents, loadRecents, RECENTS_KEY } = await import("./recents");
    const data: Record<string, string> = {};
    const storage = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
    const entry = (id: string) => ({ id, slugId: `s-${id}`, title: id, icon: null, spaceSlug: "general", visitedAt: "2026-10-06T00:00:00Z" });
    storage.setItem(RECENTS_KEY, JSON.stringify([entry("live"), entry("trashed"), entry("gone"), entry("offline")]));
    await pruneRecents(async (id) => {
      if (id === "trashed") return { deletedAt: "2026-10-06" };
      if (id === "gone") throw { response: { status: 404 } };
      if (id === "offline") throw new Error("network");
      return { deletedAt: null };
    }, storage);
    expect(loadRecents(storage).map((r) => r.id)).toEqual(["live", "offline"]);
  });
});
