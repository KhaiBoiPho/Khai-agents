/*
 * Original KhaiDocs code, MIT.
 *
 * One component for every page icon: an emoji, a curated line icon
 * ("ti:<name>:<colour>", see ./page-icon-codec) or, with no icon, a quiet
 * page/folder glyph.
 */

import type { CSSProperties } from "react";
import {
  IconFileText,
  IconFolder,
  IconFolderOpen,
  IconTable,
} from "@tabler/icons-react";
import { FOLDER_ICON_NAME, IconColor, parsePageIcon } from "./page-icon-codec";
import { getCuratedIcon } from "./icon-set";

export function iconColorVar(color: IconColor): string {
  return `var(--kd-icon-${color})`;
}

export interface PageIconProps {
  icon?: string | null;
  /** Box size in px. */
  size?: number;
  isBase?: boolean;
  /** Folders render as an open folder (expanded in the sidebar). */
  open?: boolean;
  /** What to draw with no icon: a page glyph (default) or nothing. */
  fallback?: "page" | "none";
  className?: string;
  style?: CSSProperties;
}

export function PageIcon({
  icon,
  size = 18,
  isBase,
  open,
  fallback = "page",
  className,
  style,
}: PageIconProps) {
  const parsed = parsePageIcon(icon);
  const box: CSSProperties = {
    width: size,
    height: size,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    lineHeight: 1,
    ...style,
  };
  const stroke = size >= 40 ? 1.4 : size >= 24 ? 1.6 : 1.75;

  if (parsed?.kind === "emoji") {
    return (
      <span
        className={className}
        style={{ ...box, fontSize: Math.round(size * 0.92) }}
        aria-hidden
        data-kd-page-icon="emoji"
      >
        {parsed.value}
      </span>
    );
  }

  if (parsed?.kind === "tabler") {
    const isFolder = parsed.name === FOLDER_ICON_NAME;
    const Glyph = isFolder
      ? open
        ? IconFolderOpen
        : IconFolder
      : getCuratedIcon(parsed.name) ?? IconFileText;
    return (
      <span className={className} style={box} aria-hidden data-kd-page-icon="icon">
        <Glyph size={size} stroke={stroke} color={iconColorVar(parsed.color)} />
      </span>
    );
  }

  if (fallback === "none") return null;
  const Glyph = isBase ? IconTable : IconFileText;
  return (
    <span className={className} style={box} aria-hidden data-kd-page-icon="none">
      <Glyph size={size} stroke={stroke} color="var(--kd-icon-muted)" />
    </span>
  );
}

export default PageIcon;
