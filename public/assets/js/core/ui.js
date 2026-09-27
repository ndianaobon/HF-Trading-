// Reusable UI components. Render helpers return trusted markup (Raw) built with
// `html`, so they compose inside other templates. Interactive widgets
// (DataTable, modal, toast) manage their own DOM.

import { html, raw, esc, $, $$, on, cx } from "./dom.js";
import { icon } from "./icons.js";
import { formatPercent, titleCase } from "./format.js";
import { invalidate } from "./store.js";

/* ───────────── Badges ───────────── */

const STATUS_TONES = {
  COMPLETED: "up", FILLED: "up", ACTIVE: "up", APPROVED: "up", RESOLVED: "up",
  CONFIRMING: "info", PROCESSING: "info", IN_PROGRESS: "info", PARTIALLY_FILLED: "info", ACCEPTED: "info",
  PENDING: "warn", PENDING_REVIEW: "warn", PENDING_VERIFICATION: "warn", WAITING_FOR_USER: "warn",
  OPEN: "accent",
  FAILED: "down", REJECTED: "down", SUSPENDED: "down", BANNED: "down", HALTED: "down",
};
const RISK_TONES = { LOW: "up", MEDIUM: "info", HIGH: "warn", VERY_HIGH: "down" };

export const badge = (text, tone = "neutral", cls = "") => html`<span class="${cx("badge", `badge-${tone}`, cls)}">${text}</span>`;
export const statusBadge = (status, label) => html`<span class="badge badge-dot badge-${STATUS_TONES[status] ?? "neutral"}">${label ?? titleCase(status)}</span>`;
export const riskBadge = (level) => badge(`${titleCase(level)} risk`, RISK_TONES[level] ?? "neutral");
export const demoBadge = (label = "Demo", cls = "") => badge(label, "warn", cls);
export const smallDemo = () => demoBadge("Demo", "px-1.5 py-0 text-[9px]");
/** Orders and trades filled by the internal simulator (no exchange is connected). */
export const smallSim = () => demoBadge("Simulated", "px-1.5 py-0 text-[9px]");

/* ───────────── Display ───────────── */

export const skeleton = (cls = "h-4 w-full") => html`<div class="${cx("skeleton", cls)}" aria-hidden="true"></div>`;
export const skeletonRows = (n = 5, cls = "") =>
  html`<div class="${cx("space-y-2.5", cls)}" aria-busy="true" aria-label="Loading">${Array.from({ length: n }, () => skeleton("h-10 w-full"))}</div>`;

export function emptyState({ title, description, action, iconName = "inbox", cls = "" }) {
  return html`<div class="${cx("flex flex-col items-center justify-center px-6 py-12 text-center", cls)}">
    <div class="mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-line bg-panel-2 text-dim">${icon(iconName, "h-5 w-5")}</div>
    <p class="font-display text-[15px] font-bold text-white">${title}</p>
    ${description ? html`<p class="mt-1 max-w-sm text-sm text-muted">${description}</p>` : ""}
    ${action ? html`<div class="mt-5">${action}</div>` : ""}
  </div>`;
}

export function errorState({ title = "Unable to load", message, retry = true, cls = "" }) {
  return html`<div class="${cx("flex flex-col items-center justify-center px-6 py-10 text-center", cls)}" role="alert">
    <div class="mb-4 grid h-12 w-12 place-items-center rounded-2xl border border-down/25 bg-down-soft text-down">${icon("alert-triangle", "h-5 w-5")}</div>
    <p class="font-display text-[15px] font-bold text-white">${title}</p>
    ${message ? html`<p class="mt-1 max-w-sm text-sm text-muted">${message}</p>` : ""}
    ${retry ? html`<button type="button" data-action="retry" class="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong">${icon("refresh-cw", "h-3.5 w-3.5")} Try again</button>` : ""}
  </div>`;
}

export function notice(tone, { title, body, iconName = "alert-triangle", cls = "" } = {}) {
  return html`<div class="${cx("notice", `notice-${tone}`, cls)}" role="${tone === "down" ? "alert" : "status"}">
    ${iconName ? html`<div class="mt-0.5 shrink-0">${icon(iconName, "h-4 w-4")}</div>` : ""}
    <div class="min-w-0">${title ? html`<p class="font-semibold">${title}</p>` : ""}${body ? html`<div class="notice-body">${body}</div>` : ""}</div>
  </div>`;
}

