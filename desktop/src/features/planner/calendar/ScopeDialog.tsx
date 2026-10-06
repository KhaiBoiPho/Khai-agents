/**
 * Which occurrences an edit or delete of a series applies to — asked at the
 * moment of the action, with three buttons and no preselection: a default
 * one can read past is an answer nobody gave (Yuvomi #1284). The occurrence
 * is named above the question, since by now the list may be gone.
 *
 * Ported from Yuvomi's Calendar module (MIT, © 2026 ulsklyc).
 */

import { formatWeekdayDate } from "./dates";
import { Dialog } from "./Dialog";
import styles from "./EventEditor.module.css";
import type { Scope } from "./eventStore";
import type { Occurrence } from "./model";

interface ScopeDialogProps {
  action: "save" | "delete";
  occurrence: Occurrence;
  onChoose(scope: Scope | null): void;
}

const SCOPES: ReadonlyArray<[Scope, string]> = [
  ["this", "Only this event"],
  ["following", "This and following"],
  ["series", "Whole series"],
];

export function ScopeDialog({ action, occurrence, onChoose }: ScopeDialogProps) {
  const title = action === "delete" ? "Delete recurring event" : "Save recurring event";
  return (
    <Dialog label={title} onDismiss={() => onChoose(null)} className={styles.small}>
      <div className={styles.dialogInner}>
        <h2 className={styles.dialogTitle}>{title}</h2>
        <p className={styles.hint} id="cal-scope-occurrence">
          "{occurrence.event.title}" on {formatWeekdayDate(occurrence.slot, true)}
        </p>
        <p className={styles.label} id="cal-scope-label">
          Applies to
        </p>
        <div className={styles.scopeChoices} role="group" aria-labelledby="cal-scope-label" aria-describedby="cal-scope-occurrence">
          {SCOPES.map(([scope, label], index) => (
            <button
              key={scope}
              type="button"
              className={action === "delete" ? styles.dangerOutline : styles.secondary}
              data-autofocus={index === 0 || undefined}
              onClick={() => onChoose(scope)}
            >
              {label}
            </button>
          ))}
          <button type="button" className={styles.secondary} onClick={() => onChoose(null)}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}
