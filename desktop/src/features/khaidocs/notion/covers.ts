/*
 * Original KhaiDocs code, MIT.
 *
 * Page covers. The stock Docmost server has a `coverPhoto` column but its
 * page update endpoint ignores it (checked against docmost/docmost:0.96.0),
 * so KhaiDocs keeps each page's cover choice on this device, in localStorage
 * keyed by page id. A cover is either a built-in one ("g:<id>", CSS
 * gradients written for KhaiDocs) or an image uploaded as an attachment of
 * the page ("img:<url>").
 */

import { useSyncExternalStore } from "react";

export interface BuiltinCover {
  id: string;
  label: string;
  group: "Gradients" | "Colours";
  css: string;
}

export const BUILTIN_COVERS: BuiltinCover[] = [
  { id: "dawn", label: "Dawn", group: "Gradients", css: "linear-gradient(120deg, #f6d5c3 0%, #f3b7a8 45%, #c9a7d8 100%)" },
  { id: "lagoon", label: "Lagoon", group: "Gradients", css: "linear-gradient(120deg, #a8d8e8 0%, #7fb7d6 50%, #5d8fc4 100%)" },
  { id: "meadow", label: "Meadow", group: "Gradients", css: "linear-gradient(120deg, #d9ead3 0%, #a9d3b0 50%, #6fae95 100%)" },
  { id: "dusk", label: "Dusk", group: "Gradients", css: "linear-gradient(120deg, #3a3f6b 0%, #6b4f8a 50%, #c07a92 100%)" },
  { id: "sand", label: "Sand", group: "Gradients", css: "linear-gradient(120deg, #f4ecd8 0%, #e6d3b3 55%, #cfb28b 100%)" },
  { id: "aurora", label: "Aurora", group: "Gradients", css: "linear-gradient(115deg, #0f2027 0%, #203a43 40%, #2c7a6b 75%, #7fd1ae 100%)" },
  { id: "peach", label: "Peach", group: "Gradients", css: "radial-gradient(circle at 20% 30%, #ffe2c6 0%, transparent 55%), radial-gradient(circle at 80% 70%, #f7b8b0 0%, transparent 60%), #fbd3c0" },
  { id: "mist", label: "Mist", group: "Gradients", css: "radial-gradient(circle at 25% 25%, #e3ecf7 0%, transparent 55%), radial-gradient(circle at 75% 80%, #cfd8ea 0%, transparent 60%), #dde4ef" },
  { id: "ink", label: "Ink", group: "Gradients", css: "linear-gradient(135deg, #1e1e24 0%, #2f3542 60%, #485063 100%)" },
  { id: "citrus", label: "Citrus", group: "Gradients", css: "linear-gradient(120deg, #fdf0b6 0%, #f9d77e 50%, #f2a65a 100%)" },
  { id: "lilac", label: "Lilac", group: "Gradients", css: "linear-gradient(120deg, #ece4f7 0%, #d4c2ef 50%, #a993d9 100%)" },
  { id: "forest", label: "Forest", group: "Gradients", css: "linear-gradient(135deg, #1f3b2d 0%, #2f5d46 55%, #5b8c6a 100%)" },
  { id: "solid-red", label: "Red", group: "Colours", css: "#e16259" },
  { id: "solid-orange", label: "Orange", group: "Colours", css: "#e9a15b" },
  { id: "solid-yellow", label: "Yellow", group: "Colours", css: "#f2cf6b" },
  { id: "solid-green", label: "Green", group: "Colours", css: "#6fae8a" },
  { id: "solid-blue", label: "Blue", group: "Colours", css: "#5c95c9" },
  { id: "solid-purple", label: "Purple", group: "Colours", css: "#9b7ccf" },
  { id: "solid-pink", label: "Pink", group: "Colours", css: "#df8db4" },
  { id: "solid-slate", label: "Slate", group: "Colours", css: "#5f6b7a" },
];

export type CoverValue = string;

export type ParsedCover =
  | { kind: "builtin"; cover: BuiltinCover }
  | { kind: "image"; url: string };

export function builtinCoverValue(id: string): CoverValue {
  return `g:${id}`;
}

export function imageCoverValue(url: string): CoverValue {
  return `img:${url}`;
}

/** Only same-origin API file paths and http(s) URLs are accepted as images. */
export function parseCover(value: string | null | undefined): ParsedCover | null {
  if (!value) return null;
  if (value.startsWith("g:")) {
    const cover = BUILTIN_COVERS.find((c) => c.id === value.slice(2));
    return cover ? { kind: "builtin", cover } : null;
  }
  if (value.startsWith("img:")) {
    const url = value.slice(4);
    if (/^\/api\/files\/[\w.~%/-]+$/.test(url) || /^https?:\/\/[^\s"'()]+$/.test(url)) {
      return { kind: "image", url };
    }
  }
  return null;
}

/** CSS `background` for a cover. */
export function coverBackground(parsed: ParsedCover): string {
  return parsed.kind === "builtin"
    ? parsed.cover.css
    : `center / cover no-repeat url("${parsed.url}")`;
}

export function randomBuiltinCover(random = Math.random): BuiltinCover {
  const gradients = BUILTIN_COVERS.filter((c) => c.group === "Gradients");
  return gradients[Math.floor(random() * gradients.length) % gradients.length];
}

// --- Storage -------------------------------------------------------------

export const COVER_KEY_PREFIX = "khaidocs:cover:";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((l) => l());
}

export function getPageCover(pageId: string, s: StorageLike | null = storage()): CoverValue | null {
  try {
    return s?.getItem(COVER_KEY_PREFIX + pageId) ?? null;
  } catch {
    return null;
  }
}

export function setPageCover(
  pageId: string,
  value: CoverValue | null,
  s: StorageLike | null = storage(),
) {
  try {
    if (value) s?.setItem(COVER_KEY_PREFIX + pageId, value);
    else s?.removeItem(COVER_KEY_PREFIX + pageId);
  } catch {
    /* ignore */
  }
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(COVER_KEY_PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePageCover(pageId: string | undefined): CoverValue | null {
  return useSyncExternalStore(
    subscribe,
    () => (pageId ? getPageCover(pageId) : null),
    () => null,
  );
}
