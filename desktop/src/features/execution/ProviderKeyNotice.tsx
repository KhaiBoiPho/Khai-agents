import { KeyRound } from "lucide-react";

import type { ClientRuntime } from "../../rpc/contracts";
import { useConnectionCatalog } from "../settings/useConnectionCatalog";
import styles from "./ProviderKeyNotice.module.css";

interface ProviderKeyNoticeProps {
  runtime: ClientRuntime;
  projectId: string | null;
  /** The connection new chats run on (the system default is OpenRouter). */
  connectionId: string | null;
  onOpenSettings?: (section: string) => void;
}

/**
 * Asks for the user's own API key when the connection chats would run on has
 * none yet. Khai's default model is Luna 6 on OpenRouter, so a new account
 * sees this until it adds an OpenRouter key.
 */
export function ProviderKeyNotice({
  runtime,
  projectId,
  connectionId,
  onOpenSettings,
}: ProviderKeyNoticeProps) {
  const { catalog, loading } = useConnectionCatalog(runtime, projectId);
  if (loading || !catalog) return null;
  const target = connectionId ?? "openrouter";
  const connection = catalog.connections.find(
    (candidate) => candidate.id === target || candidate.providerName === target,
  );
  if (connection?.configured && connection.enabled) return null;
  const label = connection?.label ?? (target === "openrouter" ? "OpenRouter" : target);
  return (
    <div className={styles.notice} role="status">
      <KeyRound size={15} aria-hidden="true" />
      <span>
        Add your {label} API key to start chatting
        {target === "openrouter" ? " — Khai runs on Luna 6 by default." : "."}
      </span>
      {onOpenSettings ? (
        <button type="button" onClick={() => onOpenSettings("models")}>
          Add API key
        </button>
      ) : null}
    </div>
  );
}
