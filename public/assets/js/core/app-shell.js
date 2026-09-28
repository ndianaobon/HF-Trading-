// Authenticated application shell (dashboard + admin): navigation state,
// mobile drawer, account menu, notifications bell, global search, market
// status and realtime updates. Returns the signed-in user.

import { html, $, $$, mount, on } from "./dom.js";
import { api } from "./api.js";
import { icon } from "./icons.js";
import { watch, invalidate } from "./store.js";
import { feedStatus, statusBadge, dropdown, assetIcon, priceChange } from "./ui.js";
import { subscribeMarkets, marketState } from "./tickers.js";
import { startRealtime } from "./realtime.js";
import { markActiveNav, getOptionalUser } from "./site.js";
import { formatPrice, timeAgo, titleCase } from "./format.js";
import { notificationIcon } from "../components/notification-icon.js";

const initials = (u) => `${u.firstName?.[0] ?? ""}${u.lastName?.[0] ?? ""}`.toUpperCase() || u.email[0].toUpperCase();

const loginPath = () => (location.pathname.startsWith("/admin") ? "/admin/login" : "/login");

function redirectToLogin(expired) {
  location.href = `${loginPath()}?${expired ? "expired=1&" : ""}next=${encodeURIComponent(location.pathname + location.search)}`;
}

async function loadUser() {
  try {
    return await api("/api/auth/me", { allowAnonymous: true });
  } catch {
    redirectToLogin(false);
    return new Promise(() => {}); // halt page init while navigating away
  }
}

function initDrawer() {
  const drawer = $("#drawer");
  if (!drawer) return;
  const set = (open) => {
    drawer.hidden = !open;
    document.body.style.overflow = open ? "hidden" : "";
  };
  on(document, "click", "[data-drawer-open]", () => set(true));
  on(document, "click", "[data-drawer-close]", () => set(false));
  on(drawer, "click", "a", () => set(false));
}

function initAccountMenu(user) {
  const anchor = $("[data-account]");
  if (!anchor) return;
  const name = `${user.firstName} ${user.lastName}`.trim() || user.email;
  $$("[data-avatar]").forEach((e) => (e.textContent = initials(user)));
  $$("[data-account-name]").forEach((e) => (e.textContent = user.firstName || "Account"));
  const items = [
    ["/dashboard/settings", "Settings", "settings"],
    ["/dashboard/settings?tab=security", "Security", "shield-check"],
    ["/dashboard/verification", "Verification", "badge-check"],
    ["/dashboard/support", "Support", "life-buoy"],
    ...(user.admin ? [["/admin", "Admin console", "shield-half"]] : []),
  ];
  $("[data-account-toggle]", anchor).addEventListener("click", () => {
    const panel = dropdown(
      anchor,
      () => html`<div role="menu">
        <div class="border-b border-line px-4 py-3">
          <p class="truncate font-semibold text-white">${name}</p><p class="truncate text-xs text-dim">${user.email}</p>
          <div class="mt-2 flex flex-wrap gap-1.5">${statusBadge(user.emailVerified ? "ACTIVE" : "PENDING_VERIFICATION", user.emailVerified ? "Email verified" : "Email unverified")}${statusBadge(user.kycStatus, `KYC: ${titleCase(user.kycStatus)}`)}</div>
        </div>
        <div class="py-1">${items.map(([href, label, ic]) => html`<a href="${href}" role="menuitem" class="flex items-center gap-3 px-4 py-2.5 text-sm text-fg hover:bg-panel-2">${icon(ic, "h-4 w-4 text-dim")} ${label}</a>`)}</div>
        <button type="button" role="menuitem" data-logout class="flex w-full items-center gap-3 border-t border-line px-4 py-3 text-sm text-down hover:bg-panel-2">${icon("log-out", "h-4 w-4")} Log out</button>
      </div>`,
    );
    panel?.querySelector("[data-logout]")?.addEventListener("click", logout);
  });
}

export async function logout() {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  location.href = loginPath();
}

