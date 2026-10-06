/*
 * Original KhaiDocs code, MIT.
 *
 * Notion-like neutrals for Docmost's Mantine theme: warm near-black text on
 * white in light mode, #191919 canvas with soft grey text in dark mode, and
 * the system UI font stack.
 */

import type { MantineColorsTuple, MantineThemeOverride } from "@mantine/core";

/** Mantine's dark tuple; [7] is the dark body, [8] code blocks/sidebars. */
const dark: MantineColorsTuple = [
  "#d4d4d4", // 0: text
  "#b4b4b4",
  "#9b9b9b", // 2: dimmed
  "#7a7a7a",
  "#3a3a3a", // 4: borders
  "#2f2f2f", // 5: hover
  "#262626", // 6: subtle fills
  "#191919", // 7: body
  "#202020", // 8: sidebar / code
  "#141414",
];

/** Warm greys close to Notion's light UI. */
const gray: MantineColorsTuple = [
  "#f7f7f5", // 0: sidebar
  "#f1f1ef", // 1: hover
  "#ebebe9", // 2
  "#e3e2e0", // 3: borders
  "#d3d1cb",
  "#acaba9",
  "#91918e", // 6: placeholder-ish
  "#787774", // 7: secondary text
  "#5a5955",
  "#37352f",
];

export const NOTION_FONT_FAMILY =
  'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"';

export const notionThemeOverride: MantineThemeOverride = {
  colors: { dark, gray },
  black: "#37352f",
  fontFamily: NOTION_FONT_FAMILY,
  headings: { fontFamily: NOTION_FONT_FAMILY },
};
