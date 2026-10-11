#!/usr/bin/env node
// Build an HTML slide deck (one <section class="slide"> per 1280×720 slide)
// into PNG previews, a vector PDF and an editable PPTX, and lint it.
//
//   node build.mjs <deck.html> [--out <dir/name>] [--only check|pdf|pptx]
//
// PPTX: each slide's artwork (backgrounds, shapes, gradients, images, SVG
// charts) is rendered with its text hidden and placed as the slide picture;
// every text block is laid over it as a real, editable PowerPoint text box
// at the position, size, font and colour Chromium laid it out with.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(SKILL_DIR, "../../../..");
const RUNTIME = process.env.KHAI_SLIDES_HOME || join(REPO_ROOT, "tools", "slides");
const require = createRequire(join(RUNTIME, "package.json"));

const W = 1280;
const H = 720;
const PX_PER_IN = 96;

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error("usage: node build.mjs <deck.html> [--out <dir/name>] [--only check|pdf|pptx]");
  process.exit(2);
}

function parseArgs(argv) {
  const args = { input: null, out: null, only: null, scale: 2 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") args.out = argv[++i];
    else if (arg === "--only") args.only = argv[++i];
    else if (arg === "--help" || arg === "-h") usage();
    else if (arg.startsWith("--")) usage(`unknown option ${arg}`);
    else if (!args.input) args.input = arg;
    else usage(`unexpected argument ${arg}`);
  }
  if (!args.input) usage("missing deck.html");
  if (args.only && !["check", "pdf", "pptx"].includes(args.only)) usage("--only takes check, pdf or pptx");
  return args;
}

function chromiumPath() {
  const candidates = [
    process.env.KHAI_CHROMIUM,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path)) ?? undefined;
}

function fontFaces() {
  const dir = join(RUNTIME, "fonts");
  if (!existsSync(dir)) return "";
  const url = (file) => pathToFileURL(join(dir, file)).href;
  const be = [
    ["Regular", 400, "normal"],
    ["Italic", 400, "italic"],
    ["Medium", 500, "normal"],
    ["SemiBold", 600, "normal"],
    ["Bold", 700, "normal"],
    ["ExtraBold", 800, "normal"],
  ]
    .map(
      ([name, weight, style]) =>
        `@font-face{font-family:"Be Vietnam Pro";src:local("Be Vietnam Pro ${name}"),url("${url(`BeVietnamPro-${name}.ttf`)}");font-weight:${weight};font-style:${style}}`,
    )
    .join("\n");
  return [
    be,
    `@font-face{font-family:"Inter";src:url("${url("Inter[opsz,wght].ttf")}");font-weight:100 900}`,
    `@font-face{font-family:"Lora";src:url("${url("Lora[wght].ttf")}");font-weight:400 700}`,
    `@font-face{font-family:"JetBrains Mono";src:url("${url("JetBrainsMono[wght].ttf")}");font-weight:100 800}`,
  ].join("\n");
}