function initBell() {
  const anchor = $("[data-bell]");
  if (!anchor) return;
  const count = $("[data-bell-count]", anchor);
  const toggle = $("[data-bell-toggle]", anchor);
  let latest = null;
  watch("/api/notifications?pageSize=6", ({ data }) => {
    if (!data) return;
    latest = data;
    count.hidden = !data.unread;
    count.textContent = data.unread > 9 ? "9+" : String(data.unread);
    toggle.setAttribute("aria-label", `Notifications${data.unread ? `, ${data.unread} unread` : ""}`);
  });
  const render = () =>
    html`<div class="flex items-center justify-between border-b border-line px-4 py-3"><p class="font-display font-bold text-white">Notifications</p>${latest?.unread ? html`<button type="button" data-mark-all class="text-xs font-semibold text-accent hover:text-accent-strong">Mark all as read</button>` : ""}</div>
      <ul class="max-h-[60vh] overflow-y-auto">${
        !latest?.items.length
          ? html`<li class="px-4 py-10 text-center text-sm text-dim">You're all caught up.</li>`
          : latest.items.map(
              (n) => html`<li><button type="button" data-open="${n.id}" data-link="${n.link ?? ""}" data-read="${n.readAt ? "1" : ""}" class="flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left hover:bg-panel-2 ${n.readAt ? "" : "bg-accent/[0.03]"}">
                ${notificationIcon(n.type)}
                <span class="min-w-0 flex-1"><span class="flex items-start justify-between gap-2"><span class="text-sm ${n.readAt ? "text-fg" : "font-semibold text-white"}">${n.title}</span>${n.readAt ? "" : html`<span class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent"></span>`}</span>
                <span class="mt-0.5 line-clamp-2 block text-xs text-muted">${n.body}</span><span class="mt-1 block text-[11px] text-dim">${timeAgo(n.createdAt)}</span></span>
              </button></li>`,
            )
      }</ul>
      <a href="/dashboard/notifications" class="block border-t border-line px-4 py-3 text-center text-sm font-semibold text-accent hover:bg-panel-2">View all notifications</a>`;
  toggle.addEventListener("click", () => {
    const panel = dropdown(anchor, render, { width: "w-[min(92vw,380px)]" });
    if (!panel) return;
    on(panel, "click", "[data-mark-all]", async () => {
      await api("/api/notifications", { body: { all: true } });
      invalidate("/api/notifications");
      panel.remove();
    });
    on(panel, "click", "[data-open]", async (_e, b) => {
      if (!b.dataset.read) await api("/api/notifications", { body: { ids: [b.dataset.open] } }).catch(() => {});
      invalidate("/api/notifications");
      if (b.dataset.link) location.href = b.dataset.link;
      else panel.remove();
    });
  });
}

const PAGES = $$("#sidebar [data-nav]").map((a) => ({ href: a.getAttribute("href"), label: a.textContent.trim() }));

function initSearch() {
  const box = $("[data-search]");
  if (!box) return;
  mount(
    box,
    html`${icon("search", "pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-dim")}
    <input type="search" placeholder="Search markets and pages" aria-label="Search" autocomplete="off" class="h-9 w-full rounded-lg border border-line bg-base-2 pr-8 pl-9 text-sm text-fg placeholder:text-dim focus:border-accent/60 focus:outline-none" />
    <kbd class="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-line-strong px-1.5 text-[10px] text-dim md:block">/</kbd>
    <ul class="absolute z-50 mt-2 w-full min-w-72 overflow-hidden rounded-xl border border-line-strong bg-panel shadow-[var(--shadow-pop)]" role="listbox" hidden></ul>`,
  );
  const input = $("input", box);
  const list = $("ul", box);
  let results = [];
  let idx = 0;
  subscribeMarkets(() => {});
  const draw = () => {
    const s = marketState();
    list.hidden = !results.length;
    mount(
      list,
      results.map(
        (r, i) =>
          html`<li role="option" aria-selected="${i === idx}"><a href="${r.href}" class="flex items-center gap-3 px-3 py-2.5 text-sm ${i === idx ? "bg-panel-2" : ""}">${
            r.m
              ? html`${assetIcon(r.m.base.symbol, r.m.base.color, 24)}<span class="flex-1"><span class="font-semibold text-white">${r.m.base.symbol}/USDT</span> <span class="text-xs text-dim">${r.m.base.name}</span></span><span class="num text-muted">${s.tickers[r.m.symbol] ? formatPrice(s.tickers[r.m.symbol].lastPrice, r.m.pricePrecision) : "—"}</span>${priceChange(s.tickers[r.m.symbol]?.changePercent, { cls: "w-16 justify-end text-xs" })}`
              : html`${icon("arrow-right", "h-4 w-4 text-dim")}<span class="text-fg">${r.label}</span>`
          }</a></li>`,
      ),
    );
  };
  input.addEventListener("input", () => {
    const n = input.value.trim().toUpperCase();
    idx = 0;
    if (!n) {
      results = [];
      return draw();
    }
    const markets = marketState()
      .markets.filter((m) => m.base.symbol.startsWith(n) || m.base.name.toUpperCase().includes(n))
      .slice(0, 6)
      .map((m) => ({ href: `/trade/${m.symbol}`, m }));
    results = [...markets, ...PAGES.filter((p) => p.label.toUpperCase().includes(n)).slice(0, 4)];
    draw();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") idx = Math.min(results.length - 1, idx + 1);
    else if (e.key === "ArrowUp") idx = Math.max(0, idx - 1);
    else if (e.key === "Enter" && results[idx]) location.href = results[idx].href;
    else if (e.key === "Escape") results = [];
    else return;
    e.preventDefault();
    draw();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) {
      e.preventDefault();
      input.focus();
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (!box.contains(e.target)) {
      results = [];
      draw();
    }
  });
}

function initFeedStatus() {
  const els = $$("[data-feed-status]");
  if (!els.length) return;
  subscribeMarkets((s) => els.forEach((el) => mount(el, feedStatus(s.mode, s.provider))));
}

const STRIP = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "BNB-USDT", "XRP-USDT", "ADA-USDT", "DOGE-USDT", "LINK-USDT"];

