/*
 * Original KhaiDocs code, MIT.
 *
 * Mantine theme for KhaiDocs. It carries no palette of its own: colours come
 * from the host's design tokens (src/styles/tokens.css) through the CSS
 * variables in `hostCssVariables`, so every host theme (light, dark, paper,
 * midnight, ...) applies live, and the accent is the host's monochrome signal.
 */

import type { MantineColorsTuple, MantineThemeOverride } from "@mantine/core";

/** The host font stack: the user's preferred family, then Source Sans 3. */
export const HOST_FONT_FAMILY =
  'var(--font-ui-preferred) "Source Sans 3 Variable", "Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/**
 * Static stand-in for Mantine's JS-side colour maths. Every colour that is
 * painted comes from `hostCssVariables`, not from these values.
 */
const signal: MantineColorsTuple = [
  "#f5f5f5",
  "#ebebeb",
  "#e0e0e0",
  "#cfcfcf",
  "#a6a6a6",
  "#636363",
  "#333333",
  "#1a1a1a",
  "#0d0d0d",
  "#000000",
];

export const hostThemeOverride: MantineThemeOverride = {
  colors: { signal, blue: signal },
  primaryColor: "signal",
  primaryShade: 6,
  black: "var(--text-primary)",
  white: "var(--surface-raised)",
  fontFamily: HOST_FONT_FAMILY,
  fontFamilyMonospace: "var(--font-mono)",
  headings: { fontFamily: HOST_FONT_FAMILY },
  defaultRadius: "md",
  radius: { xs: "3px", sm: "4px", md: "6px", lg: "8px", xl: "10px" },
  shadows: {
    xs: "var(--shadow-soft)",
    sm: "var(--shadow-soft)",
    md: "var(--shadow-menu)",
    lg: "var(--shadow-float)",
    xl: "var(--shadow-float)",
  },
};

/**
 * Mantine's semantic and palette variables, pointed at host tokens. The gray
 * and dark ramps are remapped by role (lightest-to-darkest for gray, the text
 * ramp then the surface ramp for dark) so the client's
 * `light-dark(gray-N, dark-N)` rules land on host surfaces in any theme.
 */
export const hostCssVariables: Record<string, string> = {
  "--mantine-color-body": "var(--surface-raised)",
  "--mantine-color-text": "var(--text-primary)",
  "--mantine-color-bright": "var(--text-primary)",
  "--mantine-color-dimmed": "var(--text-tertiary)",
  "--mantine-color-placeholder": "var(--text-tertiary)",
  "--mantine-color-anchor": "var(--text-primary)",
  "--mantine-color-error": "var(--danger)",
  "--mantine-color-default": "var(--surface-raised)",
  "--mantine-color-default-hover": "var(--surface-hover)",
  "--mantine-color-default-color": "var(--text-primary)",
  "--mantine-color-default-border": "var(--border-strong)",
  "--mantine-color-disabled": "var(--surface-inset)",
  "--mantine-color-disabled-color": "var(--text-tertiary)",
  "--mantine-color-disabled-border": "var(--border-subtle)",

  "--mantine-primary-color-filled": "var(--signal)",
  "--mantine-primary-color-filled-hover": "var(--signal-strong)",
  "--mantine-primary-color-light": "var(--signal-soft)",
  "--mantine-primary-color-light-hover": "var(--signal-soft)",
  "--mantine-primary-color-light-color": "var(--text-primary)",
  "--mantine-primary-color-outline-hover": "var(--signal-faint)",
  "--mantine-primary-color-contrast": "var(--text-on-accent)",

  "--mantine-color-gray-0": "var(--surface-inset)",
  "--mantine-color-gray-1": "var(--surface-hover)",
  "--mantine-color-gray-2": "var(--surface-selected)",
  "--mantine-color-gray-3": "var(--border-strong)",
  "--mantine-color-gray-4": "var(--border-strong)",
  "--mantine-color-gray-5": "var(--border-emphasis)",
  "--mantine-color-gray-6": "var(--text-tertiary)",
  "--mantine-color-gray-7": "var(--text-secondary)",
  "--mantine-color-gray-8": "var(--text-primary)",
  "--mantine-color-gray-9": "var(--text-primary)",
  "--mantine-color-gray-filled": "var(--text-tertiary)",
  "--mantine-color-gray-filled-hover": "var(--text-secondary)",
  "--mantine-color-gray-light": "var(--surface-hover)",
  "--mantine-color-gray-light-hover": "var(--surface-selected)",
  "--mantine-color-gray-light-color": "var(--text-secondary)",
  "--mantine-color-gray-outline": "var(--text-secondary)",
  "--mantine-color-gray-outline-hover": "var(--surface-hover)",

  "--mantine-color-dark-0": "var(--text-primary)",
  "--mantine-color-dark-1": "var(--text-secondary)",
  "--mantine-color-dark-2": "var(--text-tertiary)",
  "--mantine-color-dark-3": "var(--text-tertiary)",
  "--mantine-color-dark-4": "var(--border-strong)",
  "--mantine-color-dark-5": "var(--surface-hover)",
  "--mantine-color-dark-6": "var(--surface-raised)",
  "--mantine-color-dark-7": "var(--surface-canvas)",
  "--mantine-color-dark-8": "var(--surface-code)",
  "--mantine-color-dark-9": "var(--surface-shell)",
  "--mantine-color-dark-filled": "var(--text-primary)",
  "--mantine-color-dark-filled-hover": "var(--text-secondary)",
  "--mantine-color-dark-light": "var(--surface-hover)",
  "--mantine-color-dark-light-hover": "var(--surface-selected)",
  "--mantine-color-dark-light-color": "var(--text-primary)",
  "--mantine-color-dark-outline": "var(--text-primary)",
  "--mantine-color-dark-outline-hover": "var(--surface-hover)",

  // The host has no blue: anything the client paints "blue" is the signal.
  "--mantine-color-blue-0": "var(--signal-faint)",
  "--mantine-color-blue-1": "var(--signal-soft)",
  "--mantine-color-blue-2": "var(--signal-soft)",
  "--mantine-color-blue-3": "var(--border-emphasis)",
  "--mantine-color-blue-4": "var(--signal)",
  "--mantine-color-blue-5": "var(--signal)",
  "--mantine-color-blue-6": "var(--signal)",
  "--mantine-color-blue-7": "var(--signal-strong)",
  "--mantine-color-blue-8": "var(--signal-strong)",
  "--mantine-color-blue-9": "var(--signal-strong)",
  "--mantine-color-blue-filled": "var(--signal)",
  "--mantine-color-blue-filled-hover": "var(--signal-strong)",
  "--mantine-color-blue-light": "var(--signal-soft)",
  "--mantine-color-blue-light-hover": "var(--signal-soft)",
  "--mantine-color-blue-light-color": "var(--text-primary)",
  "--mantine-color-blue-outline": "var(--signal)",
  "--mantine-color-blue-outline-hover": "var(--signal-faint)",

  "--mantine-color-red-filled": "var(--danger)",
  "--mantine-color-red-light": "var(--danger-soft)",
  "--mantine-color-red-light-color": "var(--danger)",
  "--mantine-color-green-filled": "var(--success)",
  "--mantine-color-green-light": "var(--success-soft)",
  "--mantine-color-green-light-color": "var(--success)",
  "--mantine-color-orange-light": "var(--attention-soft)",
  "--mantine-color-orange-light-color": "var(--attention)",
  "--mantine-color-yellow-light": "var(--attention-soft)",
  "--mantine-color-yellow-light-color": "var(--attention)",
};
