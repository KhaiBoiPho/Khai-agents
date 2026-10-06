import { CircleCheck, History } from "lucide-react";
import { useState } from "react";

import { MEMBERS, memberById } from "../shared/members";
import { Avatar } from "./bits";
import { dayHeading, groupHistory } from "./taskModel";
import type { TasksState } from "./types";

import styles from "./HistoryView.module.css";

const PAGE = 30;

/**
 * Not tasks but occurrences: who ticked off what, and when. Search, filters
 * and grouping don't apply here — they all ask about tasks.
 */
export function HistoryView({
  state,
  now,
  activeId,
  onOpen,
}: {
  state: TasksState;
  now: Date;
  activeId: string | null;
  onOpen(id: string): void;
}) {
  const [person, setPerson] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const days = groupHistory(state, person);
  const total = days.reduce((sum, day) => sum + day.entries.length, 0);

  const visible: typeof days = [];
  let room = limit;
  for (const day of days) {
    if (room <= 0) break;
    const entries = day.entries.slice(0, room);
    room -= entries.length;
    visible.push({ ...day, entries });
  }

  return (
    <div className={styles.history}>
      <div className={styles.people} role="group" aria-label="Filter by person">
        <button type="button" aria-pressed={person === null} onClick={() => setPerson(null)}>
          Everyone
        </button>
        {MEMBERS.map((member) => (
          <button
            type="button"
            key={member.id}
            aria-pressed={person === member.id}
            onClick={() => {
              setPerson(person === member.id ? null : member.id);
              setLimit(PAGE);
            }}
          >
            <Avatar memberId={member.id} size={18} />
            {member.name}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className={styles.empty}>
          <History size={28} aria-hidden="true" />
          <strong>{person ? "Nothing recorded for this person" : "Nothing recorded yet"}</strong>
          <p>This is where you see who did which task, and when. Recording starts with the first tick.</p>
        </div>
      ) : (
        visible.map((day) => (
          <section key={day.day} className={styles.day}>
            <h2>{dayHeading(day.day, now)}</h2>
            <ul>
              {day.entries.map(({ completion, task }) => {
                const who = completion.doneById ?? completion.userId;
                const ticker = memberById(completion.userId);
                return (
                  <li key={completion.id} data-active={task?.id === activeId || undefined}>
                    <CircleCheck size={16} className={styles.tick} aria-hidden="true" />
                    {task ? (
                      <button type="button" className={styles.title} onClick={() => onOpen(task.id)}>
                        {task.title}
                      </button>
                    ) : (
                      <span className={styles.title}>Deleted task</span>
                    )}
                    <span className={styles.who}>
                      <Avatar memberId={who} size={18} />
                      {memberById(who)?.name ?? "No longer here"}
                      {completion.doneById && completion.doneById !== completion.userId ? (
                        <small>ticked off by {ticker?.name ?? "someone"}</small>
                      ) : null}
                    </span>
                    <time dateTime={completion.completedAt}>
                      {new Date(completion.completedAt).toLocaleTimeString("en", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {total > limit ? (
        <button type="button" className={styles.more} onClick={() => setLimit(limit + PAGE)}>
          Show more
        </button>
      ) : null}
    </div>
  );
}
