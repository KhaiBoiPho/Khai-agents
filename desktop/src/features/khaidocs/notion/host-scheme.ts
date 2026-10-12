/*
 * Original KhaiDocs code, MIT.
 *
 * Which Mantine colour scheme matches the host's current theme. The root's
 * `color-scheme` is "light dark" when no theme is chosen, so the scheme is
 * read from how light the host canvas colour is (every host theme defines
 * --surface-canvas as #rrggbb or rgb()).
 */

export type HostScheme = "light" | "dark";

export function schemeFromCanvas(canvas: string): HostScheme {
  const value = canvas.trim();
  const hex = value.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})/i);
  let channels: number[];
  if (hex) {
    channels = hex.slice(1).map((part) => parseInt(part, 16));
  } else {
    const parsed = (value.match(/[\d.]+/g) ?? []).map(Number);
    channels = parsed.length >= 3 ? parsed.slice(0, 3) : [255, 255, 255];
  }
  const [r, g, b] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? "dark" : "light";
}

export function readHostScheme(): HostScheme {
  return schemeFromCanvas(
    getComputedStyle(document.documentElement).getPropertyValue("--surface-canvas"),
  );
}
