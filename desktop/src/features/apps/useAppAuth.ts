import { useCallback, useEffect, useMemo, useState } from "react";

import type { AppAuthClient, ConnectedAccount, Toolkit } from "./appAuthClient";

export interface AppEntry {
  toolkit: Toolkit;
  connection: ConnectedAccount | null;
}

/** Toolkits joined to their connected account, plus the actions on them. */
export function useAppAuth(client: AppAuthClient) {
  const [toolkits, setToolkits] = useState<Toolkit[] | null>(null);
  const [connections, setConnections] = useState<ConnectedAccount[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([client.listToolkits(), client.listConnections()])
      .then(([nextToolkits, nextConnections]) => {
        if (!live) return;
        setToolkits(nextToolkits);
        setConnections(nextConnections);
      })
      .catch((reason: unknown) => {
        if (live) setError(String(reason));
      });
    return () => {
      live = false;
    };
  }, [client]);

  const upsert = useCallback((connection: ConnectedAccount) => {
    setConnections((current) => [
      ...current.filter((item) => item.toolkitSlug !== connection.toolkitSlug),
      connection,
    ]);
  }, []);

  const connect = useCallback(
    async (slug: string) => {
      setError(null);
      try {
        const { connection, redirectUrl } = await client.connect(slug);
        upsert(connection);
        // TODO(backend): open redirectUrl in the system browser for OAuth.
        void redirectUrl;
        upsert(await client.waitForConnection(connection.id));
      } catch (reason) {
        setError(String(reason));
      }
    },
    [client, upsert],
  );

  const disconnect = useCallback(
    async (connection: ConnectedAccount) => {
      setError(null);
      try {
        await client.disconnect(connection.id);
        setConnections((current) => current.filter((item) => item.id !== connection.id));
      } catch (reason) {
        setError(String(reason));
      }
    },
    [client],
  );

  const entries = useMemo<AppEntry[]>(
    () =>
      (toolkits ?? []).map((toolkit) => ({
        toolkit,
        connection:
          connections.find((item) => item.toolkitSlug === toolkit.slug) ?? null,
      })),
    [connections, toolkits],
  );

  return { loading: toolkits === null, entries, error, connect, disconnect };
}
