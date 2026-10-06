# Third-party software notices

DeepCode Desktop includes open-source Python, JavaScript, Rust, and platform
runtime components. Their package names, versions, license expressions, and
source metadata are recorded by the locked manifests:

- `desktop/sidecar-requirements.lock`
- `desktop/package-lock.json`
- `desktop/src-tauri/Cargo.lock`

The release pipeline runs `desktop/scripts/audit-licenses.py` against all three
resolved graphs and retains its machine-readable report as a build artifact.
The current dependency set uses permissive or weak-copyleft licenses including
MIT, Apache-2.0, BSD, ISC, MPL-2.0, Unicode, Python, Zlib, and CC0 variants.

PyInstaller is a build-time tool distributed under GPLv2-or-later with its
documented exception permitting distribution of non-free bundled programs.
Docling is optional and is not included in the Desktop sidecar; the packaged
baseline document converters use the Python standard library plus pypdf.

Operating-system WebViews and other system libraries retain the notices and
license terms supplied by their platform vendors. This file is informational;
the license text and source URL published by each dependency remain
authoritative.

## Flaticon interface accents

DeepCode Desktop includes adapted outline interface accents from the **Zeir
minimal user interface** pack by **The Icon Tree** on Flaticon. Attribution:
Icons designed by The Icon Tree from Flaticon.

- Pack: https://www.flaticon.com/packs/zeir-minimal-user-interface-14615833
- Poll: https://www.flaticon.com/free-icon/poll_15780511
- Terminal: https://www.flaticon.com/free-icon/terminal_15780766
- Settings: https://www.flaticon.com/free-icon/settings_15780826
- Time: https://www.flaticon.com/free-icon/time_15780852

These image assets are presentation-only and do not participate in Agent,
Session, protocol, or execution behavior.

## Docmost (KhaiDocs)

The KhaiDocs page vendors the web client and editor extensions of
**Docmost** 0.96.0, modified to run inside the desktop app, and the KhaiDocs
server is the stock `docmost/docmost` container image.

- Source: https://github.com/docmost/docmost
- License: GNU Affero General Public License v3.0 — Copyright (c) Docmost, Inc.
  Full text: `desktop/src/features/khaidocs/LICENSE`
- Modifications and their date: `desktop/src/features/khaidocs/README.md`

Distributing the desktop app with KhaiDocs subjects the distributed work to
the AGPL-3.0. Docmost's Enterprise Edition is not included; the files under
`desktop/src/features/khaidocs/docmost/ee/` are original MIT stand-ins.

## Yuvomi planner modules

The Desktop planner pages — Plan (tasks), Calendar, Schedule and Notes — are
TypeScript/React ports of the interface logic of the corresponding modules of
**Yuvomi**, as are the planner module tones in `desktop/src/styles/tokens.css`.

- Source: https://github.com/ulsklyc/yuvomi
- License: MIT — Copyright (c) 2026 ulsklyc

The MIT License requires this notice: Permission is hereby granted, free of
charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify,
merge, publish, distribute, sublicense, and/or sell copies of the Software, and
to permit persons to whom the Software is furnished to do so, subject to the
following conditions: The above copyright notice and this permission notice
shall be included in all copies or substantial portions of the Software. THE
SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Phosphor Icons

DeepCode Desktop includes two outline marks from the **Phosphor Icons** core
set, used for the Plugins and Skills empty states.

- Source: https://github.com/phosphor-icons/core
- Package: `@phosphor-icons/core` 2.1.1
- License: MIT — Copyright (c) 2023 Phosphor Icons

These image assets are presentation-only and do not participate in Agent,
Session, protocol, or execution behavior.

## Bundled Agent Skills

DeepCode bundles upstream Agent Skills from the following repositories. The
exact source path and pinned revision for each bundled package are recorded in
`core/skills/builtin/UPSTREAM_SOURCES.json`; upstream license files are kept
inside their respective Skill directories when supplied by the source.

