/**
 * App Authorization — connect the third-party apps the agent may act in.
 *
 * TODO(backend): runs on `mockAppAuthClient`; swap in the Composio-backed
 * client (see appAuthClient.ts) and nothing here needs to change.
 */

import {
  ArrowLeftRight,
  Check,
  Plus,
  RotateCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { BrandIcon } from "../../components/BrandIcon";
import { PopIn, ShimmerText, StepSpinner } from "../../components/Motion";
import mascotUrl from "../../assets/khai-mascot.png";
import { mockAppAuthClient, type Toolkit } from "./appAuthClient";
import { useAppAuth, type AppEntry } from "./useAppAuth";
import pageStyles from "../pages/Pages.module.css";
import styles from "./AppsPage.module.css";

const TABS = ["All", "Connected", "Available"] as const;
type Tab = (typeof TABS)[number];

function matchesTab(entry: AppEntry, tab: Tab): boolean {
  if (tab === "All") return true;
  const connected = entry.connection !== null;
  return tab === "Connected" ? connected : !connected;
}

export function AppsPage() {
  const { loading, entries, error, connect, disconnect } = useAppAuth(mockAppAuthClient);
  const [tab, setTab] = useState<Tab>("All");
  const [query, setQuery] = useState("");
  const [consentFor, setConsentFor] = useState<Toolkit | null>(null);

  const needle = query.trim().toLowerCase();
  const visible = entries.filter(
    (entry) =>
      matchesTab(entry, tab) &&
      (entry.toolkit.name.toLowerCase().includes(needle) ||
        entry.toolkit.category.toLowerCase().includes(needle)),
  );
  const active = entries.filter((entry) => entry.connection?.status === "active");
  const toolsReady = active.reduce((sum, entry) => sum + entry.toolkit.toolCount, 0);
  const attention = entries.filter(
    (entry) =>
      entry.connection?.status === "expired" || entry.connection?.status === "failed",
  ).length;

  return (
    <div className={pageStyles.page}>
      <header className={pageStyles.header}>
        <h1>App Authorization</h1>
        <div className={pageStyles.tabs} role="tablist">
          {TABS.map((name) => (
            <button
              type="button"
              role="tab"
              key={name}
              aria-selected={name === tab}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className={pageStyles.headerActions}>
          <label className={pageStyles.search}>
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search apps"
              aria-label="Search apps"
            />
          </label>
        </div>
      </header>

      <div className={styles.summary}>
        <span>
          <strong>{active.length}</strong> connected
        </span>
        <span>
          <strong>{toolsReady}</strong> tools available to the agent
        </span>
        {attention ? (
          <span data-tone="attention">
            <strong>{attention}</strong> need reconnecting
          </span>
        ) : null}
        <small>Preview — connections are simulated until Composio is linked.</small>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.grid} aria-busy={loading}>
        {loading
          ? Array.from({ length: 6 }, (_, index) => (
              <div className={styles.skeleton} key={index} aria-hidden="true" />
            ))
          : visible.map((entry, index) => (
              <AppCard
                key={entry.toolkit.slug}
                entry={entry}
                index={index}
                onConnect={() => setConsentFor(entry.toolkit)}
                onDisconnect={() => entry.connection && void disconnect(entry.connection)}
              />
            ))}
        {!loading && visible.length === 0 ? (
          <p className={pageStyles.empty}>No apps match.</p>
        ) : null}
      </div>

      {consentFor ? (
        <ConsentDialog
          toolkit={consentFor}
          onCancel={() => setConsentFor(null)}
          onApprove={() => {
            setConsentFor(null);
            void connect(consentFor.slug);
          }}
        />
      ) : null}
    </div>
  );
}

interface AppCardProps {
  entry: AppEntry;
  index: number;
  onConnect(): void;
  onDisconnect(): void;
}

function AppCard({ entry, index, onConnect, onDisconnect }: AppCardProps) {
  const { toolkit, connection } = entry;
  const status = connection?.status ?? "none";
  const meta = [
    toolkit.category,
    `${toolkit.toolCount} tools`,
    toolkit.authScheme === "api_key" ? "API key" : null,
    status === "active" ? connection?.accountLabel : null,
  ].filter(Boolean);
  return (
    <article
      className={styles.card}
      data-status={status}
      style={{ "--stagger": Math.min(index, 12) } as CSSProperties}
    >
      <span className={styles.logo}>
        <BrandIcon name={toolkit.slug} size={22} />
      </span>
      <div className={styles.cardBody}>
        <strong>{toolkit.name}</strong>
        <p>{toolkit.description}</p>
        <small>{meta.join(" · ")}</small>
      </div>
      <div className={styles.cardSide}>
        {status === "active" ? (
          <>
            <span className={styles.state} data-tone="success">
              <PopIn>
                <Check size={13} strokeWidth={2.6} />
              </PopIn>
              Connected
            </span>
            <button type="button" className={styles.link} data-tone="quiet" onClick={onDisconnect}>
              Disconnect
            </button>
          </>
        ) : status === "initiated" ? (
          <span className={styles.state}>
            <StepSpinner />
            <ShimmerText>Authorizing</ShimmerText>
          </span>
        ) : status === "expired" || status === "failed" ? (
          <>
            <span className={styles.state} data-tone="attention">
              {status === "expired" ? "Expired" : "Failed"}
            </span>
            <button type="button" className={styles.link} onClick={onConnect}>
              <RotateCw size={12} /> Reconnect
            </button>
          </>
        ) : (
          <>
            <span className={styles.state}>Not connected</span>
            <button type="button" className={styles.link} onClick={onConnect}>
              <Plus size={13} /> Connect
            </button>
          </>
        )}
      </div>
    </article>
  );
}

interface ConsentDialogProps {
  toolkit: Toolkit;
  onCancel(): void;
  onApprove(): void;
}

function ConsentDialog({ toolkit, onCancel, onApprove }: ConsentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [apiKey, setApiKey] = useState("");
  const needsKey = toolkit.authScheme === "api_key";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (typeof dialog?.showModal === "function" && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="app-consent-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <button type="button" className={styles.close} onClick={onCancel} aria-label="Close">
        <X size={15} />
      </button>
      <div className={styles.handshake} aria-hidden="true">
        <span className={styles.logo}>
          <img src={mascotUrl} alt="" />
        </span>
        <ArrowLeftRight size={16} />
        <span className={styles.logo}>
          <BrandIcon name={toolkit.slug} size={22} />
        </span>
      </div>
      <h2 id="app-consent-title">Connect {toolkit.name}</h2>
      <p className={styles.dialogLead}>
        Khai will be able to use {toolkit.toolCount} {toolkit.name} tools in your chats.
        It asks before taking any action that changes data.
      </p>
      <ul className={styles.scopes}>
        {toolkit.scopes.map((scope) => (
          <li key={scope}>
            <Check size={14} /> {scope}
          </li>
        ))}
      </ul>
      {needsKey ? (
        <label className={styles.keyField}>
          <span>{toolkit.name} API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Paste a key — not stored in the preview"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      ) : null}
      <p className={styles.secure}>
        <ShieldCheck size={14} />
        {needsKey
          ? "The key goes to Composio and never stays on this device."
          : `You'll finish signing in on ${toolkit.name}. Revoke access here at any time.`}
      </p>
      <div className={styles.dialogActions}>
        <button type="button" className={styles.ghost} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.connect}
          disabled={needsKey && !apiKey.trim()}
          onClick={onApprove}
        >
          {needsKey ? "Connect" : `Continue to ${toolkit.name}`}
        </button>
      </div>
    </dialog>
  );
}
