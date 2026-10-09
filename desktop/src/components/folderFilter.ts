import ignore, { type Ignore } from "ignore";

/**
 * Which files of a local project folder are worth uploading.
 *
 * Three layers, so an upload carries source and leaves out what tools
 * regenerate: folders that are always generated (any language), folders
 * that are generated only next to a marker file (`vendor/` beside
 * `composer.json` is PHP dependencies, but Go may commit real code there),
 * and every `.gitignore` in the project, applied the way git does.
 */

/** Folder names that only ever hold dependencies, caches or build output. */
const GENERATED = new Set([
  // Version control
  ".git", ".hg", ".svn",
  // JavaScript / TypeScript
  "node_modules", "bower_components", ".next", ".nuxt", ".svelte-kit",
  ".turbo", ".parcel-cache", ".angular", ".expo", ".vercel", ".output",
  // Python
  "__pycache__", ".venv", "venv", ".tox", ".nox", ".mypy_cache",
  ".pytest_cache", ".ruff_cache", ".ipynb_checkpoints", ".eggs",
  // Java / Kotlin / Scala
  ".gradle", ".bsp", ".metals", ".bloop",
  // Dart / Flutter
  ".dart_tool", ".pub-cache",
  // Swift / Apple
  "Pods", "DerivedData", ".swiftpm",
  // Haskell, Zig, Terraform, R, Ruby
  ".stack-work", "dist-newstyle", ".zig-cache", "zig-cache", "zig-out",
  ".terraform", ".Rproj.user", ".bundle",
  // Generic caches and coverage
  ".cache", "coverage", ".nyc_output", "htmlcov",
]);

/** Generated only when the project around them has the given marker. */
const GENERATED_BESIDE: Array<[folder: string, marker: RegExp]> = [
  ["vendor", /^(composer\.json|Gemfile)$/], // PHP Composer, Ruby bundler
  ["deps", /^mix\.exs$/], // Elixir
  ["_build", /^(mix\.exs|rebar\.config|dune-project)$/], // Elixir, Erlang, OCaml
  ["target", /^(Cargo\.toml|pom\.xml|build\.sbt)$/], // Rust, Maven, sbt
  ["build", /^(build\.gradle(\.kts)?|settings\.gradle(\.kts)?|pubspec\.yaml|CMakeLists\.txt|package\.json|setup\.py|pyproject\.toml)$/],
  ["dist", /^(package\.json|setup\.py|pyproject\.toml|.*\.cabal)$/],
  ["out", /^(package\.json|build\.gradle(\.kts)?|.*\.iml)$/],
  ["bin", /\.(csproj|fsproj|vbproj|sln)$/], // .NET
  ["obj", /\.(csproj|fsproj|vbproj|sln)$/], // .NET
  [".build", /^Package\.swift$/], // SwiftPM
];

const GENERATED_PATTERN = [/\.egg-info$/, /^cmake-build-/];

/** Files that are always machine output or OS clutter. */
const JUNK_FILE = /^(\.DS_Store|Thumbs\.db|desktop\.ini)$|\.(pyc|pyo|class|o)$/;

export const MAX_FILE = 10 * 1024 * 1024;
export const MAX_FILES = 5000;

export class FolderFilter {
  /** Directory path ("" for the root) -> its .gitignore rules. */
  private rules = new Map<string, Ignore>();

  addGitignore(directory: string, text: string): void {
    this.rules.set(directory, ignore().add(text));
  }

  /** Whether to skip folder `name` inside `parent`, whose entries are `siblings`. */
  skipsFolder(parent: string, name: string, siblings: string[]): boolean {
    if (GENERATED.has(name) || GENERATED_PATTERN.some((pattern) => pattern.test(name)))
      return true;
    if (
      GENERATED_BESIDE.some(
        ([folder, marker]) => folder === name && siblings.some((sibling) => marker.test(sibling)),
      )
    )
      return true;
    return this.ignored(join(parent, name), true);
  }

  skipsFile(path: string): boolean {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return JUNK_FILE.test(name) || this.ignored(path, false);
  }

