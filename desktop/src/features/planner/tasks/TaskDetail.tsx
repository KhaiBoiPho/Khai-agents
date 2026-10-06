import {
  Archive,
  ArchiveRestore,
  Award,
  CalendarClock,
  Check,
  Clock,
  Flag,
  Folder,
  History,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  Repeat,
  Tag,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Dropdown } from "../../../components/Dropdown";
import { MEMBERS, memberById } from "../shared/members";
import { isoDate } from "../shared/persistentState";
import { Avatar, DueBadge } from "./bits";
import { Comments } from "./Comments";
import { DescriptionField } from "./DescriptionField";
import { DetailSubtasks } from "./DetailSubtasks";
import { RecurrenceFields } from "./RecurrenceFields";
import { TagEditor } from "./TagEditor";
import { allTags, dayHeading, isArchived, seriesCompletions } from "./taskModel";
import type { TaskActions } from "./taskStore";
import {
  CATEGORIES,
  CURRENT_USER_ID,
  PRIORITIES,
  STATUSES,
  categoryLabel,
  priorityLabel,
  type Task,
  type TasksState,
  type TaskStatus,
} from "./types";

import styles from "./TaskDetail.module.css";

interface TaskDetailProps {
  task: Task;
  state: TasksState;
  now: Date;
  actions: TaskActions;
  autoFocusTitle: boolean;
  onStatus(task: Task, status: TaskStatus, doneById?: string | null): void;
  onArchive(task: Task): void;
  onDelete(task: Task): void;
  onClose(): void;
}

