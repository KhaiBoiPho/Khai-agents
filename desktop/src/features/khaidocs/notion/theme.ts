/*
 * Original KhaiDocs code, MIT.
 *
 * Mantine theme for KhaiDocs, modelled on AFFiNE's: neutral greys,
 * near-black #141414 text, a #141414 canvas in dark mode, AFFiNE's blue
 * (#1E96EB) as the primary colour, and Inter.
 */

import type { MantineColorsTuple, MantineThemeOverride } from "@mantine/core";

/** Mantine's dark tuple; [7] is the dark body, [8] code blocks/sidebars. */
const dark: MantineColorsTuple = [
  "#e6e6e6", // 0: text
  "#c2c2c2",
  "#9d9d9d", // 2: dimmed
  "#7a7a7a",
  "#2e2e2e", // 4: borders
  "#262626", // 5: hover
  "#1e1e1e", // 6: subtle fills
  "#141414", // 7: body
  "#1a1a1a", // 8: sidebar / code
  "#0f0f0f",
];

/** AFFiNE's neutral greys. */
const gray: MantineColorsTuple = [
  "#fafafa", // 0: sidebar
  "#f4f4f5", // 1: hover
  "#eeeeee", // 2
  "#e6e6e6", // 3: borders
  "#d4d4d4",
  "#a9a9ad",
  "#929292", // 6: placeholder-ish
  "#7a7a7a", // 7: secondary text
  "#4d4d4d",
  "#141414",
];

/** AFFiNE's brand blue, #1E96EB at [6]. */
const blue: MantineColorsTuple = [
  "#e8f4fd",
  "#d0e9fb",
  "#a3d3f7",
  "#72bcf3",
  "#4aa9ef",
  "#319eed",
  "#1e96eb",
  "#0f82d4",
  "#0074be",
  "#0064a6",
];

export const NOTION_FONT_FAMILY =
  '"Inter Variable", Inter, "Source Sans 3 Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';

export const notionThemeOverride: MantineThemeOverride = {
  colors: { dark, gray, blue },
  primaryColor: "blue",
  black: "#141414",
  fontFamily: NOTION_FONT_FAMILY,
  headings: { fontFamily: NOTION_FONT_FAMILY },
};
