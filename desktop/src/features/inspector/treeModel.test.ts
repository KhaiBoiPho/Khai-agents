import { describe, expect, it } from "vitest";

import type { FileEntry } from "../../generated/app-server";
import { ancestorsOf, buildTree, directoryPaths, filterTree } from "./treeModel";

const entry = (path: string, kind: FileEntry["kind"] = "file"): FileEntry =>
  ({ path, name: path.split("/").at(-1)!, kind }) as FileEntry;

const names = (nodes: ReturnType<typeof buildTree>) => nodes.map((node) => node.name);

describe("buildTree", () => {
  it("nests paths with folders first and natural order", () => {
    const tree = buildTree([
      entry("README.md"),
      entry("src", "directory"),
      entry("src/file10.ts"),
      entry("src/file2.ts"),
      entry("src/lib", "directory"),
      entry("src/lib/a.ts"),
      entry(".env"),
    ]);
    expect(names(tree)).toEqual(["src", ".env", "README.md"]);
    expect(names(tree[0].children)).toEqual(["lib", "file2.ts", "file10.ts"]);
    expect(names(tree[0].children[0].children)).toEqual(["a.ts"]);
  });

  it("keeps a file whose folder entry was cut off by the listing limit", () => {
    const tree = buildTree([entry("deep/inner/x.py")]);
    expect(tree[0].path).toBe("deep");
    expect(tree[0].children[0].path).toBe("deep/inner");
    expect(tree[0].children[0].children[0].path).toBe("deep/inner/x.py");
  });
});

describe("filterTree", () => {
  const tree = buildTree([
    entry("app", "directory"),
    entry("app/voice", "directory"),
    entry("app/voice/stt.py"),
    entry("app/voice/tts.py"),
    entry("app/main.py"),
  ]);

  it("keeps matching files with their folders", () => {
    const filtered = filterTree(tree, "STT");
    expect(names(filtered)).toEqual(["app"]);
    expect(names(filtered[0].children)).toEqual(["voice"]);
    expect(names(filtered[0].children[0].children)).toEqual(["stt.py"]);
  });

  it("returns everything for an empty query", () => {
    expect(filterTree(tree, "  ")).toHaveLength(1);
  });
});

describe("paths", () => {
  it("lists ancestors outermost first", () => {
    expect(ancestorsOf("a/b/c.ts")).toEqual(["a", "a/b"]);
    expect(ancestorsOf("top.ts")).toEqual([]);
  });

  it("collects every folder", () => {
    const tree = buildTree([entry("a/b/c.ts"), entry("d/e.ts")]);
    expect(directoryPaths(tree)).toEqual(["a", "a/b", "d"]);
  });
});
