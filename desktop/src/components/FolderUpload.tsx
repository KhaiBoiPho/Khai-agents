import { FolderUp, Loader2 } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import type { ClientRuntime } from "../rpc/contracts";
import styles from "./FolderPicker.module.css";

/** Folders an upload leaves out: dependencies, build output, VCS data. */
const SKIPPED = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  "dist",
  "build",
  "target",
]);
const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILES = 5000;

interface Upload {
  /** Path relative to the workspace root, starting with the folder's name. */
  path: string;
  file: File;
}

interface FolderUploadProps {
  runtime: ClientRuntime;
  /** The user's workspace on the server; the folder lands inside it. */
  root: string;
  onChoose(path: string): void;
  onCancel(): void;
}

/**
 * Hosted web: the user's code lives on their own computer, so opening a
 * folder means uploading it into their private workspace and opening that.
 */
export function FolderUpload({ runtime, root, onChoose, onCancel }: FolderUploadProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const send = async (uploads: Upload[]) => {
    const write = runtime.uploadWorkspaceFile?.bind(runtime);
    if (!write || !uploads.length) return;
    const wanted = uploads.filter(
      (upload) => !upload.path.split("/").slice(0, -1).some((part) => SKIPPED.has(part)),
    );
    const kept = wanted.filter((upload) => upload.file.size <= MAX_FILE);
    if (kept.length > MAX_FILES) {
      setError(`That folder has ${kept.length} files; the limit is ${MAX_FILES}.`);
      return;
    }
    if (!kept.length) {
      setError("That folder has no files to upload.");
      return;
    }
    setError(null);
    let done = 0;
    setBusy(`Uploading 0 of ${kept.length} files…`);
    try {
      const queue = [...kept];
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          await write(next.path, next.file);
          done += 1;
          setBusy(`Uploading ${done} of ${kept.length} files…`);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      onChoose(`${root}/${kept[0].path.split("/")[0]}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const onDrop = async (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const entry = event.dataTransfer.items?.[0]?.webkitGetAsEntry?.();
    if (!entry?.isDirectory) {
      setError("Drop a folder, not a file.");
      return;
    }
    setBusy("Reading folder…");
    try {
      await send(await readDirectory(entry as FileSystemDirectoryEntry));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(null);
    }
  };

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-upload-title"
      >
        <header className={styles.header}>
          <h2 id="folder-upload-title">Open a folder</h2>
          <p>
            Upload a project folder from this computer. It is copied into your
            private workspace; dependencies and build output such as
            node_modules are left out.
          </p>
        </header>

        <input
          ref={input}
          type="file"
          hidden
          multiple
          // Non-standard attributes React does not type.
          {...{ webkitdirectory: "", directory: "" }}
          onChange={(event) =>
            void send(
              Array.from(event.target.files ?? []).map((file) => ({
                path: file.webkitRelativePath,
                file,
              })),
            )
          }
        />
        <button
          type="button"
          className={styles.uploadZone}
          data-dragging={dragging || undefined}
          disabled={busy !== null}
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => void onDrop(event)}
        >
          {busy ? (
            <>
              <Loader2 size={22} className={styles.spin} />
              <span>{busy}</span>
            </>
          ) : (
            <>
              <FolderUp size={22} />
              <strong>Choose a folder</strong>
              <span>or drag one here</span>
            </>
          )}
        </button>

        {error ? <p className={styles.error}>{error}</p> : null}

        <footer className={styles.footer}>
          <span className={styles.choice} />
          <button type="button" onClick={onCancel} disabled={busy !== null}>
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
}

/** Every file under a dropped folder, with paths starting at its name. */
async function readDirectory(directory: FileSystemDirectoryEntry): Promise<Upload[]> {
  const uploads: Upload[] = [];
  const walk = async (folder: FileSystemDirectoryEntry, prefix: string) => {
    const reader = folder.createReader();
    // readEntries returns results in batches until an empty one.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (!batch.length) break;
      for (const entry of batch) {
        const path = `${prefix}/${entry.name}`;
        if (entry.isDirectory) {
          if (!SKIPPED.has(entry.name))
            await walk(entry as FileSystemDirectoryEntry, path);
        } else {
          const file = await new Promise<File>((resolve, reject) =>
            (entry as FileSystemFileEntry).file(resolve, reject),
          );
          uploads.push({ path, file });
        }
        if (uploads.length > MAX_FILES)
          throw new Error(`That folder has more than ${MAX_FILES} files.`);
      }
    }
  };
  await walk(directory, directory.name);
  return uploads;
}
