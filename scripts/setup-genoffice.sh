#!/bin/sh
# Bundle the GenOffice CLI (Apache-2.0, https://github.com/genspark-ai/genoffice)
# into tools/genoffice/ so Khai's built-in `genoffice` MCP server and document
# skill work without the GenOffice desktop app.
#
#   scripts/setup-genoffice.sh                 copy from an installed GenOffice app
#   scripts/setup-genoffice.sh <checkout>      build packages/cli from a GenOffice
#                                              source checkout and copy the result
#
# Layout written (app/resources mirrors a Linux GenOffice install's resources/
# dir, so the CLI finds its runtime assets through its own
# `packagedResourcesDir()` lookup):
#
#   tools/genoffice/genoffice                          launcher (runs the CLI on node)
#   tools/genoffice/app/resources/cli/                 genoffice.cjs, package.json, node_modules, skills
#   tools/genoffice/app/resources/wasm/                pdfium.wasm (+ hb-subset.wasm) for PDF work
#   tools/genoffice/app/resources/native/xlsx-sidecar  formula engine (optional)
#   tools/genoffice/app/resources/ocr/                 OCR helper (optional)
#
# The extra app/ level matters on Linux: the CLI looks for the GenOffice GUI
# binary at <resources>/../genoffice, which with resources directly under
# tools/genoffice/ would be this bundle directory itself (spawn EACCES,
# reported as `app_crashed`); here it is absent, so renderer-backed commands
# fail cleanly with `app_unavailable` when no GenOffice app is installed.
#
# Only the Apache-2.0 CLI is copied; GenOffice's ee/ directory is never touched.
# tools/genoffice/ is git-ignored: re-run this script on every machine.
# Runtime resolution order (core/mcp/genoffice.py): $GENOFFICE_BIN, then this
# bundle, then `genoffice` on PATH.
set -eu

repo=$(cd "$(dirname "$0")/.." && pwd)
dest="$repo/tools/genoffice"
checkout="${1:-}"

fail() { echo "setup-genoffice: $*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "node (>= 22) is required on PATH"

find_app_resources() {
  for candidate in \
    "${GENOFFICE_APP_RESOURCES:-}" \
    "/Applications/GenOffice.app/Contents/Resources" \
    "$HOME/Applications/GenOffice.app/Contents/Resources" \
    "/opt/GenOffice/resources"; do
    [ -n "$candidate" ] && [ -f "$candidate/cli/genoffice.cjs" ] && { echo "$candidate"; return 0; }
  done
  # an installed `genoffice` symlink into an app bundle
  if bin=$(command -v genoffice 2>/dev/null); then
    while [ -L "$bin" ]; do
      target=$(readlink "$bin")
      case "$target" in /*) bin="$target" ;; *) bin="$(dirname "$bin")/$target" ;; esac
    done
    resources=$(cd "$(dirname "$bin")/.." && pwd)
    [ -f "$resources/cli/genoffice.cjs" ] && { echo "$resources"; return 0; }
  fi
  return 1
}

stage=$(mktemp -d "${TMPDIR:-/tmp}/genoffice-stage.XXXXXX")
trap 'rm -rf "$stage"' EXIT
chmod 755 "$stage"
res="$stage/app/resources"
mkdir -p "$res/cli" "$res/wasm" "$res/native" "$res/ocr"

if [ -n "$checkout" ]; then
  [ -f "$checkout/packages/cli/package.json" ] || fail "$checkout is not a GenOffice checkout"
  checkout=$(cd "$checkout" && pwd)
  echo "Building packages/cli in $checkout ..."
  if [ ! -d "$checkout/node_modules" ]; then
    (cd "$checkout" && npm ci --no-audit --no-fund)
  fi
  (cd "$checkout/packages/cli" && npm run build)
  cp "$checkout/packages/cli/dist/genoffice.cjs" "$res/cli/"
  cp -R "$checkout/packages/cli/dist/node_modules" "$res/cli/node_modules"
  cp "$checkout/packages/cli/package.json" "$res/cli/"
  mkdir -p "$res/cli/skills"
  cp -R "$checkout/skills/genoffice" "$res/cli/skills/genoffice"
  pdfium=$(cd "$checkout" && node -p "require.resolve('@embedpdf/pdfium/pdfium.wasm')" 2>/dev/null || true)
  [ -n "$pdfium" ] && [ -f "$pdfium" ] && cp "$pdfium" "$res/wasm/"
  sidecar="$checkout/apps/sheets/native/xlsx-engine/target/release/xlsx-sidecar"
  [ -x "$sidecar" ] && cp "$sidecar" "$res/native/"
  [ -x "$checkout/packages/pdf2docx/ocr-helper/vision-ocr" ] \
    && cp "$checkout/packages/pdf2docx/ocr-helper/vision-ocr" "$res/ocr/"
  for file in LICENSE NOTICE; do cp "$checkout/$file" "$stage/"; done
  source_desc="checkout $checkout"
else
  resources=$(find_app_resources) \
    || fail "no GenOffice app found; pass a GenOffice source checkout path instead"
  echo "Copying the GenOffice CLI from $resources ..."
  for item in genoffice.cjs package.json node_modules skills; do
    cp -R "$resources/cli/$item" "$res/cli/$item"
  done
  for dir in wasm native ocr; do
    [ -d "$resources/$dir" ] && cp -R "$resources/$dir/." "$res/$dir/"
  done
  [ -f "$resources/THIRD-PARTY-NOTICES.txt" ] && cp "$resources/THIRD-PARTY-NOTICES.txt" "$stage/"
  source_desc="app $resources"
fi

# Apache-2.0 attribution travels with the bundle even when copied from the app.
if [ ! -f "$stage/NOTICE" ]; then
  cat > "$stage/NOTICE" <<'EOF'
GenOffice
Copyright 2026 Mainfunc, Inc.

This product includes software developed at Mainfunc, Inc.
Licensed under the Apache License, Version 2.0
(https://www.apache.org/licenses/LICENSE-2.0).
EOF
fi

cat > "$stage/genoffice" <<'EOF'
#!/bin/sh
# Khai's bundled genoffice launcher: runs the GenOffice CLI on the system node.
# GENOFFICE_NODE overrides the Node binary (>= 22).
self="$0"
while [ -L "$self" ]; do
  target=$(readlink "$self")
  case "$target" in /*) self="$target" ;; *) self="$(dirname "$self")/$target" ;; esac
done
here=$(cd "$(dirname "$self")" && pwd)
node_bin="${GENOFFICE_NODE:-}"
if [ -z "$node_bin" ]; then
  node_bin=$(command -v node 2>/dev/null || true)
fi
if [ -z "$node_bin" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$candidate" ] && { node_bin="$candidate"; break; }
  done
fi
[ -n "$node_bin" ] || { echo "genoffice: node (>= 22) not found; set GENOFFICE_NODE" >&2; exit 127; }
exec "$node_bin" "$here/app/resources/cli/genoffice.cjs" "$@"
EOF
chmod +x "$stage/genoffice"

version=$("$stage/genoffice" --version 2>/dev/null) || fail "the staged CLI does not start on $(node --version)"
printf '%s\nsource: %s\nnode: %s\n' "$version" "$source_desc" "$(node --version)" > "$stage/VERSION"

rm -rf "$dest"
mkdir -p "$(dirname "$dest")"
mv "$stage" "$dest"
trap - EXIT
echo "Installed $version into $dest"
