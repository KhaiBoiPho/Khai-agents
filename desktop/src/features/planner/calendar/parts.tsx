/**
 * Small pieces every view shares: the event's glyphs and the assignee
 * avatar stack.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { Lock, Repeat } from "lucide-react";

import { initials, memberById } from "../shared/members";
import styles from "./CalendarPage.module.css";
import type { Occurrence } from "./model";
import { EVENT_ICONS } from "./visuals";

/** Icon, repeat mark and lock before a title — the same glyphs in every view. */
export function Glyphs({ occurrence, size = 12 }: { occurrence: Occurrence; size?: number }) {
  const icon = occurrence.event.icon;
  return (
    <>
      {EVENT_ICONS.map(({ name, Icon }) =>
        name === icon && name !== "calendar" ? (
          <Icon key={name} size={size} className={styles.glyph} aria-hidden="true" />
        ) : null,
      )}
      {occurrence.recurring ? <Repeat size={size - 2} className={styles.glyph} aria-label="Recurring event" /> : null}
      {occurrence.event.visibility === "private" ? (
        <Lock size={size - 2} className={styles.glyph} aria-label="Only me" />
      ) : null}
    </>
  );
}

export function Avatars({ ids, size = 18, max = 3 }: { ids: readonly string[]; size?: number; max?: number }) {
  const members = ids.map((id) => memberById(id)).filter((member) => member !== null);
  if (!members.length) return null;
  const shown = members.slice(0, max);
  const rest = members.length - shown.length;
  return (
    <span className={styles.avatars} style={{ ["--avatar" as string]: `${size}px` }}>
      {shown.map((member) => (
        <span key={member.id} className={styles.avatar} style={{ background: member.color }} title={member.name}>
          {initials(member.name)}
        </span>
      ))}
      {rest > 0 ? <span className={styles.avatarMore}>+{rest}</span> : null}
    </span>
  );
}