/** Remount per task (`key={task.id}`) so drafts never leak between tasks. */
export function TaskDetail({
  task,
  state,
  now,
  actions,
  autoFocusTitle,
  onStatus,
  onArchive,
  onDelete,
  onClose,
}: TaskDetailProps) {
  const [title, setTitle] = useState(task.title);
  const archived = isArchived(task);
  const done = task.status === "done";
  const update = (patch: Parameters<TaskActions["update"]>[1]) => actions.update(task.id, patch);
  const history = seriesCompletions(state, task).slice(0, 10);

  const commitTitle = () => {
    const clean = title.trim();
    if (clean && clean !== task.title) update({ title: clean });
    else setTitle(task.title);
  };

  return (
    <aside className={styles.panel} aria-label={`Task: ${task.title}`}>
      <header className={styles.head}>
        <button
          type="button"
          className={styles.bigCheck}
          data-status={task.status}
          aria-label={done ? "Reopen" : "Mark as done"}
          onClick={() => onStatus(task, done ? "open" : "done")}
        >
          <Check size={14} strokeWidth={3} />
        </button>
        <textarea
          className={styles.title}
          value={title}
          rows={1}
          autoFocus={autoFocusTitle}
          aria-label="Title"
          onFocus={(event) => autoFocusTitle && event.currentTarget.select()}
          onChange={(event) => setTitle(event.target.value.replace(/\n/g, ""))}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.stopPropagation();
              setTitle(task.title);
              event.currentTarget.blur();
            }
          }}
        />
        <Dropdown
          triggerClassName={styles.iconButton}
          trigger={<MoreHorizontal size={16} />}
          triggerLabel="More actions"
          align="end"
          sections={[
            {
              items: [
                {
                  id: "archive",
                  label: archived ? "Restore from archive" : "Archive",
                  icon: archived ? <ArchiveRestore size={14} /> : <Archive size={14} />,
                  onSelect: () => onArchive(task),
                },
                { id: "delete", label: "Delete task", icon: <Trash2 size={14} />, onSelect: () => onDelete(task) },
              ],
            },
          ]}
        />
        <button type="button" className={styles.iconButton} aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <div className={styles.body}>
        <div className={styles.statusRow}>
          <div className={styles.segmented} role="group" aria-label="Status">
            {STATUSES.map((status) => (
              <button
                type="button"
                key={status.id}
                aria-pressed={task.status === status.id}
                onClick={() => onStatus(task, status.id)}
              >
                {status.label}
              </button>
            ))}
          </div>
          {done ? null : (
            <Dropdown
              triggerClassName={styles.pill}
              trigger="Done by…"
              title="Tick it off for whoever actually did it"
              sections={[
                {
                  title: "Who did it?",
                  items: MEMBERS.map((member) => ({
                    id: member.id,
                    label: member.id === CURRENT_USER_ID ? `${member.name} (you)` : member.name,
                    icon: <Avatar memberId={member.id} size={18} />,
                    onSelect: () => onStatus(task, "done", member.id),
                  })),
                },
              ]}
            />
          )}
          {archived ? <span className={styles.archivedNote}>Archived</span> : null}
        </div>

        <dl className={styles.fields}>
          <Field icon={<Clock size={14} />} label="Due">
            <div className={styles.inlineRow}>
              <input
                type="date"
                value={task.dueDate ?? ""}
                aria-label="Due date"
                onChange={(event) => update({ dueDate: event.target.value || null })}
              />
              <input
                type="time"
                value={task.dueTime ?? ""}
                disabled={!task.dueDate}
                aria-label="Due time"
                onChange={(event) => update({ dueTime: event.target.value || null })}
              />
              <DueBadge task={task} now={now} />
            </div>
          </Field>
          <Field icon={<CalendarClock size={14} />} label="Starts">
            <div className={styles.inlineRow}>
              <input
                type="date"
                value={task.startDate ?? ""}
                aria-label="Start date"
                onChange={(event) => update({ startDate: event.target.value || null })}
              />
              {task.startDate ? <span className={styles.hint}>Hidden from the list until then</span> : null}
            </div>
          </Field>
          <Field icon={<Flag size={14} />} label="Priority">
            <Dropdown
              triggerClassName={styles.pill}
              trigger={priorityLabel(task.priority)}
              triggerLabel="Priority"
              sections={[
                {
                  items: PRIORITIES.map((priority) => ({
                    id: priority.id,
                    label: priority.label,
                    selected: task.priority === priority.id,
                    onSelect: () => update({ priority: priority.id }),
                  })),
                },
              ]}
            />
          </Field>
          <Field icon={<Folder size={14} />} label="Category">
            <Dropdown
              triggerClassName={styles.pill}
              trigger={categoryLabel(task.category)}
              triggerLabel="Category"
              sections={[
                {
                  items: CATEGORIES.map((category) => ({
                    id: category.id,
                    label: category.label,
                    selected: task.category === category.id,
                    onSelect: () => update({ category: category.id }),
                  })),
                },
              ]}
            />
          </Field>
          <Field icon={<Users size={14} />} label="Assigned">
            <div className={styles.people} role="group" aria-label="Assignees">
              {MEMBERS.map((member) => {
                const on = task.assigneeIds.includes(member.id);
                return (
                  <button
                    type="button"
                    key={member.id}
                    aria-pressed={on}
                    title={member.name}
                    onClick={() =>
                      update({
                        assigneeIds: on
                          ? task.assigneeIds.filter((id) => id !== member.id)
                          : [...task.assigneeIds, member.id],
                      })
                    }
                  >
                    <Avatar memberId={member.id} size={20} />
                    <span>{member.id === CURRENT_USER_ID ? "Me" : member.isAgent ? "Agent" : member.name.split(" ")[0]}</span>
                  </button>
                );
              })}
            </div>
          </Field>
          <Field icon={<Tag size={14} />} label="Tags">
            <TagEditor
              tags={task.tags}
              suggestions={allTags(state.tasks).map((entry) => entry.tag)}
              onChange={(tags) => update({ tags })}
            />
          </Field>
          <Field icon={<Repeat size={14} />} label="Repeat">
            <RecurrenceFields
              rule={task.recurrenceRule}
              fromCompletion={task.recurrenceFromCompletion}
              dueDate={task.dueDate}
              onChange={(recurrenceRule, recurrenceFromCompletion) =>
                update({ recurrenceRule, recurrenceFromCompletion })
              }
            />
          </Field>
          <Field icon={<Award size={14} />} label="Points">
            {/* TODO(backend): points are stored but no reward ledger credits them yet. */}
            <input
              type="number"
              min={0}
              max={999}
              className={styles.points}
              value={task.points || ""}
              placeholder="0"
              aria-label="Points"
              onChange={(event) => update({ points: Math.max(0, Math.round(Number(event.target.value) || 0)) })}
            />
          </Field>
        </dl>

        <section className={styles.section}>
          <h3>Notes</h3>
          <DescriptionField value={task.description} onChange={(description) => update({ description })} />
        </section>

        <section className={styles.section}>
          <h3>
            <ListChecks size={14} aria-hidden="true" /> Subtasks
          </h3>
          <DetailSubtasks
            subtasks={task.subtasks}
            disabled={archived}
            onAdd={(value) => actions.addSubtask(task.id, value)}
            onToggle={(id) => actions.toggleSubtask(task.id, id)}
            onRename={(id, value) => actions.renameSubtask(task.id, id, value)}
            onRemove={(id) => actions.removeSubtask(task.id, id)}
          />
        </section>

        {task.recurrenceRule || history.length ? (
          <section className={styles.section}>
            <h3>
              <History size={14} aria-hidden="true" /> Last completed
            </h3>
            {history.length ? (
              <ul className={styles.series}>
                {history.map((entry) => {
                  const who = entry.doneById ?? entry.userId;
                  return (
                    <li key={entry.id}>
                      <span>
                        {dayHeading(isoDate(new Date(entry.completedAt)), now)},{" "}
                        {new Date(entry.completedAt).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })}
                      </span>
                      <span>{memberById(who)?.name ?? "No longer here"}</span>
                      {entry.doneById && entry.doneById !== entry.userId ? (
                        <small>ticked off by {memberById(entry.userId)?.name ?? "someone"}</small>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.hint}>Never completed yet.</p>
            )}
          </section>
        ) : null}

        <section className={styles.section}>
          <h3>
            <MessageSquare size={14} aria-hidden="true" /> Comments
          </h3>
          <Comments
            comments={task.comments}
            now={now}
            onAdd={(text) => actions.addComment(task.id, text)}
            onEdit={(id, text) => actions.editComment(task.id, id, text)}
            onDelete={(id) => actions.deleteComment(task.id, id)}
          />
        </section>

        <p className={styles.footnote}>
          Created by {memberById(task.createdBy)?.name ?? "someone"} ·{" "}
          {new Date(task.createdAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}
        </p>
      </div>
    </aside>
  );
}

function Field({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <>
      <dt>
        {icon}
        {label}
      </dt>
      <dd>{children}</dd>
    </>
  );
}
