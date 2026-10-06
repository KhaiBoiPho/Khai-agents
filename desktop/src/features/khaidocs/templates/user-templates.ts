/*
 * Original KhaiDocs code, MIT.
 *
 * "My templates": pages the user saved as templates, kept in this
 * browser's localStorage. Every storage access is guarded — storage can be
 * missing, full or blocked — and a failed read just means no saved templates.
 */

import type { PageTemplate } from "./manifest";

export const USER_TEMPLATES_KEY = "khaidocs.userTemplates.v1";
/** Fired on window when the saved templates change in this tab. */
export const USER_TEMPLATES_EVENT = "khaidocs:user-templates";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function isTemplate(value: unknown): value is PageTemplate {
  const t = value as PageTemplate;
  return (
    !!t &&
    typeof t === "object" &&
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    typeof t.markdown === "string"
  );
}

export function loadUserTemplates(
  storage: StorageLike | null = defaultStorage(),
): PageTemplate[] {
  try {
    const raw = storage?.getItem(USER_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTemplate).map((t) => ({
      id: t.id,
      title: t.title,
      description: typeof t.description === "string" ? t.description : "",
      icon: typeof t.icon === "string" && t.icon ? t.icon : "ti:file-text",
      category: "My templates" as const,
      markdown: t.markdown,
      user: true,
      createdAt: typeof t.createdAt === "string" ? t.createdAt : undefined,
    }));
  } catch {
    return [];
  }
}

function write(templates: PageTemplate[], storage: StorageLike | null): boolean {
  try {
    if (!storage) return false;
    storage.setItem(USER_TEMPLATES_KEY, JSON.stringify(templates));
  } catch {
    return false;
  }
  try {
    window.dispatchEvent(new Event(USER_TEMPLATES_EVENT));
  } catch {
    // no window (tests); nothing to notify
  }
  return true;
}

function newId(): string {
  try {
    return `user-${crypto.randomUUID()}`;
  } catch {
    return `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export interface NewUserTemplate {
  title: string;
  description?: string;
  icon?: string | null;
  markdown: string;
}

/**
 * Saves a template, newest first. Returns it, or null when storage is
 * unavailable or full.
 */
export function addUserTemplate(
  input: NewUserTemplate,
  storage: StorageLike | null = defaultStorage(),
  now: Date = new Date(),
): PageTemplate | null {
  const template: PageTemplate = {
    id: newId(),
    title: input.title.trim() || "Untitled",
    description: input.description?.trim() ?? "",
    icon: input.icon || "ti:file-text",
    category: "My templates",
    markdown: input.markdown,
    user: true,
    createdAt: now.toISOString(),
  };
  const ok = write([template, ...loadUserTemplates(storage)], storage);
  return ok ? template : null;
}

/** Removes a saved template; returns whether storage was updated. */
export function deleteUserTemplate(
  id: string,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  const remaining = loadUserTemplates(storage).filter((t) => t.id !== id);
  return write(remaining, storage);
}