/** Scrolling live-price strip under the dashboard top bar. Built once, updated in place. */
function initAppTicker() {
  const bar = $("[data-app-ticker]");
  if (!bar) return;
  let built = false;
  subscribeMarkets((s) => {
    const list = STRIP.map((sym) => ({ sym, m: s.markets.find((x) => x.symbol === sym), t: s.tickers[sym] })).filter((i) => i.m && i.t);
    if (!list.length) {
      if (!built) mount(bar, html`<p class="px-4 py-2 text-xs text-dim">${s.mode === "unavailable" ? "Market data is currently unavailable." : "Loading live prices…"}</p>`);
      return;
    }
    if (!built) {
      const row = (dup) =>
        html`<div class="flex" ${dup ? html`aria-hidden="true"` : ""}>${list.map(
          (i) =>
            html`<a href="/trade/${i.sym}" ${dup ? html`tabindex="-1"` : ""} class="flex items-center gap-2.5 border-r border-line/70 px-4 py-2 whitespace-nowrap hover:bg-panel-2/60">${assetIcon(i.m.base.symbol, i.m.base.color, 22)}<span><span class="block text-[11px] leading-tight text-muted">${i.m.base.name}</span><span class="num block text-sm leading-tight font-bold text-white" data-s-price="${i.sym}"></span></span><span class="num text-xs font-semibold" data-s-chg="${i.sym}"></span></a>`,
        )}</div>`;
      mount(bar, html`<div class="group overflow-hidden"><div class="flex w-max animate-ticker group-hover:[animation-play-state:paused]">${row(false)}${row(true)}</div></div>`);
      built = true;
    }
    for (const i of list) {
      $$(`[data-s-price="${i.sym}"]`, bar).forEach((e) => (e.textContent = formatPrice(i.t.lastPrice, i.m.pricePrecision)));
      $$(`[data-s-chg="${i.sym}"]`, bar).forEach((e) => {
        e.textContent = `${i.t.changePercent >= 0 ? "+" : ""}${i.t.changePercent.toFixed(2)}%`;
        e.className = `num text-xs font-semibold ${i.t.changePercent >= 0 ? "text-up" : "text-down"}`;
      });
    }
  });
}

/** Profile header, verification prompt, transfer, sign-out and support chat. */
function initShellExtras(user) {
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Trader";
  $$("[data-account-fullname]").forEach((e) => (e.textContent = name));
  $$("[data-account-email]").forEach((e) => (e.textContent = user.email));
  $$("[data-kyc-card]").forEach((e) => (e.hidden = user.kycStatus === "APPROVED" || user.kycStatus === "PENDING"));
  on(document, "click", "[data-logout-btn]", logout);
  on(document, "click", "[data-transfer-open]", async () => {
    $("#drawer") && ($("#drawer").hidden = true);
    document.body.style.overflow = "";
    const { openTransferModal } = await import("../components/wallet-bits.js");
    openTransferModal(user);
  });
  on(document, "click", "[data-chat-fab]", async () => {
    const { openLiveChat } = await import("../components/support-bits.js");
    openLiveChat();
  });
}

