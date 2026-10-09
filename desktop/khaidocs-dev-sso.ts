/**
 * Single sign-on for KhaiDocs under the Vite dev server — the dev-time twin
 * of app_server/khaidocs_proxy.py.
 *
 * Vite proxies /api, /socket.io and /collab straight to Docmost, so without
 * this a browser with no Docmost session lands on Docmost's login page. With
 * KHAIDOCS_EMAIL and KHAIDOCS_PASSWORD set (the checkout's .env, written by
 * app_server/khaidocs_stack.py), a request that carries no Docmost session is
 * signed in here first and the browser is handed the cookie.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ProxyOptions } from "vite";

const AUTH_COOKIE = "authToken"; // Docmost's session cookie
// One login serves a page load's burst of parallel requests.
const TOKEN_REUSE_MS = 10 * 60 * 1000;

type SignedRequest = IncomingMessage & { khaiDocsMinted?: string };

export function khaiDocsDevSignOn(server: string, email: string, password: string) {
  let cached: { token: string; until: number } | null = null;
  let pending: Promise<string | null> | null = null;

  async function signIn(): Promise<string | null> {
    if (!email || !password) return null;
    if (cached && cached.until > Date.now()) return cached.token;
    pending ??= (async () => {
      try {
        const response = await fetch(`${server}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const token = response.headers
          .getSetCookie()
          .map((cookie) => cookie.match(new RegExp(`^${AUTH_COOKIE}=([^;]+)`))?.[1])
          .find(Boolean);
        if (!response.ok || !token) {
          console.warn(`[khaidocs] sign-in failed: HTTP ${response.status}`);
          return null;
        }
        cached = { token, until: Date.now() + TOKEN_REUSE_MS };
        return token;
      } catch (error) {
        console.warn(`[khaidocs] sign-in failed: ${error}`);
        return null;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  const proxied = (url = "") =>
    /^\/(api|socket\.io|collab)(\/|\?|$)/.test(url) && !url.startsWith("/api/auth/");

  const plugin: Plugin = {
    name: "khaidocs-dev-sso",
    configureServer(dev) {
      // Registered directly, so it runs ahead of Vite's own proxy middleware.
      dev.middlewares.use(async (req: SignedRequest, _res: ServerResponse, next) => {
        if (!proxied(req.url) || hasAuthCookie(req.headers.cookie)) return next();
        const token = await signIn();
        if (token) {
          req.headers.cookie = withAuthCookie(req.headers.cookie, token);
          req.khaiDocsMinted = token;
        }
        next();
      });
    },
  };

  /** Hands minted sessions to the browser and drops ones Docmost rejects. */
  const configure: ProxyOptions["configure"] = (proxy) => {
    proxy.on("proxyRes", (proxyRes, req: SignedRequest) => {
      const cookies = [proxyRes.headers["set-cookie"] ?? []].flat();
      if (req.khaiDocsMinted) {
        cookies.push(`${AUTH_COOKIE}=${req.khaiDocsMinted}; Path=/; HttpOnly; SameSite=Lax`);
      } else if (proxyRes.statusCode === 401 && proxied(req.url)) {
        // An expired session: forget it, so the next request signs in afresh.
        cached = null;
        cookies.push(`${AUTH_COOKIE}=; Path=/; Max-Age=0`);
      }
      if (cookies.length) proxyRes.headers["set-cookie"] = cookies;
    });
  };

  return { plugin, configure };
}

function hasAuthCookie(header: string | undefined): boolean {
  return (header ?? "").split(";").some((pair) => pair.trim().startsWith(`${AUTH_COOKIE}=`));
}

function withAuthCookie(header: string | undefined, token: string): string {
  const pairs = (header ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair && !pair.startsWith(`${AUTH_COOKIE}=`));
  return [...pairs, `${AUTH_COOKIE}=${token}`].join("; ");
}
