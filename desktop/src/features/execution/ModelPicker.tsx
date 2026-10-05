import { Check, Search, Settings } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ConnectionInfo,
  CatalogModel,
  ModelCatalogResult,
  Project,
  SettingsSnapshot,
  Thread,
} from "../../generated/app-server";
import type { ClientRuntime } from "../../rpc/contracts";
import { useConnectionCatalog } from "../settings/useConnectionCatalog";
import styles from "./ModelPicker.module.css";

interface ModelPickerProps {
  runtime: ClientRuntime;
  project: Project | null;
  thread: Thread | null;
  settings: SettingsSnapshot | null;
  disabled: boolean;
  onChange(
    connectionId: string | null,
    model: string | null,
    reasoningEffort: string | null,
    contextWindow: number | null,
  ): void;
  onManageProviders?: () => void;
}

const MODELS_PER_GROUP = 60;

/**
 * Model and effort picker after cdesktop's: a text trigger ("model · effort")
 * opening a searchable list grouped by connection, with an effort strip and a
 * link to the provider settings. Every choice applies immediately.
 */
export function ModelPicker({
  runtime,
  project,
  thread,
  settings,
  disabled,
  onChange,
  onManageProviders,
}: ModelPickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { catalog: connectionCatalog, models: listModels } =
    useConnectionCatalog(runtime, project?.id ?? null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [catalogs, setCatalogs] = useState<Record<string, ModelCatalogResult>>(
    {},
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const defaults = agentDefaults(settings);
  const effectiveModel = thread?.model ?? defaults.model;
  const usableConnections = useMemo(
    () =>
      (connectionCatalog?.connections ?? []).filter(
        (connection) => connection.enabled && connection.configured,
      ),
    [connectionCatalog],
  );
  const effectiveConnection = resolveConnection(
    connectionCatalog?.connections ?? [],
    thread?.connectionId ?? defaults.connection,
    effectiveModel,
  );
  const effectiveEffort =
    thread?.reasoningEffort ?? defaults.reasoningEffort ?? "auto";
  const usingDefaults = !thread?.model && !thread?.connectionId;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    for (const connection of usableConnections) {
      if (catalogs[connection.id]) continue;
      void listModels(connection.id)
        .then((result) => {
          if (!cancelled) {
            setCatalogs((current) => ({ ...current, [connection.id]: result }));
          }
        })
        .catch((cause) => {
          if (!cancelled) {
            setErrors((current) => ({
              ...current,
              [connection.id]:
                cause instanceof Error ? cause.message : String(cause),
            }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [catalogs, listModels, open, usableConnections]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const currentModel: CatalogModel | null = useMemo(() => {
    if (!effectiveConnection || !effectiveModel) return null;
    return (
      catalogs[effectiveConnection.id]?.models.find(
        (model) => model.id === effectiveModel,
      ) ?? null
    );
  }, [catalogs, effectiveConnection, effectiveModel]);
  const effortOptions = reasoningOptions(currentModel);

  const normalized = query.trim().toLocaleLowerCase();
  const groups = usableConnections.map((connection) => {
    const result = catalogs[connection.id];
    const models = (result?.models ?? [])
      .filter(
        (model) =>
          !normalized ||
          model.id.toLocaleLowerCase().includes(normalized) ||
          model.name.toLocaleLowerCase().includes(normalized),
      )
      .slice(0, MODELS_PER_GROUP);
    return {
      connection,
      models,
      loading: !result && !errors[connection.id],
      error: errors[connection.id] ?? result?.error ?? null,
    };
  });

  const pick = (connectionId: string, modelId: string) => {
    onChange(connectionId, modelId, "auto", null);
    setOpen(false);
    setQuery("");
  };

  const pickEffort = (effort: string) => {
    if (!effectiveConnection || !effectiveModel) return;
    onChange(
      effectiveConnection.id,
      effectiveModel,
      effort,
      thread?.contextWindow ?? null,
    );
  };

  return (
    <div className={styles.picker} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Session model"
        title={
          effectiveConnection
            ? `${effectiveConnection.label} · ${effectiveModel ?? ""}`
            : "Choose a model"
        }
      >
        <strong>{shortModelName(currentModel?.name ?? effectiveModel)}</strong>
        <span>· {effortLabel(effectiveEffort)}</span>
      </button>

      {open ? (
        <section
          className={styles.menu}
          role="dialog"
          aria-label="Choose model and effort"
        >
          <label className={styles.search}>
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models…"
              aria-label="Search models"
              autoFocus
            />
          </label>

          <div className={styles.models} role="listbox">
            {!normalized ? (
              <div className={styles.group}>
                <p className={styles.groupLabel}>Default</p>
                <button
                  type="button"
                  role="option"
                  aria-selected={usingDefaults}
                  onClick={() => {
                    onChange(null, null, null, null);
                    setOpen(false);
                  }}
                >
                  <span>Default Model</span>
                  {usingDefaults ? <Check size={13} /> : null}
                </button>
              </div>
            ) : null}
            {groups.map(({ connection, models, loading, error }) => (
              <div className={styles.group} key={connection.id}>
                <p className={styles.groupLabel}>{connection.label}</p>
                {models.map((model) => {
                  const selected =
                    !usingDefaults &&
                    effectiveConnection?.id === connection.id &&
                    model.id === effectiveModel;
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      key={model.id}
                      title={model.id}
                      onClick={() => pick(connection.id, model.id)}
                    >
                      <span>{shortModelName(model.name)}</span>
                      <small>{formatTokens(model.contextWindow)}</small>
                      {selected ? <Check size={13} /> : null}
                    </button>
                  );
                })}
                {loading ? <p className={styles.status}>Loading…</p> : null}
                {!loading && !models.length ? (
                  <p className={styles.status}>
                    {error ?? (normalized ? "No matching models" : "No models")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          <div className={styles.effort} role="radiogroup" aria-label="Effort">
            <span>Effort</span>
            <div>
              {effortOptions.map((option) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={effectiveEffort === option.value}
                  key={option.value}
                  disabled={!effectiveModel || !effectiveConnection}
                  onClick={() => pickEffort(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {onManageProviders ? (
            <button
              type="button"
              className={styles.manage}
              onClick={() => {
                setOpen(false);
                onManageProviders();
              }}
            >
              <Settings size={14} />
              Manage providers →
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function agentDefaults(
  settings: SettingsSnapshot | null,
): {
  connection: string | null;
  model: string | null;
  reasoningEffort: string | null;
} {
  const defaults = settings?.agents.defaults;
  if (typeof defaults !== "object" || defaults === null || Array.isArray(defaults)) {
    return { connection: null, model: null, reasoningEffort: null };
  }
  const connection =
    typeof defaults.connection === "string" && defaults.connection
      ? defaults.connection
      : typeof defaults.provider === "string" && defaults.provider !== "auto"
        ? defaults.provider
        : null;
  const model =
    typeof defaults.model === "string" && defaults.model ? defaults.model : null;
  const reasoningEffort =
    typeof defaults.reasoningEffort === "string" && defaults.reasoningEffort
      ? defaults.reasoningEffort
      : typeof defaults.reasoning_effort === "string" && defaults.reasoning_effort
        ? defaults.reasoning_effort
        : null;
  return { connection, model, reasoningEffort };
}

function reasoningOptions(
  model: CatalogModel | null,
): Array<{ value: string; label: string }> {
  const capabilities = model?.reasoning;
  const options = [{ value: "auto", label: "Auto" }];
  if (!capabilities) return options;
  if (!capabilities.mandatory) options.push({ value: "none", label: "Off" });
  for (const effort of capabilities.supportedEfforts) {
    options.push({ value: effort, label: effortLabel(effort) });
  }
  return options;
}

function effortLabel(value: string): string {
  if (value === "auto") return "Auto";
  if (value === "none") return "Off";
  if (value === "medium") return "Med";
  if (value === "xhigh") return "XHigh";
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

/** `models/gemini-3.6-flash` and `nvidia/nemotron-…` read as their last part. */
function shortModelName(value: string | null | undefined): string {
  if (!value) return "Default Model";
  return value.split("/").at(-1) ?? value;
}

function resolveConnection(
  connections: ConnectionInfo[],
  selectedId: string | null,
  model: string | null,
): ConnectionInfo | null {
  if (selectedId) {
    const selected = connections.find((connection) => connection.id === selectedId);
    if (selected) return selected;
  }
  const prefix = model?.split("/", 1)[0]?.toLocaleLowerCase();
  return (
    connections.find(
      (connection) =>
        connection.id === prefix || connection.providerName === prefix,
    ) ??
    connections.find((connection) => connection.configured && connection.enabled) ??
    null
  );
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}
