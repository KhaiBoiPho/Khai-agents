import {
  ArrowUp,
  ChevronRight,
  Folder,
  FolderInput,
  Home,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useState, type DragEvent } from "react";

import type { ClientRuntime } from "../rpc/contracts";
import styles from "./FolderPicker.module.css";

interface Listing {
  path: string;
  parent: string | null;
  entries: Array<{ name: string; path: string }>;
}

interface FolderPickerProps {
  runtime: ClientRuntime;
  onChoose(path: string): void;
  onCancel(): void;
}

/**
 * Folder picker for the web client. Browsers never reveal a dropped
 * folder's absolute path, so the picker browses the service machine through
 * `directory/list`; a dropped folder is matched by name in the open listing.
 */
export function FolderPicker({ runtime, onChoose, onCancel }: FolderPickerProps) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [typed, setTyped] = useState("");

  const load = useCallback(
    async (path?: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = (await runtime.request(
          "directory/list",
          path ? { path } : {},
        )) as Listing;
        setListing(result);
        setSelected(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [runtime],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const item = event.dataTransfer.items?.[0];
    const entry = item?.webkitGetAsEntry?.();
    const name = entry?.name ?? event.dataTransfer.files?.[0]?.name;
    if (!name) return;
    const match = listing?.entries.find((candidate) => candidate.name === name);
    if (match) {
      setSelected(match.path);
      setError(null);
    } else {
      setError(
        `"${name}" is not in ${listing?.path ?? "this folder"}. Browse to the folder that contains it, then drop it again.`,
      );
    }
  };

  const crumbs = listing ? breadcrumbs(listing.path) : [];
  const choice = selected ?? listing?.path ?? null;

  return (
    <div className={styles.backdrop} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-picker-title"
      >
        <header className={styles.header}>
          <h2 id="folder-picker-title">Open a folder</h2>
          <p>Choose a folder on the machine running Khai-Agents.</p>
        </header>

        <div className={styles.crumbs}>
          <button type="button" onClick={() => void load()} title="Home folder">
            <Home size={14} />
          </button>
          <button
            type="button"
            onClick={() => listing?.parent && void load(listing.parent)}
            disabled={!listing?.parent}
            title="Up one level"
          >
            <ArrowUp size={14} />
          </button>
          <div className={styles.path}>
            {crumbs.map((crumb, index) => (
              <span key={crumb.path}>
                {index > 0 ? <ChevronRight size={12} /> : null}
                <button type="button" onClick={() => void load(crumb.path)}>
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
        </div>

        <div
          className={styles.list}
          data-dragging={dragging || undefined}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {loading ? (
            <p className={styles.status}>
              <Loader2 size={14} className={styles.spin} /> Loading…
            </p>
          ) : listing && listing.entries.length === 0 ? (
            <p className={styles.status}>No folders here.</p>
          ) : (
            listing?.entries.map((entry) => (
              <button
                type="button"
                key={entry.path}
                data-selected={entry.path === selected || undefined}
                onClick={() => setSelected(entry.path)}
                onDoubleClick={() => void load(entry.path)}
              >
                <Folder size={15} />
                <span>{entry.name}</span>
                <ChevronRight
                  size={14}
                  className={styles.enter}
                  onClick={(event) => {
                    event.stopPropagation();
                    void load(entry.path);
                  }}
                />
              </button>
            ))
          )}
          <div className={styles.dropHint}>
            <FolderInput size={15} />
            Drag a folder here, or double-click to open one
          </div>
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}

        <form
          className={styles.typed}
          onSubmit={(event) => {
            event.preventDefault();
            if (typed.trim()) void load(typed.trim());
          }}
        >
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Or paste a path and press Enter"
            aria-label="Folder path"
          />
        </form>

        <footer className={styles.footer}>
          <span className={styles.choice} title={choice ?? undefined}>
            {choice ?? ""}
          </span>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={!choice}
            onClick={() => choice && onChoose(choice)}
          >
            Open folder
          </button>
        </footer>
      </section>
    </div>
  );
}

function breadcrumbs(path: string): Array<{ name: string; path: string }> {
  const parts = path.split("/").filter(Boolean);
  const crumbs = [{ name: "/", path: "/" }];
  parts.forEach((part, index) => {
    crumbs.push({ name: part, path: `/${parts.slice(0, index + 1).join("/")}` });
  });
  return crumbs.slice(-5);
}
