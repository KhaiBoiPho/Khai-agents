/**
 * KhaiDocs — a wiki running inside the desktop app. Its client is derived from
 * an AGPL-3.0 open-source wiki client (see ./README.md and ./LICENSE).
 *
 * This file is the host side: it gives the vendored client (./client, core
 * only — no Enterprise code) the providers its own main.tsx would, but kept
 * to this subtree: an in-memory router so the app's URL never changes, a
 * private i18next instance, and Mantine's CSS variables and colour scheme on
 * the KhaiDocs root instead of <html>. The server is Khai's own (Python,
 * app_server/khaidocs); the user is whoever the Khai session says.
 */

import "@mantine/core/styles.css";
import "./mantine.css";
import "./khaidocs-baseline.css";
import "./client/styles/a11y-overrides.css";
import "./notion/notion.css";

import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { HelmetProvider } from "react-helmet-async";
import { I18nextProvider, useTranslation } from "react-i18next";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import App from "./client/App";
import { readHostScheme, type HostScheme } from "./notion/host-scheme";
import { KhaiDocsSettings } from "./notion/SettingsPanel";
import i18n from "./client/i18n";
import { queryClient } from "./client/main";
import { mantineCssResolver, theme } from "./client/theme";
import { bindKhaiDocsRouter, trackKhaiDocsLocation } from "./client/lib/khaidocs-navigation";
import Page from "./client/pages/page/page";
import { UserProvider } from "./client/features/user/user-provider";

/** Follows the host theme: re-reads the scheme whenever the host restyles <html>. */
function useHostColorScheme(): HostScheme {
  const [scheme, setScheme] = useState<HostScheme>(readHostScheme);
  useEffect(() => {
    const update = () => setScheme(readHostScheme());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style", "class"],
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);
  return scheme;
}

function RouterBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    bindKhaiDocsRouter((to, options) => navigate(to, options));
  }, [navigate]);
  useEffect(() => {
    trackKhaiDocsLocation(location);
  }, [location]);
  return null;
}

/**
 * KhaiDocs speaks the language of the Khai app (English or Vietnamese). The
 * host's i18next instance is react-i18next's global one; KhaiDocs has its own.
 */
function useHostLanguage(): void {
  const { i18n: host } = useTranslation();
  const language = host.language?.toLowerCase().startsWith("vi") ? "vi-VN" : "en-US";
  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [language]);
}

/**
 * Mantine sizes everything in rem against a 16px root, but the host sets its
 * root font-size from the Appearance slider (14px by default), which would
 * shrink all of the client. `theme.scale` multiplies Mantine's rem values back
 * to the client's intended size, and follows the slider when it moves.
 */
function useRemScale(): number {
  const read = () => 16 / (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
  const [scale, setScale] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setScale(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, []);
  return scale;
}

/** Whether Khai's server answers (through the dev proxy in development). */
function useServerReachable(): boolean | null {
  const [reachable, setReachable] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/health", { cache: "no-store" })
      .then((response) => live && setReachable(response.ok))
      .catch(() => live && setReachable(false));
    return () => {
      live = false;
    };
  }, []);
  return reachable;
}

interface KhaiDocsAppProps {
  /** "settings" renders only KhaiDocs' settings, for the app's Settings window. */
  view?: "app" | "settings" | "page-panel";
  /** Open an existing KhaiDocs route, such as a page selected from chat notes. */
  initialPath?: string;
}

export default function KhaiDocsApp({ view = "app", initialPath = "/home" }: KhaiDocsAppProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useHostLanguage();
  const scheme = useHostColorScheme();
  const scale = useRemScale();
  const scaledTheme = useMemo(() => ({ ...theme, scale }), [scale]);
  const reachable = useServerReachable();

  // the client titles each page through Helmet; hand the window title back when
  // KhaiDocs closes.
  useEffect(() => {
    const title = document.title;
    return () => {
      document.title = title;
    };
  }, []);

  if (reachable === false) {
    return (
      <div className="khaidocs-notice" role="status">
        <p>
          KhaiDocs can&apos;t reach Khai&apos;s server. Make sure you are signed
          in and the server is running, then reopen KhaiDocs.
        </p>
      </div>
    );
  }

  return (
    <div
      className="khaidocs-root"
      data-view={view}
      ref={(node) => {
        rootRef.current = node;
        setRoot(node);
      }}
    >
      {root ? (
        <MemoryRouter initialEntries={[initialPath]}>
          <MantineProvider
            theme={scaledTheme}
            cssVariablesResolver={mantineCssResolver}
            cssVariablesSelector=".khaidocs-root"
            getRootElement={() => root}
            forceColorScheme={scheme}
          >
            <I18nextProvider i18n={i18n}>
              <ModalsProvider>
                <QueryClientProvider client={queryClient}>
                  <Notifications position="bottom-center" limit={3} zIndex={10000} />
                  <HelmetProvider>
                    <RouterBridge />
                    {view === "settings" ? <KhaiDocsSettings /> : view === "page-panel" ? (
                      <Routes>
                        <Route path="/s/:spaceSlug/p/:pageSlug" element={<UserProvider><Page /></UserProvider>} />
                      </Routes>
                    ) : <App />}
                  </HelmetProvider>
                </QueryClientProvider>
              </ModalsProvider>
            </I18nextProvider>
          </MantineProvider>
        </MemoryRouter>
      ) : null}
    </div>
  );
}
