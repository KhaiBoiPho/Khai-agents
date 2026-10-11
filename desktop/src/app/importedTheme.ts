import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";

export const IMPORTED_THEME_TOKEN_NAMES = [
  "--surface-shell",
  "--surface-canvas",
  "--surface-sidebar",
  "--surface-sidebar-strong",
  "--surface-raised",
  "--surface-overlay",
  "--surface-hover",
  "--surface-selected",
  "--surface-user",
  "--surface-code",
  "--surface-inset",
  "--text-primary",
  "--text-secondary",
  "--text-tertiary",
  "--text-inverse",
  "--text-on-accent",
  "--border-subtle",
  "--border-strong",
  "--border-emphasis",
  "--signal",
  "--signal-strong",
  "--signal-soft",
  "--signal-faint",
  "--success",
  "--success-soft",
  "--attention",
  "--attention-soft",
  "--danger",
  "--danger-soft",
  "--shadow-soft",
  "--shadow-float",
  "--shadow-menu",
] as const;

export type ImportedThemeToken = (typeof IMPORTED_THEME_TOKEN_NAMES)[number];
export type ImportedThemeBase = "light" | "dark";
export type ImportedThemeTokens = Record<ImportedThemeToken, string>;

export interface ImportedTheme {
  name: string;
  base: ImportedThemeBase;
  tokens: ImportedThemeTokens;
}

export class ThemeImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThemeImportError";
  }
}

export const LIGHT_IMPORTED_THEME_BASE: ImportedThemeTokens = {
  "--surface-shell": "#f2f2f2",
  "--surface-canvas": "#ffffff",
  "--surface-sidebar": "#f2f2f2",
  "--surface-sidebar-strong": "#e8e8e8",
  "--surface-raised": "#ffffff",
  "--surface-overlay": "rgb(255 255 255 / 92%)",
  "--surface-hover": "#ebebeb",
  "--surface-selected": "#e3e3e3",
  "--surface-user": "#e9f3fc",
  "--surface-code": "#f5f5f5",
  "--surface-inset": "#ededed",
  "--text-primary": "#0d0d0d",
  "--text-secondary": "#333333",
  "--text-tertiary": "#636363",
  "--text-inverse": "#ffffff",
  "--text-on-accent": "#ffffff",
  "--border-subtle": "#e0e0e0",
  "--border-strong": "#d9d9d9",
  "--border-emphasis": "#a6a6a6",
  "--signal": "#b8560f",
  "--signal-strong": "#9a4710",
  "--signal-soft": "rgb(234 122 42 / 14%)",
  "--signal-faint": "rgb(234 122 42 / 7%)",
  "--success": "#3d7a3a",
  "--success-soft": "#e8f3e7",
  "--attention": "#a35a06",
  "--attention-soft": "#fbefe0",
  "--danger": "#b83c3c",
  "--danger-soft": "#fae8e8",
  "--shadow-soft": "0 1px 2px rgb(0 0 0 / 5%)",
  "--shadow-float": "0 12px 32px rgb(0 0 0 / 10%), 0 2px 6px rgb(0 0 0 / 6%)",
  "--shadow-menu": "0 12px 28px rgb(0 0 0 / 14%), 0 2px 6px rgb(0 0 0 / 8%)",
};

export const DARK_IMPORTED_THEME_BASE: ImportedThemeTokens = {
  "--surface-shell": "#0a0a0a",
  "--surface-canvas": "#0a0a0a",
  "--surface-sidebar": "#171717",
  "--surface-sidebar-strong": "#1f1f1f",
  "--surface-raised": "#1f1f1f",
  "--surface-overlay": "rgb(23 23 23 / 92%)",
  "--surface-hover": "#262626",
  "--surface-selected": "#333333",
  "--surface-user": "#081c26",
  "--surface-code": "#171717",
  "--surface-inset": "#0f0f0f",
  "--text-primary": "#f5f5f5",
  "--text-secondary": "#c4c4c4",
  "--text-tertiary": "#8f8f8f",
  "--text-inverse": "#0a0a0a",
  "--text-on-accent": "#ffffff",
  "--border-subtle": "#262626",
  "--border-strong": "#333333",
  "--border-emphasis": "#555555",
  "--signal": "#ea7a2a",
  "--signal-strong": "#e79255",
  "--signal-soft": "rgb(234 122 42 / 18%)",
  "--signal-faint": "rgb(234 122 42 / 9%)",
  "--success": "#54b04f",
  "--success-soft": "rgb(84 176 79 / 16%)",
  "--attention": "#db7706",
  "--attention-soft": "rgb(219 119 6 / 15%)",
  "--danger": "#d25151",
  "--danger-soft": "rgb(210 81 81 / 15%)",
  "--shadow-soft": "0 1px 2px rgb(0 0 0 / 16%)",
  "--shadow-float":
    "0 20px 52px rgb(0 0 0 / 32%), 0 3px 10px rgb(0 0 0 / 22%)",
  "--shadow-menu":
    "0 20px 46px rgb(0 0 0 / 42%), 0 3px 10px rgb(0 0 0 / 26%)",
};