- OpenAI Skills: https://github.com/openai/skills
- OpenAI Codex: https://github.com/openai/codex
- Anthropic Skills: https://github.com/anthropics/skills
- GenOffice: https://github.com/genspark-ai/genoffice (`genoffice`, adapted)

The Skill instructions remain attributable to their upstream authors. DeepCode
provides the host runtime, discovery, selection, resource access, and tool/MCP
integration used to execute them.

## GenOffice CLI and Agent Skill

Khai can run the **GenOffice** command line (`genoffice`, including its
`genoffice mcp` server) as the built-in `genoffice` MCP server, and bundles an
adapted copy of GenOffice's `genoffice` Agent Skill.

- Source: https://github.com/genspark-ai/genoffice (CLI: `packages/cli`;
  Skill: `skills/genoffice` at revision
  `db347087628281d49e53d009183d2fb506c3a444`)
- License: Apache License 2.0 — Copyright 2026 Mainfunc, Inc.
- Not used: GenOffice's `ee/` directory, which is under a separate commercial
  license; nothing from it is copied or bundled.
- The CLI is not committed to this repository. `scripts/setup-genoffice.sh`
  copies it (with GenOffice's own `THIRD-PARTY-NOTICES.txt` and `NOTICE`) into
  the git-ignored `tools/genoffice/` directory from an installed GenOffice app
  or builds it from a GenOffice source checkout.
- The Skill lives in `core/skills/builtin/genoffice/` with the full license
  text (`LICENSE.txt`) and GenOffice's `NOTICE`. Modifications: rewritten to
  drive the `mcp__genoffice__*` tools and to keep generated files inside the
  session workspace; `references/cli-reference.md` keeps upstream sections
  verbatim.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
these files except in compliance with the License. You may obtain a copy of the
License at http://www.apache.org/licenses/LICENSE-2.0. Unless required by
applicable law or agreed to in writing, software distributed under the License
is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.

GenOffice's NOTICE file:

```text
GenOffice
Copyright 2026 Mainfunc, Inc.

This product includes software developed at Mainfunc, Inc.

Bundled third-party components are listed in THIRD-PARTY-NOTICES.txt, which
tools/gen-third-party-notices.mjs generates at packaging time. It is not
checked into this repository; in a release build it ships inside the
application bundle (Contents/Resources on macOS, resources/ on Windows).
Run `node tools/gen-third-party-notices.mjs` to produce it from a source
checkout.

Bundled fonts and their licenses are documented in
apps/docs/src/renderer/fonts/README.md.

Unicode Character Database

apps/pdf/src/shared/radicals.ts contains a generated mapping derived from
Unicode Character Database 17.0.0, EquivalentUnifiedIdeograph.txt
(2025-08-01):
https://www.unicode.org/Public/17.0.0/ucd/EquivalentUnifiedIdeograph.txt

Copyright © 1991-2026 Unicode, Inc. This data is distributed under Unicode
License v3. The complete copyright and permission notice is reproduced in
LICENSE-UNICODE.txt.

Office Open XML schemas

tools/ooxml-validate/schemas contains the ISO/IEC 29500-4:2016 (ECMA-376
Part 4, Transitional) XML Schema files for PresentationML and DrawingML, as
distributed in the python-docx repository (ref/xsd), with one marked local
amendment (see tools/ooxml-validate/README.md). They are used only by tests
and development tooling and are not shipped in the application.
```

## Aider (repository map)

`core/codemap` follows the repository map of Aider
(https://github.com/Aider-AI/aider, Apache-2.0): tree-sitter tag extraction,
reference-weighted personalized PageRank and token-budgeted rendering. The
tag queries in `core/codemap/queries` are copied from Aider; see the NOTICE
in that folder for their grammar licenses.

## OpenAI Codex (agent prompts)

The agent system prompt in `core/agent_setup.py` and the `/init` prompt in
`desktop/src/features/execution/commands.ts` adapt prompts from OpenAI Codex
(https://github.com/openai/codex, Apache-2.0).
