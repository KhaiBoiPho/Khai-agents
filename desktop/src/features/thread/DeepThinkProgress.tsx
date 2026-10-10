import {
  Info,
  ArrowRight,
  Atom,
  Check,
  Circle,
  CircleSlash,
  ExternalLink,
  LoaderCircle,
  OctagonX,
} from "lucide-react";
import { Fragment, memo, useId, useState } from "react";

import type { Item } from "../../generated/app-server";
import {
  deepThinkView,
  hostOf,
  type DeepThinkStepStatus,
  type DeepThinkStepView,
  type DeepThinkView,
} from "./deepThinkModel";
import styles from "./DeepThinkProgress.module.css";

const STATUS_TEXT: Record<DeepThinkStepStatus, string> = {
  pending: "pending",
  running: "running",
  completed: "done",
  skipped: "skipped",
  failed: "failed",
  stopped: "stopped",
};

function StepIcon({ status }: { status: DeepThinkStepStatus }) {
  const props = { size: 12, strokeWidth: 2.2, "aria-hidden": true as const };
  switch (status) {
    case "completed":
      return <Check {...props} />;
    case "running":
      return <LoaderCircle {...props} className={styles.spinning} />;
    case "skipped":
      return <CircleSlash {...props} />;
    case "failed":
    case "stopped":
      return <OctagonX {...props} />;
    default:
      return <Circle {...props} />;
  }
}

function headline(view: DeepThinkView): string {
  const running = view.steps.find((step) => step.status === "running");
  if (running) return running.detail ?? `${running.label}…`;
  if (view.status === "interrupted") return "Stopped";
  if (view.status === "failed") return "DeepThink failed";
  const search = view.steps.find((step) => step.id === "search");
  const summarize = view.steps.find((step) => step.id === "summarize");
  return [search?.status === "completed" ? search.detail : null, summarize?.detail]
    .filter(Boolean)
    .join(" · ");
}

function hasDetails(step: DeepThinkStepView, view: DeepThinkView): boolean {
  return (
    Boolean(step.detail) ||
    step.items.length > 0 ||
    (step.id === "search" && view.sources.length > 0)
  );
}

function StepDetails({
  step,
  view,
}: {
  step: DeepThinkStepView;
  view: DeepThinkView;
}) {
  return (
    <div className={styles.details}>
      <p className={styles.detailLine}>
        <span data-status={step.status}>{STATUS_TEXT[step.status]}</span>
        {step.detail ? ` · ${step.detail}` : null}
      </p>
      {step.id === "search" ? (
        <>
          {step.items.length ? (
            <ul className={styles.queries} aria-label="Search queries">
              {step.items.map((query) => (
                <li key={query}>{query}</li>
              ))}
            </ul>
          ) : null}
          {view.sources.length ? (
            <ol className={styles.sources} aria-label="Sources">
              {view.sources.map((source) => (
                <li key={source.id}>
                  <span className={styles.sourceIndex}>{source.id}</span>
                  <a href={source.url} target="_blank" rel="noreferrer noopener">
                    <span className={styles.sourceTitle}>{source.title}</span>
                    <small>{hostOf(source.url)}</small>
                    <ExternalLink size={11} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      ) : step.items.length ? (
        <ol className={styles.items}>
          {step.items.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/**
 * Compact DeepThink pipeline: Plan → Search → Check → Summarize, each step
 * expandable for its sub-questions, queries, sources or review notes.
 * Memoized on the Item, which keeps its identity until it changes.
 */
export const DeepThinkProgress = memo(function DeepThinkProgress({
  item,
}: {
  item: Item;
}) {
  const view = deepThinkView(item);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const panelId = useId();
  if (!view) return null;
  const selected = view.steps.find((step) => step.id === openStep) ?? null;
  const line = headline(view);

  return (
    <section
      className={styles.root}
      data-status={view.status}
      aria-label="DeepThink progress"
    >
      <div className={styles.header}>
        <span className={styles.title}>
          <Atom size={14} aria-hidden="true" />
          DeepThink
        </span>
        <ol className={styles.chain}>
          {view.steps.map((step, index) => {
            const expandable = hasDetails(step, view);
            const label = `${step.label}: ${STATUS_TEXT[step.status]}`;
            return (
              <Fragment key={step.id}>
                {index > 0 ? (
                  <li className={styles.arrow} aria-hidden="true">
                    <ArrowRight size={11} />
                  </li>
                ) : null}
                <li>
                  <button
                    type="button"
                    className={styles.step}
                    data-status={step.status}
                    aria-label={label}
                    title={step.detail ?? label}
                    aria-expanded={expandable ? openStep === step.id : undefined}
                    aria-controls={expandable ? panelId : undefined}
                    aria-current={step.status === "running" ? "step" : undefined}
                    disabled={!expandable}
                    onClick={() =>
                      setOpenStep((current) => (current === step.id ? null : step.id))
                    }
                  >
                    <StepIcon status={step.status} />
                    {step.label}
                  </button>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </div>
      {line ? (
        <p className={styles.headline} aria-live="polite">
          {line}
        </p>
      ) : null}
      {view.notes.length ? (
        <p className={styles.note}>
          <Info size={12} aria-hidden="true" />
          <span>{view.notes.join(" ")}</span>
        </p>
      ) : null}
      {selected ? (
        <div id={panelId} role="region" aria-label={`${selected.label} details`}>
          <StepDetails step={selected} view={view} />
        </div>
      ) : null}
    </section>
  );
});