export function stat({ label, value, sub, iconName, loading, cls = "" }) {
  return html`<div class="${cx("stat", cls)}">
    <div class="flex items-center justify-between gap-2"><p class="stat-label">${label}</p>${iconName ? html`<span class="text-dim">${icon(iconName, "h-4 w-4")}</span>` : ""}</div>
    ${loading ? skeleton("mt-3 h-7 w-32") : html`<p class="stat-value">${value}</p>`}
    ${sub ? html`<div class="mt-1 text-[13px] text-muted">${sub}</div>` : ""}
  </div>`;
}

export function card({ title, description, action, body, cls = "", iconName }) {
  return html`<section class="${cx("card", cls)}">
    ${title
      ? html`<div class="card-header"><div class="flex min-w-0 items-start gap-3">${iconName ? html`<div class="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-panel-3 text-accent">${icon(iconName, "h-4 w-4")}</div>` : ""}<div class="min-w-0"><h3 class="card-title">${title}</h3>${description ? html`<p class="card-desc">${description}</p>` : ""}</div></div>${action ? html`<div class="shrink-0">${action}</div>` : ""}</div>`
      : ""}
    ${body ?? ""}
  </section>`;
}

export function pageHeader({ title, description, actions }) {
  return html`<div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0"><h1 class="font-display text-2xl font-extrabold tracking-tight text-white sm:text-[28px]">${title}</h1>${description ? html`<p class="mt-1 text-sm text-muted">${description}</p>` : ""}</div>
    ${actions ? html`<div class="flex flex-wrap gap-2">${actions}</div>` : ""}
  </div>`;
}

export function assetIcon(symbol, color = "#66748d", size = 28, cls = "") {
  const fs = size * (symbol.length > 3 ? 0.28 : 0.34);
  return html`<span class="${cx("asset-icon inline-grid shrink-0 place-items-center rounded-full font-display font-extrabold", cls)}" aria-hidden="true" style="--c:${esc(color)};width:${size}px;height:${size}px;font-size:${fs}px;background:radial-gradient(circle at 30% 25%, ${esc(color)}55, ${esc(color)}22 70%);color:${esc(color)};box-shadow:inset 0 0 0 1px ${esc(color)}55">${symbol.slice(0, 4)}</span>`;
}

export function avatar(name, color = "#F4BE2C", size = 32) {
  const initials = String(name).split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return html`<span class="inline-grid shrink-0 place-items-center rounded-full font-bold" aria-hidden="true" style="width:${size}px;height:${size}px;font-size:${size * 0.38}px;background:${esc(color)}26;color:${esc(color)};box-shadow:inset 0 0 0 1px ${esc(color)}55">${initials}</span>`;
}

export function priceChange(v, { withIcon = false, cls = "" } = {}) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return html`<span class="${cx("text-dim", cls)}">—</span>`;
  const up = Number(v) >= 0;
  return html`<span class="${cx("num inline-flex items-center gap-0.5 font-semibold", up ? "text-up" : "text-down", cls)}">${withIcon ? icon(up ? "arrow-up-right" : "arrow-down-right", "h-3.5 w-3.5") : ""}${formatPercent(v)}</span>`;
}

let sparkId = 0;
export function sparkline(data, width = 96, height = 32, positive) {
  if (!data || data.length < 2) return html`<div style="width:${width}px;height:${height}px"></div>`;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 2 - ((v - min) / range) * (height - 4)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const up = positive ?? data[data.length - 1] >= data[0];
  const color = up ? "var(--color-up)" : "var(--color-down)";
  const id = `sg${++sparkId}`;
  return raw(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.25"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${d} L${width},${height} L0,${height} Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`,
  );
}