const DIRECT_MAPPINGS: Partial<
  Record<ImportedThemeToken, readonly string[]>
> = {
  "--surface-shell": ["activityBar.background", "sideBar.background"],
  "--surface-canvas": ["editor.background"],
  "--surface-sidebar": ["sideBar.background"],
  "--surface-sidebar-strong": [
    "sideBarSectionHeader.background",
    "activityBar.background",
  ],
  "--surface-raised": ["editorWidget.background", "panel.background"],
  "--surface-overlay": ["editorWidget.background", "quickInput.background"],
  "--surface-hover": ["list.hoverBackground"],
  "--surface-selected": [
    "list.activeSelectionBackground",
    "list.inactiveSelectionBackground",
  ],
  "--surface-user": [
    "list.inactiveSelectionBackground",
    "editor.selectionBackground",
  ],
  "--surface-code": ["textCodeBlock.background", "editor.background"],
  "--surface-inset": ["input.background"],
  "--text-primary": ["foreground", "editor.foreground"],
  "--text-secondary": ["descriptionForeground"],
  "--text-tertiary": ["disabledForeground"],
  "--text-inverse": ["button.foreground", "activityBar.foreground"],
  "--text-on-accent": ["button.foreground"],
  "--border-subtle": ["widget.border", "panel.border"],
  "--border-strong": ["panel.border", "contrastBorder"],
  "--border-emphasis": ["contrastBorder", "focusBorder"],
  "--signal": ["focusBorder", "button.background"],
  "--signal-strong": ["button.hoverBackground", "focusBorder"],
  "--success": [
    "testing.iconPassed",
    "gitDecoration.addedResourceForeground",
  ],
  "--attention": ["editorWarning.foreground", "list.warningForeground"],
  "--danger": ["errorForeground", "editorError.foreground"],
};

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function parseVsCodeTheme(
  source: string,
  sourceLabel: string,
): ImportedTheme {
  const errors: ParseError[] = [];
  const decoded = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length) {
    throw new ThemeImportError(
      `Invalid JSONC: ${printParseErrorCode(errors[0].error)}`,
    );
  }
  if (!isRecord(decoded)) {
    throw new ThemeImportError("The theme file must contain a JSON object.");
  }
  if ("include" in decoded) {
    throw new ThemeImportError(
      "Theme include chains are not supported yet; import one standalone color-theme file.",
    );
  }
  if (!isRecord(decoded.colors)) {
    throw new ThemeImportError("The theme file must define a colors object.");
  }

  const colors: Record<string, string> = {};
  for (const [name, value] of Object.entries(decoded.colors)) {
    if (typeof value !== "string" || !HEX_COLOR.test(value.trim())) {
      throw new ThemeImportError(
        `Invalid color for ${name}; VS Code theme colors must use hexadecimal notation.`,
      );
    }
    colors[name] = normalizeHex(value.trim());
  }

  const base = inferThemeBase(decoded, colors);
  const tokens: ImportedThemeTokens = {
    ...(base === "dark" ? DARK_IMPORTED_THEME_BASE : LIGHT_IMPORTED_THEME_BASE),
  };
  for (const token of IMPORTED_THEME_TOKEN_NAMES) {
    const mapped = firstColor(colors, DIRECT_MAPPINGS[token] ?? []);
    if (mapped) tokens[token] = mapped;
  }

  const signal = firstColor(colors, ["focusBorder", "button.background"]);
  if (signal) {
    tokens["--signal-soft"] = withAlpha(signal, 0.16);
    tokens["--signal-faint"] = withAlpha(signal, 0.08);
  }
  const success = firstColor(colors, [
    "testing.iconPassed",
    "gitDecoration.addedResourceForeground",
  ]);
  if (success) tokens["--success-soft"] = withAlpha(success, 0.16);
  const attention = firstColor(colors, [
    "editorWarning.foreground",
    "list.warningForeground",
  ]);
  if (attention) tokens["--attention-soft"] = withAlpha(attention, 0.15);
  const danger = firstColor(colors, [
    "errorForeground",
    "editorError.foreground",
  ]);
  if (danger) tokens["--danger-soft"] = withAlpha(danger, 0.15);
  const shadow = colors["widget.shadow"];
  if (shadow) {
    tokens["--shadow-soft"] = `0 1px 2px ${withAlpha(shadow, 0.16)}`;
    tokens["--shadow-float"] =
      `0 18px 48px ${withAlpha(shadow, 0.32)}, ` +
      `0 3px 10px ${withAlpha(shadow, 0.22)}`;
    tokens["--shadow-menu"] =
      `0 18px 42px ${withAlpha(shadow, 0.42)}, ` +
      `0 3px 10px ${withAlpha(shadow, 0.26)}`;
  }

  return {
    name: themeName(decoded.name, sourceLabel),
    base,
    tokens,
  };
}

