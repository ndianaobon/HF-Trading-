// Behaviour shared by the public site, auth pages and the trading page:
// header/mobile menu, active navigation, live ticker strip, system banners
// (demo mode / maintenance), footer company details and signed-in state.

import { html, $, $$, mount } from "./dom.js";
import { api } from "./api.js";
import { icon } from "./icons.js";
import { feedStatus, priceChange } from "./ui.js";
import { subscribeMarkets } from "./tickers.js";
import { formatCompact, formatPercent, formatPrice } from "./format.js";

let mePromise = null;
/** Current user or null (never redirects). */
export const getOptionalUser = () => (mePromise ??= api("/api/auth/session", { allowAnonymous: true }).catch(() => null));

let sitePromise = null;
export const getSiteConfig = () => (sitePromise ??= api("/api/public/site", { allowAnonymous: true }).catch(() => null));

export function markActiveNav(root = document) {
  const path = location.pathname;
  for (const a of $$("[data-nav]", root)) {
    const target = a.dataset.nav;
    const active = a.hasAttribute("data-exact") ? path === target : path === target || path.startsWith(`${target}/`);
    if (active) {
      a.setAttribute("aria-current", "page");
      if (!a.classList.contains("nav-link")) a.classList.add("text-white");
    }
  }
}

export async function renderSystemBanner() {
  const el = $("#system-banner");
  if (!el) return;
  const cfg = await getSiteConfig();
  if (!cfg) return;
  mount(
    el,
    html`${cfg.maintenance ? html`<div class="bg-warn px-4 py-1.5 text-center text-xs font-semibold text-black">${cfg.maintenance.message}</div>` : ""}
    ${cfg.mode === "demo"
      ? html`<div class="flex items-center justify-center gap-2 border-b border-warn/20 bg-warn-soft px-4 py-1.5 text-center text-[11px] font-semibold text-warn sm:text-xs">${icon("flask-conical", "h-3.5 w-3.5 shrink-0")}<span>Demo environment${document.body.dataset.layout === "marketing" ? " — balances, deposits, withdrawals and order fills are simulated. No real funds are moved." : ""}</span></div>`
      : ""}`,
  );
}

function initHeader() {
  const header = $("#site-header");
  if (!header) return;
  const menu = $("#mobile-menu");
  const toggle = $("#menu-toggle");
  const onScroll = () => {
    const solid = window.scrollY > 8 || !menu.hidden;
    header.classList.toggle("glass", solid);
    header.classList.toggle("border-line", solid);
    header.classList.toggle("border-transparent", !solid);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  // Desktop dropdowns open on hover or focus (CSS); Safari doesn't focus buttons on click, so do it here.
  for (const dd of $$("[data-dropdown]", header)) {
    const btn = dd.querySelector("button");
    btn.addEventListener("click", () => btn.focus());
    dd.addEventListener("focusin", () => btn.setAttribute("aria-expanded", "true"));
    dd.addEventListener("focusout", (e) => !dd.contains(e.relatedTarget) && btn.setAttribute("aria-expanded", "false"));
    dd.addEventListener("keydown", (e) => e.key === "Escape" && document.activeElement?.blur());
  }
  toggle?.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    toggle.setAttribute("aria-expanded", String(!menu.hidden));
    toggle.setAttribute("aria-label", menu.hidden ? "Open menu" : "Close menu");
    toggle.innerHTML = String(icon(menu.hidden ? "menu" : "x", "h-5 w-5"));
    document.body.style.overflow = menu.hidden ? "" : "hidden";
    onScroll();
  });
}

async function initAuthSlots() {
  const user = await getOptionalUser();
  if (!user) return;
  const desk = $("[data-auth-slot]");
  const mob = $("[data-auth-slot-mobile]");
  if (desk) mount(desk, html`<a href="/dashboard" class="btn btn-primary">${icon("layout-dashboard", "h-4 w-4")} Dashboard</a>`);
  if (mob) mount(mob, html`<a href="/dashboard" class="btn btn-primary btn-lg">Go to Dashboard</a>`);
}

const TICKER_SYMBOLS = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "BNB-USDT", "XRP-USDT", "ADA-USDT", "DOGE-USDT"];

