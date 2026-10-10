---
name: web-artifacts-builder
description: Build a multi-component web app (React 18 + TypeScript + Tailwind + shadcn/ui) and bundle it into one self-contained HTML file in the workspace. Use for complex interactive pages that need state, routing or shadcn/ui components; not for a simple single-file HTML page (write that directly, styled with frontend-design).
license: Apache-2.0 (adapted from anthropics/skills web-artifacts-builder; see LICENSE.txt)
compatibility: Needs a shell with Node 18+ and network access to the npm registry (pnpm is installed on first use).
---

# Web artifacts builder

Produces `bundle.html`: one file with all JS, CSS and assets inlined that
opens in any browser offline. Khai shows it as a file card the user can open.

**Stack**: React 18 + TypeScript + Vite + Parcel (bundling) + Tailwind CSS
3.4 + shadcn/ui (40+ components, Radix UI).

## Preconditions

Check `node -v` (≥ 18) first. If Node is missing or the npm registry is
unreachable, say so and offer a single-file HTML page instead (plain
HTML/CSS/JS, no CDN) rather than failing halfway.

## Steps

The scripts live in this skill's directory (`<skill-dir>/scripts/`, next to
this SKILL.md); run them from inside the session workspace.

1. **Initialise**: `bash <skill-dir>/scripts/init-artifact.sh <project-name>`,
   then `cd <project-name>`. Creates a Vite React-TS project with Tailwind,
   the `@/` path alias, the shadcn/ui theme and components, and pins Vite to
   the installed Node version.
2. **Develop**: edit `src/` (components in `src/components/ui/`). Keep the
   root `index.html`.
3. **Bundle**: `bash <skill-dir>/scripts/bundle-artifact.sh` → `bundle.html`
   (Parcel build without source maps, then `html-inline`).
4. **Present**: give the workspace path of `bundle.html` and a one-line
   summary. Do not paste the bundle into chat.
5. **Test (optional)**: only when asked or when something looks broken — use
   the `webapp-testing` skill or a browser tool if one is available. Skipping
   upfront tests keeps latency low.

## Design

Follow `frontend-design` for the look. Avoid the generic "AI" look: endless
centred layouts, purple gradients, uniform rounded corners, Inter everywhere.

## Reference

- shadcn/ui components: https://ui.shadcn.com/docs/components
