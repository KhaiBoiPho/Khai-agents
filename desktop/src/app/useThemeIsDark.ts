import type { ThemePreference } from "./appearance";
import { useAppearance } from "./useAppearance";
import { useSystemDarkMode } from "./useSystemDarkMode";

const DARK_THEMES: ReadonlySet<ThemePreference> = new Set([
  "dark",
  "midnight",
  "claude-dark",
  "lagoon-dark",
]);

/**
 * Whether the app is showing a dark palette — the chosen theme, or the OS
 * setting only when the theme follows the system. Embedded widgets that
 * theme themselves (Monaco, code highlighting) follow this, so they don't
 * turn dark inside a light theme just because the OS is dark.
 */
export function useThemeIsDark(): boolean {
  const { appearance } = useAppearance();
  const systemDark = useSystemDarkMode();
  if (appearance.theme === "system") return systemDark;
  if (appearance.theme === "imported") {
    return appearance.importedTheme?.base === "dark";
  }
  return DARK_THEMES.has(appearance.theme);
}