/** Persistent ticker strip. Builds the marquee once, then updates values in place. */
function initTickerBar() {
  const bar = $("#ticker-bar");
  if (!bar) return;
  const status = $("[data-feed-status]", bar);
  const items = $("[data-ticker-items]", bar);
  let built = false;
  subscribeMarkets((s) => {
    mount(status, feedStatus(s.mode));
    const list = TICKER_SYMBOLS.filter((sym) => s.tickers[sym]).map((sym) => ({ key: sym, label: sym.split("-")[0], href: `/trade/${sym}`, t: s.tickers[sym] }));
    if (s.peg) list.push({ key: "USDT", label: "USDT", href: "/markets?category=STABLECOIN", t: s.peg });
    if (!list.length) {
      built = false;
      mount(items, html`<p class="px-4 text-dim">${s.mode === "unavailable" ? "Market data is currently unavailable." : "Loading market data…"}</p>`);
      return;
    }
    if (!built) {
      const row = (dup) =>
        html`<div class="flex" ${dup ? html`aria-hidden="true"` : ""}>${list.map(
          (i) =>
            html`<a href="${i.href}" ${dup ? html`tabindex="-1"` : ""} class="flex items-center gap-2 border-r border-line/60 px-4 py-2 whitespace-nowrap hover:bg-panel-2/60"><span class="font-bold text-white">${i.label}</span><span class="num text-fg" data-t-price="${i.key}"></span><span class="num font-semibold" data-t-chg="${i.key}"></span><span class="num text-dim" data-t-vol="${i.key}"></span></a>`,
        )}</div>`;
      mount(items, html`<div class="group relative overflow-hidden"><div class="flex w-max animate-ticker group-hover:[animation-play-state:paused]">${row(false)}${row(true)}</div></div>`);
      built = true;
    }
    for (const i of list) {
      $$(`[data-t-price="${i.key}"]`, items).forEach((e) => (e.textContent = formatPrice(i.t.lastPrice, i.key === "USDT" ? 4 : undefined)));
      $$(`[data-t-chg="${i.key}"]`, items).forEach((e) => {
        e.textContent = formatPercent(i.t.changePercent);
        e.className = `num font-semibold ${i.t.changePercent >= 0 ? "text-up" : "text-down"}`;
      });
      $$(`[data-t-vol="${i.key}"]`, items).forEach((e) => (e.textContent = `Vol ${formatCompact(i.t.quoteVolume)}`));
    }
  });
}

/** Auth pages: small live market panel in the aside. */
function initAuthMarkets() {
  const box = $("#auth-markets");
  if (!box) return;
  subscribeMarkets((s) => {
    mount($("[data-feed-status]", box), feedStatus(s.mode, s.provider));
    mount(
      $("[data-auth-tickers]", box),
      ["BTC-USDT", "ETH-USDT", "SOL-USDT"].map((sym) => {
        const t = s.tickers[sym];
        return html`<div><p class="text-xs font-semibold text-muted">${sym.replace("-", "/")}</p><p class="num mt-0.5 font-display font-bold text-white">${t ? formatPrice(t.lastPrice) : "—"}</p>${priceChange(t?.changePercent, { cls: "text-xs" })}</div>`;
      }),
    );
  });
}

async function initFooter() {
  $$("[data-year]").forEach((e) => (e.textContent = String(new Date().getFullYear())));
  const line = $("#company-line");
  if (!line) return;
  const cfg = await getSiteConfig();
  const c = cfg?.company;
  if (!c) return;
  $$("[data-operator]").forEach((e) => (e.textContent = c.legalName));
  line.textContent = `HarborFinance Trading is operated by ${c.legalName}${c.registrationNumber ? `, registration no. ${c.registrationNumber}` : ""}${c.registeredAddress ? `, ${c.registeredAddress}` : ""}.${c.licenses.map((l) => ` ${l.name} (${l.authority}, ${l.number}).`).join("")}`;
  line.hidden = false;
}

/** Initialises the chrome for public / auth pages. */
export function initSite() {
  markActiveNav();
  initHeader();
  void renderSystemBanner();
  void initAuthSlots();
  initTickerBar();
  initAuthMarkets();
  void initFooter();
}