export function sanitizeImportedTheme(value: unknown): ImportedTheme | null {
  if (!isRecord(value) || !isRecord(value.tokens)) return null;
  const base = value.base === "dark" ? "dark" : value.base === "light" ? "light" : null;
  if (!base) return null;
  const name = typeof value.name === "string" ? value.name.trim().slice(0, 120) : "";
  if (!name) return null;
  const tokens: ImportedThemeTokens = {
    ...(base === "dark" ? DARK_IMPORTED_THEME_BASE : LIGHT_IMPORTED_THEME_BASE),
  };
  for (const token of IMPORTED_THEME_TOKEN_NAMES) {
    const candidate = value.tokens[token];
    if (typeof candidate === "string" && safeStoredValue(candidate)) {
      tokens[token] = candidate.trim();
    }
  }
  return { name, base, tokens };
}

export function applyImportedTheme(
  theme: ImportedTheme | null,
  root: HTMLElement,
): void {
  for (const token of IMPORTED_THEME_TOKEN_NAMES) {
    root.style.removeProperty(token);
  }
  root.style.removeProperty("--imported-color-scheme");
  if (!theme) return;
  root.style.setProperty("--imported-color-scheme", theme.base);
  for (const token of IMPORTED_THEME_TOKEN_NAMES) {
    root.style.setProperty(token, theme.tokens[token]);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstColor(
  colors: Record<string, string>,
  names: readonly string[],
): string | null {
  for (const name of names) {
    if (colors[name]) return colors[name];
  }
  return null;
}

function normalizeHex(value: string): string {
  const raw = value.slice(1).toLowerCase();
  if (raw.length === 3 || raw.length === 4) {
    return `#${[...raw].map((part) => `${part}${part}`).join("")}`;
  }
  return `#${raw}`;
}

function withAlpha(value: string, opacity: number): string {
  const normalized = normalizeHex(value);
  const rgb = normalized.slice(0, 7);
  const sourceAlpha = normalized.length === 9 ? parseInt(normalized.slice(7), 16) / 255 : 1;
  const alpha = Math.round(255 * sourceAlpha * opacity)
    .toString(16)
    .padStart(2, "0");
  return `${rgb}${alpha}`;
}

function inferThemeBase(
  decoded: Record<string, unknown>,
  colors: Record<string, string>,
): ImportedThemeBase {
  const declared = String(decoded.type ?? decoded.uiTheme ?? "").toLowerCase();
  if (declared.includes("dark")) return "dark";
  if (declared.includes("light")) return "light";
  const background = colors["editor.background"];
  if (!background) return "light";
  const rgb = background
    .slice(1, 7)
    .match(/.{2}/g)
    ?.map((part) => parseInt(part, 16) / 255);
  if (!rgb || rgb.length !== 3) return "light";
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return luminance < 0.5 ? "dark" : "light";
}

function themeName(value: unknown, sourceLabel: string): string {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
  const fallback = sourceLabel
    .replace(/\.(?:jsonc?|code-workspace)$/i, "")
    .replace(/[-_]?color[-_]?theme$/i, "")
    .trim();
  return (fallback || "Imported theme").slice(0, 120);
}

function safeStoredValue(value: string): boolean {
  const clean = value.trim().toLowerCase();
  return (
    clean.length > 0 &&
    clean.length <= 240 &&
    !/[;{}]/.test(clean) &&
    !clean.includes("url(") &&
    !clean.includes("var(")
  );
}