/** Dashboard shell. Resolves with the signed-in user. */
export async function initApp() {
  window.addEventListener("hf:session-expired", () => redirectToLogin(true));
  const user = await loadUser();
  markActiveNav();
  initDrawer();
  initAccountMenu(user);
  initBell();
  initSearch();
  initFeedStatus();
  initAppTicker();
  initShellExtras(user);
  startRealtime();
  $$("[data-admin-link]").forEach((a) => (a.hidden = !user.admin));
  $$("[data-demo-chip]").forEach((e) => (e.hidden = !user.demoMode));
  if (user.demoMode) $$("[data-sidebar-foot]").forEach((e) => mount(e, html`<p class="flex items-center gap-1.5 font-semibold text-warn">${icon("flask-conical", "h-3.5 w-3.5")} Demo environment</p>`));
  const vb = $("#verify-banner");
  if (vb) vb.hidden = user.emailVerified;
  return user;
}

/**
 * Trading workspace header. Works signed in or out; resolves with the user or
 * null. Signed-in visitors get the dashboard navigation, bell and account menu.
 */
export async function initTradeShell() {
  const user = await getOptionalUser();
  const nav = $("[data-trade-nav]");
  if (user) {
    const links = [
      ["/dashboard", "Dashboard"],
      ["/dashboard/markets", "Markets"],
      ["/trade", "Trade"],
      ["/dashboard/portfolio", "Portfolio"],
      ["/dashboard/wallets", "Wallets"],
    ];
    if (nav) mount(nav, links.map(([href, label]) => html`<a href="${href}" class="nav-link" ${href === "/trade" ? html`aria-current="page"` : ""}>${label}</a>`));
    $("[data-signed-out]").hidden = true;
    $("[data-signed-in]").hidden = false;
    $$("[data-demo-chip]").forEach((e) => (e.hidden = !user.demoMode));
    $$("[data-logo]").forEach((a) => a.setAttribute("href", "/dashboard"));
    initAccountMenu(user);
    initBell();
    startRealtime();
    window.addEventListener("hf:session-expired", () => redirectToLogin(true));
  } else {
    const login = $("[data-login-link]");
    if (login) login.href = `/login?next=${encodeURIComponent(location.pathname)}`;
  }
  return user;
}

/** Admin shell: hides navigation the admin's role can't access. */
export async function initAdmin() {
  window.addEventListener("hf:session-expired", () => redirectToLogin(true));
  const user = await loadUser();
  const perms = new Set(user.admin?.permissions ?? []);
  $$("[data-perm]").forEach((a) => (a.hidden = !perms.has(a.dataset.perm)));
  markActiveNav();
  initDrawer();
  initAccountMenu(user);
  $$("[data-demo-chip]").forEach((e) => (e.hidden = !user.demoMode));
  const id = $("[data-admin-identity]");
  if (id) mount(id, html`Signed in as <span class="font-semibold text-white">${user.email}</span> · <span class="text-accent">${titleCase(user.admin?.role ?? "")}</span>`);
  user.can = (p) => perms.has(p);
  if (user.can("support.read")) watchSupportQueue();
  return user;
}

/** Badge on the Support menu item (and tab title) with conversations waiting for a reply. */
function watchSupportQueue() {
  const link = $('a[data-nav="/admin/support"]');
  const baseTitle = document.title.replace(/^\(\d+\) /, "");
  const update = async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const s = await api("/api/admin/support/summary");
      link?.querySelector("[data-support-count]")?.remove();
      if (link && s.awaitingReply > 0) {
        link.insertAdjacentHTML("beforeend", String(html`<span data-support-count class="ml-auto rounded-full bg-down px-2 py-0.5 text-[10px] font-bold text-white" title="${s.liveChat} live chat · ${s.tickets} tickets waiting">${s.awaitingReply}</span>`));
      }
      document.title = s.awaitingReply > 0 ? `(${s.awaitingReply}) ${document.title.replace(/^\(\d+\) /, "")}` : document.title.replace(/^\(\d+\) /, "") || baseTitle;
      window.dispatchEvent(new CustomEvent("hf:support-queue", { detail: s }));
    } catch {
      /* ignore: the next poll retries */
    }
  };
  void update();
  setInterval(update, 20_000);
}
