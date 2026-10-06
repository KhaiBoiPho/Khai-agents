import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { MEMBERS } from "../shared/members";
import { Avatar } from "./bits";
import { tagHue, tagKey } from "./taskModel";
import { CATEGORIES, CURRENT_USER_ID, DEFAULT_FILTERS, PRIORITIES, type StatusFilter, type TaskFilters } from "./types";

import styles from "./TasksPage.module.css";

const STATUS_CHIPS: ReadonlyArray<{ id: StatusFilter; label: string }> = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "done", label: "Done" },
  { id: "archived", label: "Archived" },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

/** The full filter panel: several values per axis (OR), axes narrow each other (AND). */
export function FilterPanel({
  filters,
  tags,
  showStatus,
  onChange,
}: {
  filters: TaskFilters;
  tags: Array<{ tag: string; count: number }>;
  showStatus: boolean;
  onChange(filters: TaskFilters): void;
}) {
  const set = (patch: Partial<TaskFilters>) => onChange({ ...filters, ...patch });
  const tagKeys = filters.tags.map(tagKey);

  return (
    <div className={styles.filterPanel}>
      {showStatus ? (
        <ChipGroup label="Status">
          {STATUS_CHIPS.map((chip) => (
            <Chip
              key={chip.id}
              active={filters.statuses.includes(chip.id)}
              disabled={filters.dueToday}
              onClick={() => set({ statuses: toggle(filters.statuses, chip.id) })}
            >
              {chip.label}
            </Chip>
          ))}
        </ChipGroup>
      ) : null}
      <ChipGroup label="Priority">
        {PRIORITIES.filter((priority) => priority.id !== "none").map((priority) => (
          <Chip
            key={priority.id}
            active={filters.priorities.includes(priority.id)}
            onClick={() => set({ priorities: toggle(filters.priorities, priority.id) })}
          >
            <span className={styles.priorityDot} data-priority={priority.id} aria-hidden="true" />
            {priority.label}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup label="Person">
        {MEMBERS.map((member) => (
          <Chip
            key={member.id}
            active={filters.people.includes(member.id)}
            onClick={() => set({ people: toggle(filters.people, member.id) })}
          >
            <Avatar memberId={member.id} size={16} />
            {member.id === CURRENT_USER_ID ? "Me" : member.name}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup label="Category">
        {CATEGORIES.map((category) => (
          <Chip
            key={category.id}
            active={filters.categories.includes(category.id)}
            onClick={() => set({ categories: toggle(filters.categories, category.id) })}
          >
            {category.label}
          </Chip>
        ))}
      </ChipGroup>
      {tags.length ? (
        <ChipGroup label="Tags" hint="all must match">
          {tags.map(({ tag, count }) => {
            const active = tagKeys.includes(tagKey(tag));
            return (
              <Chip
                key={tag}
                active={active}
                hue={tagHue(tag)}
                onClick={() =>
                  set({
                    tags: active
                      ? filters.tags.filter((entry) => tagKey(entry) !== tagKey(tag))
                      : [...filters.tags, tag],
                  })
                }
              >
                {tag}
                <small>{count}</small>
              </Chip>
            );
          })}
        </ChipGroup>
      ) : null}
      <button type="button" className={styles.resetFilters} onClick={() => onChange({ ...DEFAULT_FILTERS })}>
        <RotateCcw size={13} aria-hidden="true" /> Reset filters
      </button>
    </div>
  );
}

function ChipGroup({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={styles.chipGroup} role="group" aria-label={label}>
      <span className={styles.chipLabel}>
        {label}
        {hint ? <small> · {hint}</small> : null}
      </span>
      <div className={styles.chips}>{children}</div>
    </div>
  );
}

export function Chip({
  active,
  disabled,
  hue,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  hue?: number;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.chip}
      aria-pressed={active}
      disabled={disabled}
      data-hue={hue}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
