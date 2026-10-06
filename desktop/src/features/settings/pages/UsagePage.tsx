/**
 * Token usage, as reported by each provider for every model response and
 * kept in the service's usage ledger (`usage/summary`). A local install has
 * no plan or quota, so the page shows measured usage — not limits.
 */

import { CircleHelp, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type {
  UsageModel,
  UsageSummaryResult,
  UsageTotals,
} from "../../../generated/app-server";
import { formatTokens } from "../../execution/contextFormat";
import type { SettingsSectionProps } from "../settingsSections";
import { Button, Group, Page, Table } from "../ui/SettingsUI";
import styles from "./UsagePage.module.css";

const DAYS = 30;

export function UsagePage({ runtime }: SettingsSectionProps) {
  const [summary, setSummary] = useState<UsageSummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSummary = useCallback(
    () =>
      runtime
        .request("usage/summary", {
          days: DAYS,
          utcOffsetMinutes: -new Date().getTimezoneOffset(),
        })
        .then(
          (result) => {
            setSummary(result);
            setError(null);
          },
          (reason: unknown) => setError(errorMessage(reason)),
        )
        .finally(() => setLoading(false)),
    [runtime],
  );
  const load = () => {
    setLoading(true);
    void fetchSummary();
  };

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  return (
    <Page>
      <div className={styles.head}>
        <p>
          <strong>Your usage</strong> <span>Local · measured from provider responses</span>
        </p>
        <Button variant="ghost" onClick={load} disabled={loading} title="Refresh">
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </Button>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {summary ? (
        <>
          <div className={styles.tiles}>
            <StatTile label="Today" totals={summary.today} />
            <StatTile label="Last 7 days" totals={summary.week} />
            <StatTile label="All time" totals={summary.allTime} />
          </div>

          <Group
            title={`Last ${DAYS} days`}
            description="Input plus output tokens per day, in your time zone."
          >
            <DailyChart days={summary.days} />
          </Group>

          <Group
            title="By model"
            description="Cost is an estimate at catalog list prices; cache discounts are not applied."
          >
            <Table
              columns={[
                { label: "Model", width: "2fr" },
                { label: "Requests", align: "end" },
                { label: "Input", align: "end" },
                { label: "Output", align: "end" },
                { label: "Est. cost", align: "end" },
              ]}
              rows={summary.models.map((model) => [
                <ModelName key="m" model={model} />,
                model.requests.toLocaleString(),
                <span key="i" title={`${model.cachedInputTokens.toLocaleString()} cached`}>
                  {formatTokens(model.inputTokens)}
                </span>,
                formatTokens(model.outputTokens),
                model.unpricedRequests === model.requests ? (
                  <span key="c" className={styles.muted} title="No catalog price for this model">
                    —
                  </span>
                ) : (
                  formatUsd(model.costUsd)
                ),
              ])}
              empty={<span className={styles.muted}>No model responses recorded yet.</span>}
            />
          </Group>
        </>
      ) : loading && !error ? (
        <p className={styles.muted}>Loading usage…</p>
      ) : null}

      <p className={styles.footnote}>
        <CircleHelp size={13} aria-hidden="true" /> Counts come from each provider&apos;s
        own usage report, including compaction summaries. Usage stays in this
        ledger even after a conversation is deleted. The context ring in the
        composer shows how full the open conversation is.
      </p>
    </Page>
  );
}

function StatTile({ label, totals }: { label: string; totals: UsageTotals }) {
  const total = totals.inputTokens + totals.outputTokens;
  return (
    <section className={styles.tile} aria-label={label}>
      <small>{label}</small>
      <strong>{formatTokens(total)}</strong>
      <span>
        {formatTokens(totals.inputTokens)} in · {formatTokens(totals.outputTokens)} out ·{" "}
        {totals.requests.toLocaleString()} {totals.requests === 1 ? "request" : "requests"}
      </span>
      <span>{costLabel(totals)}</span>
    </section>
  );
}

function DailyChart({ days }: { days: UsageSummaryResult["days"] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const totals = days.map((day) => day.inputTokens + day.outputTokens);
  const peak = Math.max(0, ...totals);
  if (peak === 0) {
    return <p className={styles.muted}>No usage in this period.</p>;
  }
  const active = hovered === null ? null : days[hovered];
  return (
    <div className={styles.chartFrame}>
      <div className={styles.chartScale} aria-hidden="true">
        <span>{formatTokens(peak)}</span>
        <span>0</span>
      </div>
      <div
        className={styles.chart}
        role="img"
        aria-label={`Daily tokens over the last ${days.length} days; peak ${formatTokens(peak)}`}
        onMouseLeave={() => setHovered(null)}
      >
        {days.map((day, index) => (
          <span
            key={day.date}
            className={styles.column}
            data-active={hovered === index || undefined}
            onMouseEnter={() => setHovered(index)}
          >
            <i style={{ height: totals[index] ? `${Math.max(2, (totals[index] / peak) * 100)}%` : 0 }} />
          </span>
        ))}
        {active && hovered !== null ? (
          <div
            className={styles.tooltip}
            style={{
              left: `${Math.min(88, Math.max(12, ((hovered + 0.5) / days.length) * 100))}%`,
            }}
            role="status"
          >
            <strong>{formatDay(active.date)}</strong>
            <span>{formatTokens(active.inputTokens + active.outputTokens)} tokens</span>
            <span>
              {formatTokens(active.inputTokens)} in · {formatTokens(active.outputTokens)} out
            </span>
            <span>
              {active.requests} {active.requests === 1 ? "request" : "requests"} · {costLabel(active)}
            </span>
          </div>
        ) : null}
      </div>
      <div className={styles.chartAxis} aria-hidden="true">
        <span>{formatDay(days[0].date)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function ModelName({ model }: { model: UsageModel }) {
  return (
    <span className={styles.model}>
      <strong>{model.modelId ?? "Unknown model"}</strong>
      {model.providerName ? <small>{model.providerName}</small> : null}
    </span>
  );
}

function costLabel(totals: Pick<UsageTotals, "costUsd" | "requests" | "unpricedRequests">) {
  if (totals.requests === 0) return "$0.00";
  if (totals.unpricedRequests === totals.requests) return "Cost unknown (no catalog price)";
  const cost = `≈ ${formatUsd(totals.costUsd)}`;
  return totals.unpricedRequests ? `${cost} + ${totals.unpricedRequests} unpriced` : cost;
}

function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

function formatDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "object" && reason && "message" in reason) {
    return String((reason as { message: unknown }).message);
  }
  return "Usage is unavailable.";
}
