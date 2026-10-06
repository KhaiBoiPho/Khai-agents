import { Clock, Moon, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";

import { shiftColor, type ScheduleState, type ShiftType } from "../model";
import { clockLabel, formatHours, shiftMinutes } from "../occurrences";
import { applyQuickstart } from "../scheduleStore";
import { QUICKSTART_TEMPLATES } from "../seed";
import styles from "../SchedulePage.module.css";
import { EmptyState } from "./ui";

type Apply = (edit: (state: ScheduleState) => ScheduleState) => string | null;

function usage(state: ScheduleState, id: string): number {
  return (
    state.patterns.reduce((total, pattern) => total + pattern.days.filter((day) => day.shiftTypeId === id).length, 0) +
    state.overrides.filter((row) => row.shiftTypeId === id).length +
    state.extras.filter((row) => row.shiftTypeId === id).length
  );
}

export function ShiftTypesView({
  state,
  apply,
  onNew,
  onEdit,
  onDelete,
  onNotice,
}: {
  state: ScheduleState;
  apply: Apply;
  onNew(): void;
  onEdit(type: ShiftType): void;
  onDelete(type: ShiftType): void;
  onNotice(message: string): void;
}) {
  const quickstart = (key: string) => {
    const template = QUICKSTART_TEMPLATES.find((item) => item.key === key);
    if (!template) return;
    let created = 0;
    apply((current) => {
      const result = applyQuickstart(current, template.presets);
      created = result.created;
      return result.state;
    });
    onNotice(
      created === 0
        ? "Already set up — nothing new to create."
        : created === 1
          ? "One shift type created."
          : `${created} shift types created.`,
    );
  };

  const quickBar = (
    <div className={styles.quickstart}>
      <span>
        <Sparkles size={14} /> Quick start
      </span>
      {QUICKSTART_TEMPLATES.map((template) => (
        <button key={template.key} type="button" className={styles.personChip} onClick={() => quickstart(template.key)}>
          {template.label}
        </button>
      ))}
    </div>
  );

  return (
    <section className={styles.view}>
      <div className={styles.sectionHead}>
        <h2>Shift types</h2>
        <button type="button" className={styles.ghostButton} onClick={onNew}>
          <Plus size={14} /> Add shift type
        </button>
      </div>
      {quickBar}
      {state.types.length ? (
        <div className={styles.typeGrid}>
          {state.types.map((type) => {
            const minutes = shiftMinutes(type);
            const uses = usage(state, type.id);
            const overnight = Boolean(type.start && type.end && type.end <= type.start);
            return (
              <article key={type.id} className={styles.typeCard} style={{ "--shift": shiftColor(type.color) } as CSSProperties}>
                <span className={styles.typeCode}>{type.shortCode || type.name.slice(0, 2)}</span>
                <div className={styles.typeMain}>
                  <strong>{type.name}</strong>
                  <small>
                    {overnight ? <Moon size={11} /> : <Clock size={11} />} {clockLabel(type)}
                    {minutes != null ? ` · ${formatHours(minutes)}` : ""}
                  </small>
                  <small>{uses ? `Used ${uses}×` : "Not used yet"}</small>
                </div>
                <div className={styles.rowActions}>
                  <button type="button" className={styles.iconButton} aria-label={`Edit ${type.name}`} onClick={() => onEdit(type)}>
                    <Pencil size={14} />
                  </button>
                  <button type="button" className={styles.iconButton} aria-label={`Delete ${type.name}`} onClick={() => onDelete(type)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Clock size={20} />}
          title="No shift types yet"
          description="Add a few common shift types with a quick start above, or create your own."
          action={
            <button type="button" className={styles.primaryButton} onClick={onNew}>
              Add shift type
            </button>
          }
        />
      )}
    </section>
  );
}