  /** Checked against each enclosing folder's .gitignore, as git does. */
  private ignored(path: string, folder: boolean): boolean {
    for (const [directory, rules] of this.rules) {
      if (directory && !path.startsWith(`${directory}/`)) continue;
      const relative = directory ? path.slice(directory.length + 1) : path;
      if (relative && rules.ignores(folder ? `${relative}/` : relative)) return true;
    }
    return false;
  }
}

const join = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);

export interface Upload {
  /** Path relative to the workspace root, starting with the folder's name. */
  path: string;
  file: File;
}

/**
 * Filter the flat file list from `<input webkitdirectory>`. The browser has
 * already listed everything, so every .gitignore is read before deciding.
 */
export async function filterChosenFiles(files: File[]): Promise<Upload[]> {
  if (!files.length) return [];
  const top = files[0].webkitRelativePath.split("/")[0];
  const filter = new FolderFilter();
  // Paths below the chosen folder, e.g. "src/main.py".
  const entries = files.map((file) => ({
    path: file.webkitRelativePath.slice(top.length + 1),
    file,
  }));
  for (const entry of entries) {
    if (entry.path === ".gitignore" || entry.path.endsWith("/.gitignore"))
      filter.addGitignore(entry.path.slice(0, -".gitignore".length - 1), await entry.file.text());
  }
  // Names directly inside each folder, for the marker rules.
  const children = new Map<string, Set<string>>();
  for (const { path } of entries) {
    const parts = path.split("/");
    for (let depth = 0; depth < parts.length; depth += 1) {
      const parent = parts.slice(0, depth).join("/");
      let names = children.get(parent);
      if (!names) children.set(parent, (names = new Set()));
      names.add(parts[depth]);
    }
  }
  const skippedFolder = new Map<string, boolean>();
  const folderSkipped = (folder: string): boolean => {
    const known = skippedFolder.get(folder);
    if (known !== undefined) return known;
    const cut = folder.lastIndexOf("/");
    const parent = cut < 0 ? "" : folder.slice(0, cut);
    const result =
      (parent !== "" && folderSkipped(parent)) ||
      filter.skipsFolder(parent, folder.slice(cut + 1), [...(children.get(parent) ?? [])]);
    skippedFolder.set(folder, result);
    return result;
  };
  return entries
    .filter(({ path }) => {
      const cut = path.lastIndexOf("/");
      return !(cut >= 0 && folderSkipped(path.slice(0, cut))) && !filter.skipsFile(path);
    })
    .map(({ path, file }) => ({ path: `${top}/${path}`, file }));
}

/**
 * Walk a dropped folder, never descending into skipped folders, so a
 * project with a huge node_modules is read quickly.
 */
export async function readDroppedFolder(root: FileSystemDirectoryEntry): Promise<Upload[]> {
  const filter = new FolderFilter();
  const uploads: Upload[] = [];
  const walk = async (folder: FileSystemDirectoryEntry, path: string) => {
    const entries = await readAll(folder);
    const names = entries.map((entry) => entry.name);
    const gitignore = entries.find((entry) => entry.isFile && entry.name === ".gitignore");
    if (gitignore) filter.addGitignore(path, await (await fileOf(gitignore)).text());
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory) {
        if (!filter.skipsFolder(path, entry.name, names))
          await walk(entry as FileSystemDirectoryEntry, child);
      } else if (!filter.skipsFile(child)) {
        uploads.push({ path: `${root.name}/${child}`, file: await fileOf(entry) });
        if (uploads.length > MAX_FILES)
          throw new Error(`That folder has more than ${MAX_FILES} files to upload.`);
      }
    }
  };
  await walk(root, "");
  return uploads;
}

async function readAll(folder: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = folder.createReader();
  const entries: FileSystemEntry[] = [];
  // readEntries returns results in batches until an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (!batch.length) return entries;
    entries.push(...batch);
  }
}

const fileOf = (entry: FileSystemEntry) =>
  new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
