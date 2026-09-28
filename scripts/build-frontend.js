// Builds the HTML/CSS/JS frontend.
//
//   frontend/pages/**/*.html  --(layouts + partials + inline icons)-->  views/**/*.html
//   frontend/styles/app.css   --(Tailwind CLI)-->                        public/assets/css/app.css
//   public/assets/js/**       (hand-written ES modules, served as-is)
//   node_modules vendors      --(copied)-->                              public/vendor/
//
// Pages start with a metadata comment:
//   <!-- @page {"title": "...", "description": "...", "layout": "marketing", "script": "home"} -->
// Layouts contain {{content}}, {{title}}, {{description}}, {{script}}, {{path}} placeholders and
// <!-- @include name --> directives resolved from frontend/partials. <i data-icon="name" class="..."></i>
// is replaced with the Lucide SVG at build time.
//
// Usage: node scripts/build-frontend.js [--no-css] [--watch-html]

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { buildCsp } from "../lib/security/csp.js";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const FRONTEND = path.join(ROOT, "frontend");
const VIEWS = path.join(ROOT, "views");
const PUBLIC = path.join(ROOT, "public");
const JS_DIR = path.join(PUBLIC, "assets", "js");
const { icons } = require("lucide");

const pascal = (name) => name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
const escAttr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escHtml = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function iconNode(name) {
  const node = icons[pascal(name)];
  if (!node) throw new Error(`Unknown Lucide icon "${name}"`);
  return node;
}

