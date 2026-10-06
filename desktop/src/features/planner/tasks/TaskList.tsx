import { ChevronDown, CircleCheckBig, Plus, SearchX } from "lucide-react";

import type { TaskGroup } from "./taskModel";
import { TaskRow, type RowHandlers } from "./TaskRow";
import type { GroupMode } from "./types";

import styles from "./TaskList.module.css";

interface TaskListProps extends RowHandlers {
  groups: TaskGroup[];
  groupMode: GroupMode;
  collapsedGroups: string[];
  onToggleGroup(key: string): void;
  now: Date;
  activeId: string | null;
  selecting: boolean;
  picked: Set<string>;
  leaving: Set<string>;
  fresh: string | null;
  activeTags: string[];
  empty: EmptyStateProps;
}

export function TaskList({
  groups,
  groupMode,
  collapsedGroups,
  onToggleGroup,
  now,
  activeId,
  selecting,
  picked,
  leaving,
  fresh,
  activeTags,
  empty,
  ...handlers
}: TaskListProps) {
  if (!groups.length) return <EmptyState {...empty} />;

  // Stagger runs across groups, so the second group continues the cascade.
  const offsets = groups.map((_, at) => groups.slice(0, at).reduce((sum, group) => sum + group.tasks.length, 0));
  return (
    <div className={styles.groups}>
      {groups.map((group, groupIndex) => {
        const key = `${groupMode}:${group.id}`;
        const collapsed = collapsedGroups.includes(key);
        return (
          <section key={key} className={styles.group} data-group={group.id}>
            <h2 className={styles.groupTitle}>
              <button type="button" aria-expanded={!collapsed} onClick={() => onToggleGroup(key)}>
                <ChevronDown size={14} className={styles.chevron} data-collapsed={collapsed || undefined} />
                <span>{group.label}</span>
              </button>
              <span className={styles.groupCount}>{group.tasks.length}</span>
            </h2>
            {collapsed ? null : (
              <ul className={styles.rows}>
                {group.tasks.map((task, taskIndex) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    now={now}
                    index={offsets[groupIndex]! + taskIndex}
                    active={task.id === activeId}
                    selecting={selecting}
                    picked={picked.has(task.id)}
                    leaving={leaving.has(task.id)}
                    fresh={task.id === fresh}
                    showCategory={groupMode !== "category"}
                    activeTags={activeTags}
                    {...handlers}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

export interface EmptyStateProps {
  query: string;
  filtered: boolean;
  onClearSearch(): void;
  onResetFilters(): void;
  onCreate(): void;
}

/** An empty search is not an empty module: name the query instead of offering to create. */
export function EmptyState({ query, filtered, onClearSearch, onResetFilters, onCreate }: EmptyStateProps) {
  if (query.trim()) {
    return (
      <div className={styles.empty}>
        <SearchX size={28} aria-hidden="true" />
        <strong>No results</strong>
        <p>No task contains “{query.trim()}”.</p>
        <button type="button" className={styles.emptyAction} onClick={onClearSearch}>
          Clear search
        </button>
      </div>
    );
  }
  if (filtered) {
    return (
      <div className={styles.empty}>
        <SearchX size={28} aria-hidden="true" />
        <strong>Nothing matches these filters</strong>
        <p>Loosen a filter or reset them to see the rest of the plan.</p>
        <button type="button" className={styles.emptyAction} onClick={onResetFilters}>
          Reset filters
        </button>
      </div>
    );
  }
  return (
    <div className={styles.empty}>
      <CircleCheckBig size={30} aria-hidden="true" className={styles.emptyIcon} />
      <strong>No tasks — all done?</strong>
      <p>Add the next thing to build with the field above, or press N.</p>
      <button type="button" className={styles.emptyAction} onClick={onCreate}>
        <Plus size={14} aria-hidden="true" /> Create task
      </button>
    </div>
  );
}
