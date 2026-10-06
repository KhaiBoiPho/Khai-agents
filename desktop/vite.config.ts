import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import postcss, { type AcceptedPlugin } from "postcss";
import mantinePreset from "postcss-preset-mantine";
import simpleVars from "postcss-simple-vars";

const host = process.env.TAURI_DEV_HOST;

/** Where the KhaiDocs (Docmost) server listens; docker/khaidocs starts it. */
const khaiDocsServer = process.env.KHAIDOCS_SERVER_URL ?? "http://localhost:3456";

// Docmost's stylesheets are written for postcss-preset-mantine, whose
// light-dark() and rem() rewrites would break the rest of the app's CSS
// (tokens.css uses the native light-dark()). So the preset runs only on
// files under features/khaidocs/.
// Mantine's bundled stylesheet opens with a global baseline (`:root`
// color-scheme, `body` font and background, `*` box-sizing) that would
// restyle the whole app; KhaiDocs scopes those to its root instead
// (khaidocs-baseline.css). The rest — component styles in Mantine's own
// cascade order, and its CSS variables — is kept as shipped.
const MANTINE_BASELINE_SELECTORS = new Set([
  ":root", ":host", "body", "*", "*::before", "*::after",
  "input", "button", "textarea", "select",
]);

const khaiDocsPostcss: AcceptedPlugin = {
  postcssPlugin: "khaidocs-mantine-scope",
  async Once(root) {
    const file = root.source?.input.file ?? "";
    if (file.endsWith("/@mantine/core/styles.css")) {
      root.walkRules((rule) => {
        const global = rule.selectors.every((selector) =>
          MANTINE_BASELINE_SELECTORS.has(selector.trim()),
        );
        const declaresVariables = rule.some(
          (node) => node.type === "decl" && node.prop.startsWith("--"),
        );
        if (global && !declaresVariables) rule.remove();
      });
      root.walkAtRules("media", (media) => {
        if (!media.nodes?.length) media.remove();
      });
      return;
    }
    if (!file.includes("/features/khaidocs/")) return;
    const result = await postcss([
      mantinePreset(),
      simpleVars({
        variables: {
          "mantine-breakpoint-xs": "36em",
          "mantine-breakpoint-sm": "48em",
          "mantine-breakpoint-md": "62em",
          "mantine-breakpoint-lg": "75em",
          "mantine-breakpoint-xl": "88em",
        },
      }),
    ]).process(root.clone(), { from: file });
    root.removeAll();
    root.append(result.root.nodes);
  },
};

function fingerprint(directory: string): string {
  const hash = createHash("sha256");
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const name = join(path, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) hash.update(name).update(readFileSync(name));
    }
  };
  visit(directory);
  hash.update(readFileSync("package-lock.json"));
  hash.update(readFileSync("vite.config.ts"));
  return hash.digest("hex").slice(0, 20);
}

export default defineConfig(({ mode }) => {
  const web = mode === "web";
  const buildId = web ? fingerprint("src") : "desktop";
  const version = readFileSync("../core/version.py", "utf8").match(
    /__version__\s*=\s*["']([^"']+)/,
  )?.[1];
  return {
    plugins: [
      react(),
      ...(web
        ? [
            {
              name: "deepcode-web-release",
              generateBundle() {
                this.emitFile({
                  type: "asset",
                  fileName: "web-build.json",
                  source: JSON.stringify({
                    version,
                    buildId,
                    protocolVersion: "1.0",
                  }),
                });
              },
            } satisfies Plugin,
          ]
        : []),
    ],
    define: {
      __WEB_BUILD_ID__: JSON.stringify(buildId),
      APP_VERSION: JSON.stringify("0.96.0"),
      __KHAIDOCS_CONFIG__: JSON.stringify({
        FILE_UPLOAD_SIZE_LIMIT: "50mb",
        FILE_IMPORT_SIZE_LIMIT: "200mb",
      }),
    },
    resolve: {
      alias: {
        "@docmost/editor-ext": resolve("src/features/khaidocs/editor-ext/index.ts"),
        "khaidocs-app": resolve("src/features/khaidocs/KhaiDocsApp.tsx"),
        "@": resolve("src/features/khaidocs/docmost"),
      },
    },
    css: { postcss: { plugins: [khaiDocsPostcss] } },
    ...(web
      ? { build: { outDir: "../app_server/web_assets", emptyOutDir: true } }
      : {}),
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
      proxy: {
        "/api": { target: khaiDocsServer, changeOrigin: true },
        "/socket.io": { target: khaiDocsServer, changeOrigin: true, ws: true },
        "/collab": { target: khaiDocsServer, changeOrigin: true, ws: true },
      },
    },
    test: {
      environment: "jsdom",
      exclude: [...configDefaults.exclude, "e2e/**"],
    },
  };
});