const FEED = {
  live: ["Live", "text-up", "Streaming live prices from the market-data provider"],
  polling: ["Live · polled", "text-up", "Prices refreshed from the provider every few seconds"],
  connecting: ["Connecting", "text-muted", "Connecting to the market-data provider"],
  delayed: ["Delayed", "text-warn", "The provider is not responding; showing the last known prices"],
  unavailable: ["Market data unavailable", "text-down", "No market data is available right now"],
};
export function feedStatus(mode, provider) {
  const [label, cls, title] = FEED[mode] ?? FEED.connecting;
  const pulsing = mode === "live" || mode === "polling";
  return html`<span class="${cx("inline-flex items-center gap-1.5 text-[11px] font-semibold", cls)}" title="${title}">
    <span class="relative flex h-2 w-2">${pulsing ? html`<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-50"></span>` : ""}<span class="relative inline-flex h-2 w-2 rounded-full bg-current"></span></span>
    ${label}${provider && (pulsing || mode === "delayed") ? html`<span class="font-medium text-dim">· ${provider}</span>` : ""}
  </span>`;
}

/* ───────────── Controls ───────────── */

export function tabs(items, value, { size = "md", cls = "", name = "tab" } = {}) {
  return html`<div role="tablist" class="${cx("tabs", size === "sm" && "sm", cls)}">${items.map(
    (it) =>
      html`<button type="button" role="tab" class="tab" data-${raw(name)}="${it.value}" aria-selected="${it.value === value}">${it.label}${it.count !== undefined && it.count !== null ? html`<span class="count">${it.count}</span>` : ""}</button>`,
  )}</div>`;
}

export function segmented(items, value, { size = "md", cls = "", name = "seg" } = {}) {
  return html`<div role="radiogroup" class="${cx("segmented", size === "sm" && "sm", cls)}">${items.map(
    (it) => html`<button type="button" role="radio" class="${it.cls ?? ""}" data-${raw(name)}="${it.value}" aria-checked="${it.value === value}">${it.label}</button>`,
  )}</div>`;
}

export function pagination(page, pageCount, total) {
  if (!pageCount || pageCount <= 1) return total !== undefined ? html`<p class="px-1 text-xs text-dim">${total} result${total === 1 ? "" : "s"}</p>` : html``;
  return html`<div class="flex items-center justify-between gap-3 text-xs text-dim">
    <span>Page ${page} of ${pageCount}${total !== undefined ? ` · ${total.toLocaleString()} results` : ""}</span>
    <div class="flex gap-1">
      <button type="button" data-page="${page - 1}" ${page <= 1 ? raw("disabled") : ""} class="grid h-8 w-8 place-items-center rounded-lg border border-line-strong text-muted hover:text-white disabled:opacity-40" aria-label="Previous page">${icon("chevron-left", "h-4 w-4")}</button>
      <button type="button" data-page="${page + 1}" ${page >= pageCount ? raw("disabled") : ""} class="grid h-8 w-8 place-items-center rounded-lg border border-line-strong text-muted hover:text-white disabled:opacity-40" aria-label="Next page">${icon("chevron-right", "h-4 w-4")}</button>
    </div>
  </div>`;
}

/** Loading spinner inside a button while an async action runs. */
export async function withBusy(button, fn) {
  if (!button) return fn();
  const prev = button.innerHTML;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${prev}`;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.innerHTML = prev;
  }
}

/* ───────────── Data table ───────────── */

/**
 * Sortable table. columns: [{ key, header, cell(row) → markup, sortValue?(row), align?, hideOnMobile?, cls? }]
 */