export function svgIcon(name, cls = "") {
  const inner = iconNode(name)
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escAttr(v)}"`).join(" ")}/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon ${escAttr(cls)}" aria-hidden="true">${inner}</svg>`;
}

function walk(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full, ext);
    return full.endsWith(ext) ? [full] : [];
  });
}

const read = (p) => fs.readFileSync(p, "utf8");

/**
 * Asset version: a hash of everything that shapes the browser JS and CSS. Pages
 * load /assets/v/<version>/…, which next.config.js rewrites to /assets/… and
 * marks immutable, so the CDN and browsers can cache assets for a year while
 * every deploy that changes them gets new URLs.
 */
let ASSET_VERSION = "dev";
function computeAssetVersion() {
  const h = createHash("sha1");
  const files = [
    ...walk(JS_DIR, ".js").filter((f) => !f.endsWith("icon-data.js")),
    ...walk(FRONTEND, ".html"),
    ...walk(FRONTEND, ".css"),
  ].sort();
  for (const f of files) h.update(path.relative(ROOT, f)).update(fs.readFileSync(f));
  return h.digest("hex").slice(0, 12);
}
const partial = (name) => read(path.join(FRONTEND, "partials", `${name}.html`));

function resolveIncludes(html, depth = 0) {
  if (depth > 5) throw new Error("Include depth exceeded");
  return html.replace(/<!--\s*@include\s+([a-z0-9-]+)\s*-->/g, (_, name) => resolveIncludes(partial(name), depth + 1));
}

function inlineIcons(html) {
  return html.replace(/<i\s+data-icon="([a-z0-9-]+)"(?:\s+class="([^"]*)")?\s*><\/i>/g, (_, name, cls) => svgIcon(name, cls ?? "h-4 w-4"));
}

function fill(html, vars) {
  return html.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (m, key) => (key in vars ? vars[key] : m));
}

function renderPage(body, meta, relPath) {
  const layout = read(path.join(FRONTEND, "layouts", `${meta.layout ?? "marketing"}.html`));
  const urlPath = "/" + relPath.replace(/\\/g, "/").replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "");
  const vars = {
    title: escHtml(meta.title ? `${meta.title} | HarborFinance Trading` : "HarborFinance Trading | Digital Asset Trading Platform"),
    rawTitle: escHtml(meta.title ?? "HarborFinance Trading"),
    description: escAttr(meta.description ?? "Trade and manage digital assets with professional market tools, portfolio analytics and secure account management."),
    robots: meta.robots ?? "index, follow",
    path: urlPath === "/" ? "/" : urlPath,
    assetBase: `/assets/v/${ASSET_VERSION}`,
    csp: buildCsp({ meta: true }),
    script: meta.script ?? "site",
    bodyClass: meta.bodyClass ?? "",
    content: body,
  };
  // Content may itself contain includes/icons; placeholders in content are filled too.
  return inlineIcons(fill(resolveIncludes(fill(layout, { content: body })), vars));
}

function parsePage(src, file) {
  const m = src.match(/^\s*<!--\s*@page\s+(\{[\s\S]*?\})\s*-->\s*/);
  if (!m) throw new Error(`Missing @page metadata in ${file}`);
  return { meta: JSON.parse(m[1]), body: src.slice(m[0].length) };
}

function writeView(relPath, html) {
  const out = path.join(VIEWS, relPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
}

async function buildContentPages() {
  const { ARTICLES } = await import(pathToFileURL(path.join(ROOT, "lib/content/learn.js")).href);
  const { FAQ_GROUPS } = await import(pathToFileURL(path.join(ROOT, "lib/content/faq.js")).href);
  const template = read(path.join(FRONTEND, "templates", "learn-article.html"));

  for (const a of ARTICLES) {
    const more = ARTICLES.filter((x) => x.slug !== a.slug)
      .slice(0, 3)
      .map((m) => `<a href="/learn/${m.slug}" class="rounded-xl border border-line bg-panel p-4 text-sm font-semibold text-white hover:border-line-strong">${escHtml(m.title)}</a>`)
      .join("");
    const sections = a.sections.map((s) => `<section><h2>${escHtml(s.heading)}</h2>${s.body.map((p) => `<p>${escHtml(p)}</p>`).join("")}</section>`).join("");
    const body = fill(template, {
      articleTitle: escHtml(a.title),
      articleSummary: escHtml(a.summary),
      articleCategory: escHtml(a.category),
      articleLevel: escHtml(a.level),
      articleMinutes: String(a.minutes),
      articleSections: sections,
      articleMore: more,
    });
    writeView(`learn/${a.slug}.html`, renderPage(body, { title: a.title, description: a.summary, layout: "marketing" }, `learn/${a.slug}.html`));
  }

  // Learn index cards and FAQ blocks are injected into their pages via markers.
  const learnCards = [...new Set(ARTICLES.map((a) => a.category))]
    .map(
      (cat) => `<section class="mb-12"><h2 class="font-display text-xl font-bold text-white">${escHtml(cat)}</h2><div class="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">${ARTICLES.filter((a) => a.category === cat)
        .map(
          (a) => `<a href="/learn/${a.slug}" class="group flex flex-col rounded-2xl border border-line bg-panel p-6 transition-all hover:-translate-y-0.5 hover:border-line-strong">
            <i data-icon="book-open" class="h-5 w-5 text-accent"></i>
            <h3 class="mt-4 font-display text-lg font-bold text-white group-hover:text-accent-strong">${escHtml(a.title)}</h3>
            <p class="mt-2 flex-1 text-sm leading-relaxed text-muted">${escHtml(a.summary)}</p>
            <div class="mt-5 flex items-center gap-3 text-xs text-dim"><span class="badge badge-neutral">${escHtml(a.level)}</span><span class="inline-flex items-center gap-1"><i data-icon="clock" class="h-3.5 w-3.5"></i> ${a.minutes} min read</span></div>
          </a>`,
        )
        .join("")}</div></section>`,
    )
    .join("");

  const faqDetails = (items) =>
    `<div class="divide-y divide-line rounded-2xl border border-line bg-panel">${items
      .map(
        (it) => `<details class="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden"><summary class="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-white">${escHtml(it.q)}<span class="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-strong text-muted transition-transform group-open:rotate-45">+</span></summary><div class="mt-3 text-sm leading-relaxed text-muted">${escHtml(it.a)}</div></details>`,
      )
      .join("")}</div>`;
  const faqGroups = FAQ_GROUPS.map((g) => `<section id="${g.id}" class="scroll-mt-24"><h2 class="mb-4 font-display text-xl font-bold text-white">${escHtml(g.title)}</h2>${faqDetails(g.items)}</section>`).join("");
  const faqNav = FAQ_GROUPS.map((g) => `<a href="#${g.id}" class="block rounded-lg px-3 py-2 text-sm text-muted hover:bg-panel hover:text-white">${escHtml(g.title)}</a>`).join("");
  const securityFaq = FAQ_GROUPS.find((g) => g.id === "security")
    .items.map((i) => `<div class="rounded-xl border border-line bg-panel p-4"><p class="font-semibold text-white">${escHtml(i.q)}</p><p class="mt-1 text-sm text-muted">${escHtml(i.a)}</p></div>`)
    .join("");

  return { "learn-cards": learnCards, "faq-groups": faqGroups, "faq-nav": faqNav, "faq-security": securityFaq };
}

async function buildViews() {
  const markers = await buildContentPages();
  for (const file of walk(path.join(FRONTEND, "pages"), ".html")) {
    const rel = path.relative(path.join(FRONTEND, "pages"), file);
    const { meta, body } = parsePage(read(file), rel);
    const withMarkers = body.replace(/<!--\s*@([a-z-]+)\s*-->/g, (m, name) => markers[name] ?? m);
    writeView(rel, renderPage(withMarkers, meta, rel));
  }
}

/** Collects every icon referenced from browser JS and writes a small icon module. */
function buildIconModule() {
  const names = new Set();
  for (const file of walk(JS_DIR, ".js")) {
    if (file.endsWith("icon-data.js")) continue;
    // Any string literal that is a valid Lucide icon name is included, so icon
    // names kept in data structures (e.g. ["wallet", ...]) are picked up too.
    for (const m of read(file).matchAll(/["'`]([a-z][a-z0-9-]*[a-z0-9])["'`]/g)) {
      if (icons[pascal(m[1])]) names.add(m[1]);
    }
  }
  const data = Object.fromEntries([...names].sort().map((n) => [n, iconNode(n)]));
  const out = `// Generated by scripts/build-frontend.js — Lucide icons used by the browser modules.\nexport const ICONS = ${JSON.stringify(data)};\n`;
  fs.writeFileSync(path.join(JS_DIR, "core", "icon-data.js"), out);
  return names.size;
}

