import { FolderUp, Loader2 } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import type { ClientRuntime } from "../rpc/contracts";
import styles from "./FolderPicker.module.css";
import {
  filterChosenFiles,
  MAX_FILE,
  MAX_FILES,
  readDroppedFolder,
  type Upload,
} from "./folderFilter";

const UPLOAD_ATTEMPTS = 3;
// Per request; the server accepts up to 200 files and 24 MiB.
const BATCH_FILES = 100;
const BATCH_BYTES = 8 * 1024 * 1024;

/** Consecutive groups of files, each one upload request. */
function batches(uploads: Upload[]): Upload[][] {
  const groups: Upload[][] = [];
  let current: Upload[] = [];
  let bytes = 0;
  for (const upload of uploads) {
    if (current.length && (current.length >= BATCH_FILES || bytes + upload.file.size > BATCH_BYTES)) {
      groups.push(current);
      current = [];
      bytes = 0;
    }
    current.push(upload);
    bytes += upload.file.size;
  }
  if (current.length) groups.push(current);
  return groups;
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
    const write = runtime.uploadWorkspaceFiles?.bind(runtime);
    if (!write) return;
    const kept = uploads.filter((upload) => upload.file.size <= MAX_FILE);
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
    const queue = batches(kept);
    try {
      // A stalled request is normal now and then on a relayed connection;
      // retry the batch rather than failing the whole folder.
      const sendBatch = async (batch: Upload[]) => {
        for (let attempt = 1; ; attempt += 1) {
          try {
            return await write(batch);
          } catch (cause) {
            // The runtime marks 4xx answers as not retryable; network errors
            // and timeouts carry no code.
            const { code, retryable } = cause as { code?: string; retryable?: boolean };
            const permanent = code !== undefined && !retryable;
            if (permanent || attempt >= UPLOAD_ATTEMPTS)
              throw new Error(
                `Upload failed: ${cause instanceof Error ? cause.message : String(cause)}`,
                { cause },
              );
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          }
        }
      };
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          await sendBatch(next);
          done += next.length;
          setBusy(`Uploading ${done} of ${kept.length} files…`);
        }
      };
      await Promise.all([worker(), worker()]);
      onChoose(`${root}/${kept[0].path.split("/")[0]}`);
    } catch (cause) {
      queue.length = 0; // stop the other worker
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const choose = async (files: File[]) => {
    if (!files.length) return;
    setBusy("Reading folder…");
    try {
      await send(await filterChosenFiles(files));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(null);
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
      await send(await readDroppedFolder(entry as FileSystemDirectoryEntry));
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
            Upload a project folder from this computer into your private
            workspace. Dependencies, caches and build output for any language
            (node_modules, .venv, target, vendor…) and everything in the
            project's .gitignore are left out.
          </p>
        </header>

        <input
          ref={input}
          type="file"
          hidden
          multiple
          // Non-standard attributes React does not type.
          {...{ webkitdirectory: "", directory: "" }}
          onChange={(event) => void choose(Array.from(event.target.files ?? []))}
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