export class DataTable {
  constructor(el, { columns, rowKey, onRowClick, empty, dense, defaultSort, rowClass }) {
    this.el = el;
    this.columns = columns;
    this.rowKey = rowKey;
    this.onRowClick = onRowClick;
    this.empty = empty ?? emptyState({ title: "Nothing here yet" });
    this.dense = dense;
    this.sort = defaultSort ?? null;
    this.rowClass = rowClass;
    this.rows = undefined;
    this.state = { loading: true };
    on(el, "click", "th button[data-sort]", (_e, b) => {
      const key = b.dataset.sort;
      this.sort = this.sort?.key === key ? { key, dir: this.sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" };
      this.render();
    });
    on(el, "click", "tr[data-row]", (e, tr) => {
      if (!this.onRowClick || e.target.closest("a,button,input,select,label")) return;
      const row = this.sorted()[Number(tr.dataset.row)];
      if (row) this.onRowClick(row);
    });
  }

  set(rows, { loading = false, error = null } = {}) {
    this.rows = rows;
    this.state = { loading, error };
    this.render();
  }

  sorted() {
    if (!this.rows || !this.sort) return this.rows ?? [];
    const col = this.columns.find((c) => c.key === this.sort.key);
    if (!col?.sortValue) return this.rows;
    const dir = this.sort.dir === "asc" ? 1 : -1;
    return [...this.rows].sort((a, b) => {
      const av = col.sortValue(a);
      const bv = col.sortValue(b);
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return (typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv))) * dir;
    });
  }

  render() {
    const { loading, error } = this.state;
    if (error && !this.rows) {
      this.el.innerHTML = String(errorState({ message: error.message }));
      return;
    }
    if (loading && !this.rows) {
      this.el.innerHTML = String(skeletonRows(6, "p-4"));
      return;
    }
    const rows = this.sorted();
    if (!rows.length) {
      this.el.innerHTML = String(this.empty);
      return;
    }
    const align = (a) => (a === "right" ? "r" : a === "center" ? "c" : "");
    const head = this.columns.map((c) => {
      const active = this.sort?.key === c.key;
      const cls = cx(align(c.align), c.hideOnMobile && "hide-sm", c.cls);
      if (!c.sortValue) return html`<th scope="col" class="${cls}">${c.header}</th>`;
      return html`<th scope="col" class="${cls}" ${active ? raw(`aria-sort="${this.sort.dir === "asc" ? "ascending" : "descending"}"`) : ""}><button type="button" data-sort="${c.key}">${c.header}${icon(active ? (this.sort.dir === "asc" ? "arrow-up" : "arrow-down") : "chevrons-up-down", cx("h-3 w-3", !active && "opacity-50"))}</button></th>`;
    });
    const body = rows.map(
      (r, i) =>
        html`<tr data-row="${i}" class="${cx(this.onRowClick && "clickable", this.rowClass?.(r))}">${this.columns.map((c) => html`<td class="${cx(align(c.align), c.hideOnMobile && "hide-sm", c.cls)}">${c.cell(r)}</td>`)}</tr>`,
    );
    this.el.innerHTML = String(html`<div class="overflow-x-auto"><table class="${cx("table", this.dense && "dense")}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
  }
}

/* ───────────── Modal ───────────── */

/**
 * Opens a modal dialog. Returns { el, body, footer, close, setBody, setFooter }.
 * Focus is trapped and Escape closes it.
 */
export function openModal({ title, description, body = "", footer, size = "md", onClose }) {
  const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl", xl: "max-w-4xl" };
  const prevFocus = document.activeElement;
  const root = document.createElement("div");
  root.className = "modal-root";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.innerHTML = String(html`<div class="modal-backdrop" data-close></div>
    <div class="${cx("modal-panel", widths[size])}">
      <div class="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div><h2 class="font-display text-lg font-bold text-white" data-modal-title>${title}</h2>${description ? html`<p class="mt-0.5 text-sm text-muted">${description}</p>` : ""}</div>
        <button type="button" data-close class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-dim hover:bg-panel-3 hover:text-fg" aria-label="Close">${icon("x", "h-4 w-4")}</button>
      </div>
      <div class="overflow-y-auto px-5 py-4" data-modal-body>${body}</div>
      <div class="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end" data-modal-footer ${footer ? "" : raw("hidden")}>${footer ?? ""}</div>
    </div>`);
  document.body.appendChild(root);
  document.body.style.overflow = "hidden";
  const panel = $(".modal-panel", root);
  const bodyEl = $("[data-modal-body]", root);
  const footerEl = $("[data-modal-footer]", root);

  const onKey = (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Tab") {
      const f = $$('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', panel);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    }
  };
  document.addEventListener("keydown", onKey);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    root.remove();
    if (!document.querySelector(".modal-root")) document.body.style.overflow = "";
    prevFocus?.focus?.();
    onClose?.();
  }
  on(root, "click", "[data-close]", close);
  setTimeout(() => (panel.querySelector("input, select, textarea") ?? panel.querySelector("button:not([data-close])"))?.focus(), 30);
  return {
    el: panel,
    body: bodyEl,
    footer: footerEl,
    close,
    setBody: (m) => (bodyEl.innerHTML = String(m)),
    setFooter: (m) => {
      footerEl.innerHTML = String(m);
      footerEl.hidden = !m;
    },
  };
}

/** Simple confirmation dialog; resolves true when confirmed. */
export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal({
      title,
      body: html`<p class="text-sm text-muted">${message}</p>`,
      footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm>${confirmLabel}</button>`,
      size: "sm",
      onClose: () => resolve(result),
    });
    on(m.el, "click", "[data-confirm]", () => {
      result = true;
      m.close();
    });
  });
}

