import { useEffect, useState } from "react";

import type { WebSearchStatus } from "../../generated/app-server";
import type { ConnectionCatalogController } from "./useConnectionCatalog";
import { Toggle } from "./ui/SettingsUI";
import styles from "./ConnectionSettings.module.css";

type WebSearchController = NonNullable<ConnectionCatalogController["webSearch"]>;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Built-in web search (Firecrawl). The key is write-only: the server only
 * ever says whether one is saved, so the field starts blank either way.
 */
export function WebSearchSettings({
  controller,
  busy,
}: {
  controller: WebSearchController;
  busy: boolean;
}) {
  const [status, setStatus] = useState<WebSearchStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    controller
      .status()
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch((cause: unknown) => {
        if (alive) setError(errorMessage(cause));
      });
    return () => {
      alive = false;
    };
  }, [controller]);

  const apply = async (params: Parameters<WebSearchController["update"]>[0]) => {
    setPending(true);
    setError(null);
    try {
      setStatus(await controller.update(params));
      if ("apiKey" in params) setApiKey("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  const disabled = busy || pending || status === null;
  const stateLabel = !status
    ? "Loading…"
    : !status.enabled
      ? "Off"
      : status.keyless
        ? "Keyless"
        : "Key saved";

  return (
    <article className={`${styles.connection} ${styles.webSearch}`}>
      <div className={styles.connectionBody}>
        <header>
          <div>
            <strong>Web search · Firecrawl</strong>
          </div>
          <span data-status={status?.enabled ? "ready" : "configured"}>
            {stateLabel}
          </span>
        </header>
        <p>
          <small>
            Used by DeepThink and Search. Works without a key (rate-limited);
            add a key for higher limits.
          </small>
        </p>
        <form
          className={styles.webSearchForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (apiKey.trim()) void apply({ apiKey: apiKey.trim() });
          }}
        >
          <input
            type="password"
            aria-label="Firecrawl API key"
            autoComplete="off"
            spellCheck={false}
            placeholder={status?.configured ? "Saved — leave blank to keep" : "fc-…"}
            value={apiKey}
            disabled={disabled}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <div className={styles.actions}>
            <button type="submit" disabled={disabled || !apiKey.trim()}>
              Save
            </button>
            {status?.configured ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => void apply({ apiKey: null })}
              >
                Remove key
              </button>
            ) : null}
          </div>
        </form>
        {error ? <p className={styles.webSearchError}>{error}</p> : null}
      </div>
      <Toggle
        label="Enable web search"
        checked={Boolean(status?.enabled)}
        disabled={disabled}
        onChange={(enabled) => void apply({ enabled })}
      />
    </article>
  );
}
