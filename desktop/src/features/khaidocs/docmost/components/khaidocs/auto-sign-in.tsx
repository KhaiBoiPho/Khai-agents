/*
 * Original KhaiDocs code, MIT.
 *
 * Single-user mode has no Docmost login form: the proxy in front of Docmost
 * signs in with the configured account (app_server/khaidocs_proxy.py, or
 * desktop/khaidocs-dev-sso.ts under Vite) as soon as a request arrives
 * without a session. Landing on /login therefore means only that a session
 * lapsed; asking the server again picks up a fresh one.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Center, Loader, Stack, Text } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { getPostLoginRedirect } from "@/lib/app-route.ts";

export default function AutoSignIn() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(false);
    const me = () => fetch("/api/users/me", { method: "POST", credentials: "include" });
    // A lapsed session answers 401 and is cleared; the retry signs in anew.
    me()
      .then((response) => (response.status === 401 ? me() : response))
      .then(async (response) => {
        if (!live) return;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await queryClient.invalidateQueries();
        navigate(getPostLoginRedirect(), { replace: true });
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [attempt, navigate, queryClient]);

  return (
    <Center h="100%" mih={240} p="xl">
      {failed ? (
        <Stack align="center" gap="sm" maw={420}>
          <Text ta="center" c="dimmed" size="sm">
            KhaiDocs couldn&apos;t sign in automatically. Make sure the KhaiDocs
            server is running and KHAIDOCS_EMAIL / KHAIDOCS_PASSWORD are set in
            the checkout&apos;s .env.
          </Text>
          <Button variant="default" size="xs" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </Stack>
      ) : (
        <Loader size="sm" />
      )}
    </Center>
  );
}