/* ───────────── Toasts ───────────── */

function toastRoot() {
  let el = document.getElementById("toasts");
  if (!el) {
    el = document.createElement("div");
    el.id = "toasts";
    el.className = "pointer-events-none fixed right-4 bottom-20 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 md:bottom-4";
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  return el;
}

function pushToast(tone, title, description) {
  const root = toastRoot();
  const iconName = tone === "success" ? "check-circle-2" : tone === "error" ? "alert-triangle" : "info";
  const color = tone === "success" ? "text-up" : tone === "error" ? "text-down" : "text-info";
  const border = tone === "success" ? "border-up/30" : tone === "error" ? "border-down/30" : "border-line-strong";
  const el = document.createElement("div");
  el.className = `glass pointer-events-auto flex animate-slide-up gap-3 rounded-xl border p-3.5 shadow-[var(--shadow-pop)] ${border}`;
  el.setAttribute("role", tone === "error" ? "alert" : "status");
  el.innerHTML = String(html`${icon(iconName, `mt-0.5 h-4 w-4 shrink-0 ${color}`)}<div class="min-w-0 flex-1"><p class="text-sm font-semibold text-white">${title}</p>${description ? html`<p class="mt-0.5 text-[13px] text-muted">${description}</p>` : ""}</div><button type="button" class="text-dim hover:text-fg" aria-label="Dismiss">${icon("x", "h-4 w-4")}</button>`);
  el.querySelector("button").onclick = () => el.remove();
  root.appendChild(el);
  while (root.children.length > 4) root.firstElementChild.remove();
  setTimeout(() => el.remove(), tone === "error" ? 7000 : 4500);
}

export const toast = {
  success: (t, d) => pushToast("success", t, d),
  error: (t, d) => pushToast("error", t, d),
  info: (t, d) => pushToast("info", t, d),
};

/* ───────────── Global behaviours ───────────── */

// "Try again" in error states refetches every watched API resource.
document.addEventListener("click", (e) => {
  if (e.target.closest?.('[data-action="retry"]')) invalidate("/api");
});

/** Downloads rows as a CSV file. Values are quoted when needed. */
export function downloadCsv(filename, header, rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Copy-to-clipboard for any element with data-copy="value".
document.addEventListener("click", async (e) => {
  const btn = e.target.closest?.("[data-copy]");
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    const label = btn.querySelector("[data-copy-label]");
    if (label) {
      const prev = label.textContent;
      label.textContent = "Copied";
      setTimeout(() => (label.textContent = prev), 1500);
    } else toast.success("Copied to clipboard");
  } catch {
    toast.error("Copy failed", "Your browser blocked clipboard access.");
  }
});

export const copyButton = (value, label = "Copy", compact = false) =>
  compact
    ? html`<button type="button" data-copy="${value}" class="inline-flex items-center rounded p-1 text-dim hover:text-white" aria-label="${label}">${icon("copy", "h-3.5 w-3.5")}</button>`
    : html`<button type="button" data-copy="${value}" class="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-accent/50 hover:text-white">${icon("copy", "h-3.5 w-3.5")}<span data-copy-label>${label}</span></button>`;

/** Toggles a dropdown panel anchored to `anchor`; closes on outside click / Escape. */
export function dropdown(anchor, render, { width = "w-64" } = {}) {
  const existing = anchor.querySelector(":scope > .dropdown");
  if (existing) {
    existing.remove();
    anchor.querySelector("[aria-expanded]")?.setAttribute("aria-expanded", "false");
    return null;
  }
  const panel = document.createElement("div");
  panel.className = `dropdown ${width}`;
  panel.innerHTML = String(render());
  anchor.appendChild(panel);
  anchor.querySelector("[aria-expanded]")?.setAttribute("aria-expanded", "true");
  const close = (e) => {
    if (e.type === "keydown" && e.key !== "Escape") return;
    if (e.type === "mousedown" && anchor.contains(e.target)) return;
    panel.remove();
    anchor.querySelector("[aria-expanded]")?.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", close);
    document.removeEventListener("keydown", close);
  };
  setTimeout(() => {
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
  });
  return panel;
}