/** The deck with the fonts and theme injected first, so its own CSS wins. */
function preparedHtml(source) {
  const theme = readFileSync(join(SKILL_DIR, "assets", "theme.css"), "utf8");
  const inject = `<style data-khai-theme>\n${fontFaces()}\n${theme}\n</style>`;
  if (/<head[^>]*>/i.test(source)) return source.replace(/<head[^>]*>/i, (m) => `${m}\n${inject}`);
  if (/<html[^>]*>/i.test(source)) return source.replace(/<html[^>]*>/i, (m) => `${m}<head>${inject}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${inject}</head><body>${source}</body></html>`;
}

// ---------------------------------------------------------------- in page

/** Runs in the page: lint every slide and collect its text blocks. */
function inspectDeck() {
  const TEXT_TAGS = new Set([
    "H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "BLOCKQUOTE", "FIGCAPTION",
    "TD", "TH", "DT", "DD", "PRE", "CAPTION", "LABEL",
  ]);
  const slides = Array.from(document.querySelectorAll("section.slide"));
  const isContainer = (el) => el.hasAttribute("data-kx");

  function blockOf(node) {
    let el = node.parentElement;
    while (el && !el.classList.contains("slide")) {
      if (TEXT_TAGS.has(el.tagName)) return el;
      const display = getComputedStyle(el).display;
      if (!display.startsWith("inline") && display !== "contents") return el;
      el = el.parentElement;
    }
    return el;
  }

  // Any CSS colour (rgb(), color(srgb …), color-mix() results) to hex and
  // alpha, by painting it: the browser does the conversion.
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  probe.canvas.width = 1;
  probe.canvas.height = 1;
  function hex(color) {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "#000";
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    const h = [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    return { hex: h.toUpperCase(), alpha: Math.round((a / 255) * 100) / 100 };
  }

  // The colour behind an element: its own and its ancestors' backgrounds,
  // blended until opaque. null when an image or gradient is in the way.
  // What is painted under the text: hit-test its first line and walk the
  // stack downwards (positioned labels can sit outside their parent).
  function backdrop(el, rects) {
    const first = rects[0];
    const stack = first
      ? document.elementsFromPoint(first.left + Math.min(first.width / 2, 12), first.top + first.height / 2)
      : [];
    const chain = stack.length ? stack : [];
    if (!chain.length) for (let node = el; node; node = node.parentElement) chain.push(node);
    const layers = [];
    for (const node of chain) {
      if (node === document.body || node === document.documentElement) break;
      if (node.matches(".glow, .grid-bg")) continue;
      const s = getComputedStyle(node);
      if (s.backgroundImage && s.backgroundImage !== "none" && !node.matches("li, ol, ul")) return null;
      const { rgb, a } = rgba(s.backgroundColor);
      const opacity = Number(s.opacity);
      if (a > 0) layers.push({ rgb, a: a * opacity });
      if (a * opacity >= 1) break;
      if (node.classList.contains("slide")) break;
    }
    let base = [255, 255, 255];
    for (const layer of layers.reverse()) {
      base = base.map((v, i) => v * (1 - layer.a) + layer.rgb[i] * layer.a);
    }
    return base;
  }

  function rgba(color) {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "rgba(0,0,0,0)";
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    return { rgb: [r, g, b], a: a / 255 };
  }

  function luminance([r, g, b]) {
    const lin = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function contrast(fg, bg) {
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  function family(css) {
    return css.split(",")[0].trim().replace(/^["']|["']$/g, "");
  }

  function runStyle(el) {
    const s = getComputedStyle(el);
    const { hex: color, alpha } = hex(s.color);
    return {
      font: family(s.fontFamily),
      size: parseFloat(s.fontSize),
      bold: Number(s.fontWeight) >= 600,
      italic: s.fontStyle === "italic",
      underline: s.textDecorationLine.includes("underline"),
      strike: s.textDecorationLine.includes("line-through"),
      color,
      alpha,
      spacing: s.letterSpacing === "normal" ? 0 : parseFloat(s.letterSpacing) || 0,
      transform: s.textTransform,
      pre: s.whiteSpace.startsWith("pre"),
    };
  }

  function runsOf(container) {
    const runs = [];
    const visit = (node, owner) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const style = runStyle(owner);
          let text = child.textContent;
          if (!style.pre) text = text.replace(/\s+/g, " ");
          if (style.transform === "uppercase") text = text.toUpperCase();
          else if (style.transform === "lowercase") text = text.toLowerCase();
          if (text) runs.push({ text, ...style });
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.tagName === "BR") runs.push({ text: "\n", br: true });
          else if (isContainer(child) || child.matches(".notes, svg, script, style")) continue;
          else if (getComputedStyle(child).display === "none") continue;
          else visit(child, child);
        }
      }
    };
    visit(container, container);
    // Trim the outer whitespace HTML indentation leaves.
    while (runs.length && !runs[0].pre && !runs[0].text.trim()) runs.shift();
    while (runs.length && !runs.at(-1).pre && !runs.at(-1).text.trim()) runs.pop();
    if (runs.length && !runs[0].pre) runs[0].text = runs[0].text.replace(/^\s+/, "");
    if (runs.length && !runs.at(-1).pre) runs.at(-1).text = runs.at(-1).text.replace(/\s+$/, "");
    return runs;
  }

  const result = [];
  let next = 0;
  slides.forEach((slide, index) => {
    // Hit-testing (elementsFromPoint) only sees what is in the viewport.
    slide.scrollIntoView({ block: "start" });
    const box = slide.getBoundingClientRect();
    const warnings = [];
    const notes = Array.from(slide.querySelectorAll(".notes"))
      .map((n) => n.innerText.trim())
      .join("\n\n");

    // Text containers: the nearest block around each visible text node.
    const containers = new Set();
    const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest(".notes, svg, script, style, [data-pptx='image']")) continue;
      const style = getComputedStyle(parent);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      const block = blockOf(node);
      if (block) containers.add(block);
    }

    const blocks = [];
    let words = 0;
    for (const el of containers) el.setAttribute("data-kx", String(next++));
    for (const el of containers) {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const pl = parseFloat(s.paddingLeft) + parseFloat(s.borderLeftWidth);
      const pr = parseFloat(s.paddingRight) + parseFloat(s.borderRightWidth);
      const pt = parseFloat(s.paddingTop) + parseFloat(s.borderTopWidth);
      const pb = parseFloat(s.paddingBottom) + parseFloat(s.borderBottomWidth);
      const runs = runsOf(el);
      if (!runs.length) continue;
      const text = runs.map((run) => run.text).join("");
      words += text.split(/\s+/).filter(Boolean).length;
      // Where the text actually is (a flex item can be wider than its text).
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = Array.from(range.getClientRects()).filter((q) => q.width > 0 && q.height > 0);
      const lineHeight = s.lineHeight === "normal" ? parseFloat(s.fontSize) * 1.2 : parseFloat(s.lineHeight);
      const content = {
        x: r.left + pl - box.left,
        y: r.top + pt - box.top,
        w: r.width - pl - pr,
        h: r.height - pt - pb,
      };
      // Start the box at the first line of text, not at the element's top:
      // a ::before ornament (quote mark, number badge) can sit above it.
      if (rects.length) {
        const first = rects.reduce((a, q) => (q.top < a.top ? q : a));
        const last = rects.reduce((a, q) => (q.bottom > a.bottom ? q : a));
        const top = first.top - (lineHeight - first.height) / 2 - box.top;
        const bottom = last.bottom + (lineHeight - last.height) / 2 - box.top;
        if (top > content.y + 2) {
          content.h = Math.max(lineHeight, content.y + content.h - top);
          content.y = top;
        }
        content.h = Math.max(content.h, bottom - content.y);
      }
      let lines = 1;
      if (rects.length) {
        const tops = new Set(rects.map((q) => Math.round(q.top / (lineHeight * 0.6))));
        lines = Math.max(1, Math.round((Math.max(...rects.map((q) => q.bottom)) - Math.min(...rects.map((q) => q.top))) / lineHeight));
        if (tops.size === 1) lines = 1;
      }
      let align = s.textAlign === "start" ? "left" : s.textAlign === "end" ? "right" : s.textAlign;
      let valign = "top";
      if (s.display.includes("flex") || s.display.includes("grid")) {
        const column = s.flexDirection.startsWith("column");
        const main = s.justifyContent;
        const cross = s.alignItems;
        const horizontal = column ? cross : main;
        const vertical = column ? main : cross;
        if (horizontal.includes("center")) align = "center";
        if (vertical.includes("center")) valign = "middle";
        else if (vertical.includes("end")) valign = "bottom";
      }
      if (!["left", "right", "center", "justify"].includes(align)) align = "left";
      blocks.push({
        id: el.getAttribute("data-kx"),
        tag: el.tagName.toLowerCase(),
        ...content,
        lineHeight,
        lines,
        align,
        valign,
        runs,
        pseudo: ["::before", "::after", "::marker"].map((p) => [p, getComputedStyle(el, p).color]),
      });

      // Lint.
      const label = text.length > 48 ? `${text.slice(0, 45)}…` : text;
      const size = parseFloat(s.fontSize);
      if (size < 14) warnings.push(`text under 14px (${size}px): "${label}"`);
      if (el.scrollHeight > el.clientHeight + 2 && s.overflowY !== "visible") {
        warnings.push(`text clipped inside its box: "${label}"`);
      }
      const behind = backdrop(el, rects);
      if (behind) {
        const ink = rgba(s.color);
        const fg = ink.rgb.map((v, i) => v * ink.a + behind[i] * (1 - ink.a));
        const ratio = contrast(fg, behind);
        const large = size >= 24 || (size >= 18.5 && Number(s.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) {
          warnings.push(`low contrast ${ratio.toFixed(1)}:1 (text colour on its background): "${label}"`);
        }
      }
      const outside =
        r.left < box.left - 1 || r.top < box.top - 1 || r.right > box.right + 1 || r.bottom > box.bottom + 1;
      if (outside) warnings.push(`text runs off the slide: "${label}"`);
    }

    // Overflowing boxes and overlapping text.
    for (const el of slide.querySelectorAll("*")) {
      if (el.closest(".blob, .glow, .grid-bg, .notes, [data-allow-overflow]")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right > box.right + 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1 || r.top < box.top - 1) {
        const name = `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : ""}`;
        warnings.push(`element extends past the slide edge: ${name}`);
        break;
      }
    }
    for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        const a = blocks[i];
        const b = blocks[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 6 && oy > 6) {
          const t = (blk) => blk.runs.map((run) => run.text).join("").slice(0, 30);
          warnings.push(`text blocks overlap: "${t(a)}" and "${t(b)}"`);
        }
      }
    }
    // Boxes (anything with a fill or border) must not overlap unless one
    // contains the other.
    const boxes = Array.from(slide.querySelectorAll("*")).filter((el) => {
      if (el.closest(".blob, .glow, .grid-bg, .notes, [data-deco], [data-allow-overlap], svg")) return false;
      const s = getComputedStyle(el);
      if (s.position === "absolute" && el.parentElement === slide) return false;
      const filled = rgba(s.backgroundColor).a > 0.05 || s.backgroundImage !== "none";
      const bordered = ["Top", "Right", "Bottom", "Left"].some(
        (side) => parseFloat(s[`border${side}Width`]) > 0 && rgba(s[`border${side}Color`]).a > 0.05,
      );
      const r = el.getBoundingClientRect();
      return (filled || bordered) && r.width > 24 && r.height > 24;
    });
    const named = (el) =>
      `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).join(".")}` : ""}`;
    let overlaps = 0;
    for (let i = 0; i < boxes.length && overlaps < 3; i += 1) {
      for (let j = i + 1; j < boxes.length && overlaps < 3; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox > 2 && oy > 2) {
          overlaps += 1;
          warnings.push(`boxes overlap: ${named(a)} and ${named(b)}`);
        }
      }
    }
    // Text spilling out of the box it belongs to (a card squeezed by a full
    // slide), in-flow text only.
    spill: for (const el of boxes) {
      const r = el.getBoundingClientRect();
      for (const b of blocks) {
        const node = slide.querySelector(`[data-kx="${b.id}"]`);
        if (!node || !el.contains(node) || node === el) continue;
        if (getComputedStyle(node).position === "absolute") continue;
        if (b.y + b.h > r.bottom - box.top + 3 || b.x + b.w > r.right - box.left + 3) {
          warnings.push(`text spills out of its box: ${named(el)} (shorten it or give it room)`);
          break spill;
        }
      }
    }

    // Decorative shapes must not sit under text.
    for (const deco of slide.querySelectorAll(".blob, [data-deco]")) {
      const d = deco.getBoundingClientRect();
      for (const b of blocks) {
        const ox = Math.min(d.right - box.left, b.x + b.w) - Math.max(d.left - box.left, b.x);
        const oy = Math.min(d.bottom - box.top, b.y + b.h) - Math.max(d.top - box.top, b.y);
        if (ox > 4 && oy > 4) {
          warnings.push(`decorative shape covers text: "${b.runs.map((run) => run.text).join("").slice(0, 30)}"`);
          break;
        }
      }
    }
    // The content's lowest point: lots of empty space under it reads as unfinished.
    const lowest = Math.max(0, ...blocks.map((b) => b.y + b.h));
    if (!blocks.length) warnings.push("slide has no text");
    if (words > 110) warnings.push(`dense slide (${words} words): split it or cut copy`);
    result.push({ index: index + 1, words, lowest: Math.round(lowest), warnings, notes, blocks });
  });
  return result;
}

// ---------------------------------------------------------------- PPTX

function pptxRuns(block) {
  const runs = [];
  for (const run of block.runs) {
    if (run.br) {
      if (runs.length) runs.at(-1).options.breakLine = true;
      continue;
    }
    const parts = run.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0 && runs.length) runs.at(-1).options.breakLine = true;
      if (!part) return;
      runs.push({
        text: part,
        options: {
          fontFace: run.font,
          fontSize: Math.round(run.size * 0.75 * 10) / 10,
          bold: run.bold,
          italic: run.italic,
          underline: run.underline ? { style: "sng" } : undefined,
          strike: run.strike ? "sngStrike" : undefined,
          color: run.color,
          transparency: run.alpha < 1 ? Math.round((1 - run.alpha) * 100) : undefined,
          charSpacing: run.spacing ? Math.round(run.spacing * 0.75 * 10) / 10 : undefined,
        },
      });
    });
  }
  return runs;
}

function addTextBox(pptx, slide, block) {
  const runs = pptxRuns(block);
  if (!runs.length) return;
  // Fonts measure a hair differently in PowerPoint: a single line gets room
  // to grow instead of wrapping; wrapped text keeps its measured width.
  const single = block.lines <= 1;
  const slack = single ? Math.max(24, block.w * 0.12) : 2;
  let x = block.x;
  let w = block.w + slack;
  if (single && block.align === "center") x -= slack / 2;
  else if (single && block.align === "right") x -= slack;
  x = Math.max(0, x);
  w = Math.min(w, W - x);
  const lineSpacing = Math.round(block.lineHeight * 0.75 * 10) / 10;
  slide.addText(runs, {
    x: x / PX_PER_IN,
    y: block.y / PX_PER_IN,
    w: w / PX_PER_IN,
    h: Math.max(block.h, block.lineHeight) / PX_PER_IN,
    margin: 0,
    align: block.align,
    valign: block.valign,
    wrap: !single,
    lineSpacing,
    paraSpaceBefore: 0,
    paraSpaceAfter: 0,
    fit: "none",
  });
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = resolve(args.input);
  if (!existsSync(input)) usage(`${args.input} not found`);
  const out = resolve(args.out ?? join(dirname(input), basename(input, extname(input))));
  mkdirSync(dirname(out), { recursive: true });
  const previewDir = `${out}-preview`;
  rmSync(previewDir, { recursive: true, force: true });
  mkdirSync(previewDir, { recursive: true });

  const { chromium } = require("playwright-core");
  // Rendered next to the deck so its relative images and CSS resolve.
  const staged = join(dirname(input), `.${basename(input, extname(input))}.build.html`);
  writeFileSync(staged, preparedHtml(readFileSync(input, "utf8")));

  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    args: ["--disable-dev-shm-usage", "--font-render-hinting=none", "--allow-file-access-from-files"],
  });
  const report = { deck: input, slides: [], outputs: {} };
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: args.scale });
    const problems = [];
    page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
    page.on("requestfailed", (request) => problems.push(`missing file: ${decodeURI(request.url())}`));
    await page.goto(pathToFileURL(staged).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() =>
      Array.from(document.fonts)
        .filter((f) => f.status === "error")
        .map((f) => f.family),
    );
    if (fonts.length) problems.push(`fonts failed to load: ${[...new Set(fonts)].join(", ")}`);

    const slides = await page.evaluate(inspectDeck);
    if (!slides.length) throw new Error('no <section class="slide"> found in the deck');
    report.slides = slides.map(({ index, words, lowest, warnings, notes }) => ({
      index,
      words,
      warnings,
      ...(lowest < 360 ? { note: "content ends in the top half: enlarge or rebalance" } : {}),
      ...(notes ? { notes: true } : {}),
    }));
    report.problems = problems;

    // Previews.
    const handles = await page.$$("section.slide");
    const previews = [];
    for (let i = 0; i < handles.length; i += 1) {
      const file = join(previewDir, `slide-${String(i + 1).padStart(2, "0")}.png`);
      await handles[i].screenshot({ path: file, scale: "css" });
      previews.push(file);
    }
    report.outputs.previews = previewDir;

    if (args.only !== "check" && args.only !== "pptx") {
      const pdf = `${out}.pdf`;
      await page.pdf({ path: pdf, width: `${W}px`, height: `${H}px`, printBackground: true, preferCSSPageSize: true });
      report.outputs.pdf = pdf;
    }

    if (args.only !== "check" && args.only !== "pdf") {
      // Hide the text (keeping bullets and other pseudo-element artwork) and
      // render each slide's artwork as its picture.
      const css = [];
      for (const slide of slides) {
        for (const block of slide.blocks) {
          const sel = `[data-kx="${block.id}"]`;
          css.push(`${sel}{-webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important;caret-color:transparent!important}`);
          for (const [pseudo, color] of block.pseudo) css.push(`${sel}${pseudo}{-webkit-text-fill-color:${color}!important}`);
        }
      }
      await page.addStyleTag({ content: css.join("\n") });
      await page.evaluate(() => document.fonts.ready);

      const PptxGenJS = require("pptxgenjs");
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE"; // 13.333 × 7.5 in = 1280 × 720 px at 96 dpi
      const title = await page.title();
      if (title) pptx.title = title;
      for (let i = 0; i < handles.length; i += 1) {
        const art = await handles[i].screenshot({ type: "png", scale: "device" });
        const slide = pptx.addSlide();
        slide.background = { data: `data:image/png;base64,${art.toString("base64")}` };
        for (const block of slides[i].blocks) addTextBox(pptx, slide, block);
        if (slides[i].notes) slide.addNotes(slides[i].notes);
      }
      const file = `${out}.pptx`;
      await pptx.writeFile({ fileName: file, compression: true });
      report.outputs.pptx = file;
    }
  } finally {
    await browser.close();
    rmSync(staged, { force: true });
  }

  const warned = report.slides.filter((s) => s.warnings.length || s.note);
  report.ok = !warned.length && !report.problems.length;
  // Deliverables first, as `output_path` entries: Khai turns those into file
  // cards in the chat (the tool result preview is cut after a few KB).
  const files = [report.outputs.pdf, report.outputs.pptx]
    .filter(Boolean)
    .map((file) => ({ output_path: relative(process.cwd(), file) || file }));
  const warnings = report.slides.flatMap((slide) => [
    ...slide.warnings.map((w) => `slide ${slide.index}: ${w}`),
    ...(slide.note ? [`slide ${slide.index}: ${slide.note}`] : []),
  ]);
  console.log(
    JSON.stringify({ ok: report.ok, files, warnings: [...report.problems, ...warnings], ...report }, null, 2),
  );
  if (!report.ok) {
    console.error(
      `\n${warned.length} slide(s) with warnings${report.problems.length ? ` and ${report.problems.length} problem(s)` : ""}: fix them, rebuild, and look at the previews again.`,
    );
  }
}

main().catch((error) => {
  console.error(`build failed: ${error.message}`);
  process.exit(1);
});
