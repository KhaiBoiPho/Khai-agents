import { CalendarClock, Clock } from "lucide-react";

import { initials, memberById } from "../shared/members";
import { dueLabel, formatDay, isScheduledLater, tagHue, tagKey } from "./taskModel";
import { priorityLabel, type Priority, type Task } from "./types";

import styles from "./bits.module.css";

export function PriorityBadge({ priority, compact = false }: { priority: Priority; compact?: boolean }) {
  if (priority === "none") return null;
  return (
    <span className={styles.priority} data-priority={priority} title={`${priorityLabel(priority)} priority`}>
      <span className={styles.priorityDot} aria-hidden="true" />
      {compact ? <span className={styles.srOnly}>{priorityLabel(priority)} priority</span> : priorityLabel(priority)}
    </span>
  );
}

export function DueBadge({ task, now }: { task: Task; now: Date }) {
  const due = dueLabel(task, now);
  if (!due) return null;
  return (
    <span className={styles.meta} data-tone={due.tone}>
      <Clock size={12} aria-hidden="true" />
      <span className={styles.ellipsis}>{due.label}</span>
    </span>
  );
}

export function StartBadge({ task, now }: { task: Task; now: Date }) {
  if (!task.startDate || !isScheduledLater(task, now)) return null;
  return (
    <span className={styles.meta}>
      <CalendarClock size={12} aria-hidden="true" />
      Starts {formatDay(task.startDate, now)}
    </span>
  );
}

export function TagChip({
  tag,
  active,
  onClick,
}: {
  tag: string;
  active?: boolean;
  onClick?: (tag: string) => void;
}) {
  if (!onClick) {
    return (
      <span className={styles.tag} data-hue={tagHue(tag)}>
        {tag}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={styles.tag}
      data-hue={tagHue(tag)}
      aria-pressed={active}
      title={active ? `Stop filtering by ${tag}` : `Filter by ${tag}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick(tag);
      }}
    >
      {tag}
    </button>
  );
}

/** A few chips, then "+N" — the rest stays one click away in the detail. */
export function TagChips({
  tags,
  limit,
  activeTags = [],
  onTagClick,
}: {
  tags: string[];
  limit: number;
  activeTags?: string[];
  onTagClick?: (tag: string) => void;
}) {
  if (!tags.length) return null;
  const shown = tags.slice(0, limit);
  const rest = tags.length - shown.length;
  const activeKeys = activeTags.map(tagKey);
  return (
    <>
      {shown.map((tag) => (
        <TagChip key={tag} tag={tag} active={activeKeys.includes(tagKey(tag))} onClick={onTagClick} />
      ))}
      {rest > 0 ? (
        <span className={styles.tagMore} title={tags.slice(limit).join(", ")}>
          +{rest}
        </span>
      ) : null}
    </>
  );
}

export function Avatar({ memberId, size = 22 }: { memberId: string; size?: number }) {
  const member = memberById(memberId);
  if (!member) return null;
  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, background: member.color, fontSize: Math.round(size * 0.42) }}
      title={member.name}
    >
      {initials(member.name)}
    </span>
  );
}

/** Up to three circles, then a "+N" badge. */
export function AvatarStack({ ids, size = 22 }: { ids: string[]; size?: number }) {
  const known = ids.filter((id) => memberById(id));
  if (!known.length) return null;
  const shown = known.slice(0, 3);
  const names = known.map((id) => memberById(id)!.name).join(", ");
  return (
    <span className={styles.stack} role="img" aria-label={`Assigned to ${names}`} title={names}>
      {shown.map((id) => (
        <Avatar key={id} memberId={id} size={size} />
      ))}
      {known.length > 3 ? (
        <span className={styles.avatarMore} style={{ width: size, height: size }}>
          +{known.length - 3}
        </span>
      ) : null}
    </span>
  );
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <span className={styles.progress} aria-hidden="true">
      <span style={{ transform: `scaleX(${total ? done / total : 0})` }} />
    </span>
  );
}