function copyVendor() {
  const dir = path.join(PUBLIC, "vendor");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, "node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js"),
    path.join(dir, "lightweight-charts.standalone.js"),
  );
}

export function buildCss({ watch = false } = {}) {
  const cli = path.join(ROOT, "node_modules/@tailwindcss/cli/dist/index.mjs");
  const args = [cli, "-i", "frontend/styles/app.css", "-o", "public/assets/css/app.css", ...(watch ? ["--watch"] : ["--minify"])];
  return { cmd: process.execPath, args };
}

export async function buildHtml() {
  // Retries cover a concurrent rebuild from the dev watcher (Windows ENOTEMPTY).
  fs.rmSync(VIEWS, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  ASSET_VERSION = computeAssetVersion();
  await buildViews();
  // Read by next.config.js at build time: only this version is cached as immutable.
  fs.writeFileSync(path.join(VIEWS, "asset-version.json"), JSON.stringify({ version: ASSET_VERSION }) + "\n");
  const n = buildIconModule();
  return n;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const t = Date.now();
  const icons = await buildHtml();
  copyVendor();
  if (!process.argv.includes("--no-css")) {
    const { cmd, args } = buildCss();
    const r = spawnSync(cmd, args, { stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  console.log(`[frontend] built ${walk(VIEWS, ".html").length} pages, ${icons} icons in ${Date.now() - t}ms`);
}
