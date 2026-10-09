import { describe, expect, it } from "vitest";

import { filterChosenFiles } from "./folderFilter";

/** Files as `<input webkitdirectory>` lists them for a folder named "app". */
function chosen(files: Record<string, string>): File[] {
  return Object.entries(files).map(([path, text]) => {
    const file = new File([text], path.split("/").at(-1)!);
    Object.defineProperty(file, "webkitRelativePath", { value: `app/${path}` });
    return file;
  });
}

const kept = async (files: Record<string, string>) =>
  (await filterChosenFiles(chosen(files))).map((upload) => upload.path).sort();

describe("filterChosenFiles", () => {
  it("leaves out dependencies and caches of many languages", async () => {
    expect(
      await kept({
        "src/main.py": "",
        ".venv/lib/x.py": "",
        "pkg/__pycache__/m.cpython-312.pyc": "",
        "web/node_modules/react/index.js": "",
        "web/index.ts": "",
        ".git/HEAD": "",
        "android/.gradle/cache.bin": "",
        "ios/Pods/Lib/a.m": "",
        "mobile/.dart_tool/x": "",
        "Foo.class": "",
        ".DS_Store": "",
        "app.egg-info/PKG-INFO": "",
      }),
    ).toEqual(["app/src/main.py", "app/web/index.ts"]);
  });

  it("leaves out generated folders only beside their marker file", async () => {
    expect(
      await kept({
        "rust/Cargo.toml": "",
        "rust/target/debug/app": "",
        "php/composer.json": "",
        "php/vendor/autoload.php": "",
        "go/go.mod": "",
        "go/vendor/lib/lib.go": "",
        "dotnet/App.csproj": "",
        "dotnet/bin/Debug/App.dll": "",
        "scripts/bin/deploy.sh": "",
        "electron/package.json": "",
        "electron/build/icon.png": "",
      }),
    ).toEqual([
      "app/dotnet/App.csproj",
      "app/electron/build/icon.png",
      "app/electron/package.json",
      "app/go/go.mod",
      "app/go/vendor/lib/lib.go",
      "app/php/composer.json",
      "app/rust/Cargo.toml",
      "app/scripts/bin/deploy.sh",
    ]);
  });

  it("applies root and nested .gitignore files like git", async () => {
    expect(
      await kept({
        ".gitignore": "*.log\n/secrets/\n!keep.log\n",
        "server.log": "",
        "keep.log": "",
        "secrets/key.pem": "",
        "src/secrets/readme.md": "",
        "web/.gitignore": "generated/\n",
        "web/generated/api.ts": "",
        "web/app.ts": "",
      }),
    ).toEqual([
      "app/.gitignore",
      "app/keep.log",
      "app/src/secrets/readme.md",
      "app/web/.gitignore",
      "app/web/app.ts",
    ]);
  });
});
