/**
 * KhaiDocs — the Docmost wiki (AGPL-3.0, docmost/docmost) running inside the
 * desktop app.
 *
 * This file is the host side: it gives Docmost's client (./docmost, core
 * only — no Enterprise code) the providers its own main.tsx would, but kept
 * to this subtree: an in-memory router so the app's URL never changes, a
 * private i18next instance, and Mantine's CSS variables and colour scheme on
 * the KhaiDocs root instead of <html>. The server is the stock Docmost image;
 * see docker/khaidocs.
 */

import "@mantine/core/styles.css";
import "./mantine.css";
import "./khaidocs-baseline.css";
import "./docmost/styles/a11y-overrides.css";
import "./notion/notion.css";

import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { HelmetProvider } from "react-helmet-async";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";

import App from "./docmost/App";
import { KhaiDocsSettings } from "./notion/SettingsPanel";
import i18n from "./docmost/i18n";
import { queryClient } from "./docmost/main";
import { mantineCssResolver, theme } from "./docmost/theme";
import { bindKhaiDocsRouter, trackKhaiDocsLocation } from "./docmost/lib/khaidocs-navigation";

/**
 * Follows the host theme. `color-scheme` can't be read for this — the base
 * :root declares "light dark" — so the scheme comes from how light the app's
 * actual canvas colour is.
 */
function useHostColorScheme(): "light" | "dark" {
  const read = (): "light" | "dark" => {
    // Every theme defines --surface-canvas (#rrggbb or rgb()).
    const canvas = getComputedStyle(document.documentElement)
      .getPropertyValue("--surface-canvas")
      .trim();
    const hex = canvas.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})/i);
    const [r, g, b] = hex
      ? hex.slice(1).map((part) => parseInt(part, 16))
      : (canvas.match(/[\d.]+/g) ?? ["255", "255", "255"]).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? "dark" : "light";
  };
  const [scheme, setScheme] = useState<"light" | "dark">(read);
  useEffect(() => {
    const update = () => setScheme(read());
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
 * Mantine sizes everything in rem against a 16px root, but the host sets its
 * root font-size from the Appearance slider (14px by default), which would
 * shrink all of Docmost. `theme.scale` multiplies Mantine's rem values back
 * to Docmost's intended size, and follows the slider when it moves.
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

/** Whether the Docmost server answers through the dev proxy. */
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
  view?: "app" | "settings";
}

export default function KhaiDocsApp({ view = "app" }: KhaiDocsAppProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const scheme = useHostColorScheme();
  const scale = useRemScale();
  const scaledTheme = useMemo(() => ({ ...theme, scale }), [scale]);
  const reachable = useServerReachable();

  // Docmost titles each page through Helmet; hand the window title back when
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
          The KhaiDocs server isn&apos;t running. Start it with{" "}
          <code>docker/khaidocs/up.sh</code>, then reopen KhaiDocs.
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
        <MemoryRouter initialEntries={["/home"]}>
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
                    {view === "settings" ? <KhaiDocsSettings /> : <App />}
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
