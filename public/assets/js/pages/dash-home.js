import { html, $, on, mount, cx } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { watch } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { subscribeMarkets, marketState } from "../core/tickers.js";
import { notice, errorState, emptyState, skeleton, skeletonRows, assetIcon, statusBadge, smallSim, copyButton, feedStatus } from "../core/ui.js";
import { donut } from "../core/charts.js";
import { formatNumber, formatPercent, formatPrice, formatUsd, formatDate, timeAgo } from "../core/format.js";
import { txRow, openTransferModal } from "../components/wallet-bits.js";
import { performanceCard, mountPerformance } from "../components/performance.js";
import { createTradeChart } from "../components/trade-chart.js";
import { mountOrderPanel } from "../components/order-panel.js";

const user = await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

const PAIRS = ["BTC-USDT", "ETH-USDT", "BNB-USDT", "SOL-USDT", "XRP-USDT", "ADA-USDT"];
const CHART_PAIRS = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "BNB-USDT"];
let selected = "BTC-USDT";

/** Card header in the reference style: gold icon tile, title, subtitle, optional action. */
const head = (iconName, title, sub, action = "", solid = false) =>
  html`<div class="flex items-start justify-between gap-3 p-5 pb-4 sm:p-6 sm:pb-4">
    <div class="flex min-w-0 items-center gap-3.5"><span class="${cx("icon-tile", solid && "solid")}">${icon(iconName)}</span><div class="min-w-0"><h2 class="font-display text-lg font-extrabold tracking-tight text-white sm:text-xl">${title}</h2>${sub ? html`<p class="text-[13px] text-muted">${sub}</p>` : ""}</div></div>
    ${action}
  </div>`;
const viewAll = (href, label = "View all") => html`<a href="${href}" class="shrink-0 pt-1 text-sm font-semibold text-accent hover:text-accent-strong">${label}</a>`;
const name = user.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : "Trader";
const ACCOUNT_STATUS = { ACTIVE: "Account Active", PENDING_VERIFICATION: "Pending Verification", SUSPENDED: "Account Suspended", BANNED: "Account Banned", CLOSED: "Account Closed" };
const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const stamp = (d) => `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;

mount(
  view,
  html`<div class="space-y-5 lg:space-y-6">
    <section class="card card-glow p-5 sm:p-7">
      <span class="pill-label">Trading dashboard</span>
      <h1 class="mt-4 font-display text-[1.9rem] leading-tight font-extrabold tracking-tight text-white sm:text-4xl">Welcome back, <span class="text-accent">${name}</span></h1>
      <p class="mt-2 text-[15px] text-muted">${today}</p>
      <div class="mt-3">${statusBadge(user.status, `Status: ${ACCOUNT_STATUS[user.status] ?? "Unknown"}`)}</div>
      <p class="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">Monitor live crypto markets, place trades and manage your HarborFinance account.</p>
      <div class="mt-5 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap">
        <a href="/dashboard/deposit" class="btn btn-primary">${icon("circle-arrow-down", "h-4 w-4")} Deposit</a>
        <a href="/dashboard/withdraw" class="btn btn-secondary">${icon("circle-arrow-up", "h-4 w-4")} Withdraw</a>
        <a href="/trade" class="btn btn-secondary">${icon("candlestick-chart", "h-4 w-4")} Trade</a>
        <button type="button" class="btn btn-secondary" data-transfer>${icon("arrow-left-right", "h-4 w-4")} Transfer</button>
      </div>
    </section>
    <div data-notices class="space-y-3"></div>

    <div class="grid gap-5 lg:gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,1fr)]">
      <div class="min-w-0 space-y-5 lg:space-y-6">
        <section class="card card-glow">
          ${head("wallet", "Account Balance", "Total across all wallets", html`<a href="/dashboard/wallets" class="pt-1 text-accent" aria-label="Open wallets">${icon("arrow-up-right", "h-5 w-5")}</a>`)}
          <div class="px-5 pb-5 sm:px-6 sm:pb-6">
            <p class="num font-display text-4xl font-extrabold tracking-tight text-white sm:text-5xl" data-total>${skeleton("h-12 w-56")}</p>
            <p class="mt-2 text-sm text-dim" data-updated></p>
            <div class="mt-5 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3" data-tiles>${Array.from({ length: 6 }, () => skeleton("h-[74px] w-full rounded-2xl"))}</div>
            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <div class="tile bg-[linear-gradient(180deg,rgba(244,190,44,0.06),transparent)]" data-net></div>
              <div class="tile" data-stats></div>
            </div>
            <p class="mt-4 flex items-center gap-2 text-xs text-dim">${icon("trending-up", "h-4 w-4 text-accent")} Balances update as deposits, withdrawals and trades settle.</p>
          </div>
        </section>

        <section class="card overflow-hidden">
          ${head("line-chart", "Trading Analysis", "Signal strength set for your account")}
          <div class="px-5 pb-5 sm:px-6 sm:pb-6">
            <div class="flex items-center justify-between gap-3"><p class="font-semibold text-muted">Signal Strength</p><p class="num font-display text-xl font-extrabold text-up" data-signal-pct></p></div>
            <div class="mt-3 h-2.5 overflow-hidden rounded-full bg-panel-3" role="progressbar" aria-label="Signal strength" aria-valuemin="0" aria-valuemax="100" data-signal-bar><div class="h-full rounded-full bg-up transition-[width] duration-700" data-signal-fill></div></div>
            <div class="mt-5 h-[300px] overflow-hidden rounded-2xl border border-line sm:h-[340px]" data-analysis-chart></div>
          </div>
        </section>

        <section class="card">
          ${head("sparkles", "Market Overview", "Live cryptocurrency prices", viewAll("/dashboard/markets", "View markets →"), true)}
          <div class="grid grid-cols-2 gap-2.5 px-5 pb-5 sm:grid-cols-3 sm:gap-3 sm:px-6 sm:pb-6" data-pairs></div>
        </section>

        <section class="card overflow-hidden">
          <div class="flex flex-col gap-4 p-5 pb-4 sm:p-6 sm:pb-4">
            <div class="flex items-center gap-3.5"><span class="icon-tile">${icon("trending-up")}</span><div><p class="flex flex-wrap items-center gap-2 font-display text-lg font-extrabold text-white"><span data-chart-title>BTC/USDT</span><span class="rounded-full border border-up/30 bg-up-soft px-2 py-0.5 text-[10px] font-bold tracking-wider text-up">● LIVE</span></p><p class="text-[13px] text-muted">Candlestick chart · 15m</p></div></div>
            <div class="flex flex-wrap gap-2" data-chart-pairs></div>
          </div>
          <div class="h-[340px] border-t border-line sm:h-[400px]" data-chart></div>
        </section>

        <div class="grid gap-5 lg:gap-6 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          ${performanceCard({ height: 260 })}
          <section class="card">${head("pie-chart", "Allocation", "By current value")}<div class="px-5 pb-5 sm:px-6" data-alloc>${skeleton("h-[220px] w-full")}</div></section>
        </div>

        <section class="card overflow-hidden">
          ${head("activity", "Market Data", "Live cryptocurrency prices", html`<span data-feed class="pt-1"></span>`, true)}
          <div data-market-table></div>
        </section>
      </div>

      <div class="grid min-w-0 content-start gap-5 md:grid-cols-2 lg:gap-6 xl:grid-cols-1">
        <section class="card overflow-hidden">
          <div class="flex items-center justify-between gap-3 p-5 pb-2 sm:p-6 sm:pb-2"><h2 class="font-display text-xl font-extrabold text-white">Place a Trade</h2><a href="/trade" class="text-sm font-semibold text-accent">Full terminal →</a></div>
          <div class="px-2 sm:px-3" data-ticket-pick></div>
          <div data-ticket></div>
        </section>

        <section class="card">
          ${head("trending-up", "Latest Trades", "", viewAll("/dashboard/transactions?type=TRADE"))}
          <div class="px-5 pb-5 sm:px-6 sm:pb-6" data-trades>${skeletonRows(3)}</div>
        </section>

        <section class="card">
          ${head("list-checks", "Open Orders", "", viewAll("/trade", "Trade →"))}
          <div class="space-y-2 px-5 pb-5 sm:px-6 sm:pb-6" data-orders>${skeletonRows(2)}</div>
        </section>

        <section class="card card-glow" data-referral>${head("users", "Referral Program", "Invite people you know", "", true)}<div class="px-5 pb-5 sm:px-6">${skeleton("h-40 w-full")}</div></section>

        <section class="card" data-news-card>
          <div class="flex items-center gap-3.5 p-5 pb-3 sm:p-6 sm:pb-3"><span class="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-[#ff6a3d] to-[#d9301a] text-[#fff]">${icon("newspaper")}</span><div><h2 class="font-display text-lg font-extrabold tracking-tight text-white sm:text-xl">Top Stories</h2><p class="text-[13px] text-muted">Latest market news &amp; insights</p></div></div>
          <div class="px-5 sm:px-6" data-news>${skeletonRows(4)}</div>
        </section>

        <section class="card">
          ${head("receipt-text", "Recent Transactions", "", viewAll("/dashboard/transactions"))}
          <div class="divide-y divide-line/60 px-5 pb-3 sm:px-6" data-txs>${skeletonRows(4)}</div>
        </section>
      </div>
    </div>
  </div>`,
);

on(view, "click", "[data-transfer]", () => openTransferModal(user));
const tone = (v) => (v === null || v === undefined ? "text-white" : v >= 0 ? "text-up" : "text-down");
const tile = (iconName, iconCls, label, value, cls = "text-white") => html`<div class="tile"><p class="flex items-center gap-2 text-[13px] text-muted">${icon(iconName, `h-4 w-4 ${iconCls}`)}${label}</p><p class="num mt-1.5 text-lg font-extrabold ${cls}">${value}</p></div>`;

/* ── Portfolio / balance ── */
let portfolio = null;
function drawPortfolio() {
  const p = portfolio;
  mount(
    $("[data-notices]", view),
    html`${p.isDemo ? notice("warn", { iconName: "flask-conical", title: "Demo account", body: "Balances, deposits and trades on this account are simulated for demonstration. No real funds are involved." }) : ""}
    ${p.totalValue === null ? notice("warn", { title: "Valuation unavailable", body: "Live prices are temporarily unavailable, so portfolio values can't be calculated. Balances are still accurate." }) : ""}`,
  );
  $("[data-total]", view).textContent = p.totalValue !== null ? formatUsd(p.totalValue) : "—";
  $("[data-updated]", view).textContent = `Last updated: ${stamp(new Date())}`;
  const sign = (v) => (v !== null && v !== undefined ? formatUsd(v, { sign: true }) : "—");
  mount(
    $("[data-tiles]", view),
    html`${tile("wallet", "text-accent", "Available", formatUsd(p.availableBalance))}
    ${tile("piggy-bank", "text-accent", "Invested", formatUsd(p.investedBalance))}
    ${tile("trending-up", "text-up", "Unrealized P&L", sign(p.unrealizedPnl), tone(p.unrealizedPnl))}
    ${tile("bar-chart-3", "text-accent", "Realized P&L", sign(p.realizedPnl), tone(p.realizedPnl))}
    ${tile("activity", "text-info", "Today's P&L", sign(p.todayPnl), tone(p.todayPnl))}
    ${tile(p.change24hPct >= 0 ? "trending-up" : "trending-down", p.change24hPct >= 0 ? "text-up" : "text-down", "24h Change", p.change24hPct !== null ? formatPercent(p.change24hPct) : "—", tone(p.change24hPct))}`,
  );
  mount($("[data-net]", view), html`<p class="text-[13px] text-muted">Net deposits</p><p class="num mt-1 text-2xl font-extrabold text-white">${formatUsd(p.netDeposits)}</p><p class="mt-1 text-xs text-dim">Deposits minus withdrawals${p.roiPct !== null ? html` · ROI <span class="${tone(p.roiPct)}">${formatPercent(p.roiPct)}</span>` : ""}</p>`);
  const slices = p.holdings.filter((x) => x.value > 0).map((x) => ({ label: x.symbol, value: x.value, color: x.color }));
  if (p.investedBalance > 0) slices.push({ label: "Plans & copy", value: p.investedBalance, color: "#F4BE2C" });
  mount($("[data-alloc]", view), slices.length ? donut(slices, p.totalValue) : emptyState({ title: "No assets yet", action: html`<a href="/dashboard/deposit" class="btn btn-primary">Deposit</a>` }));
}
watch(
  "/api/portfolio",
  ({ data, error }) => {
    if (data) {
      portfolio = data;
      drawPortfolio();
    } else if (error) mount($("[data-tiles]", view), html`<div class="col-span-full">${errorState({ message: error.message })}</div>`);
  },
  { refresh: 30000 },
);

/* ── Trading analysis (signal strength is set per user by an admin) ── */
function drawSignal(value) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  $("[data-signal-pct]", view).textContent = `${pct}%`;
  $("[data-signal-fill]", view).style.width = `${pct}%`;
  $("[data-signal-bar]", view).setAttribute("aria-valuenow", String(pct));
}
drawSignal(user.signalStrength);
watch("/api/auth/me", ({ data }) => data && drawSignal(data.signalStrength), { refresh: 60000 });

/* ── Trading stats ── */
let openCount = null;
let tradeCount = null;
const drawStats = () =>
  mount(
    $("[data-stats]", view),
    html`<p class="flex items-center gap-2 text-[13px] text-muted">${icon("activity", "h-4 w-4 text-accent")} Trading stats</p>
    <div class="mt-2 grid grid-cols-2 gap-y-2 text-sm"><div><p class="text-dim">Open orders</p><p class="num font-bold text-white">${openCount ?? "—"}</p></div><div><p class="text-dim">Fills</p><p class="num font-bold text-white">${tradeCount ?? "—"}</p></div></div>`,
  );
drawStats();

/* ── Market overview cards, chart and ticket ── */
let chart = null;
let ticket = null;
let lastPairs = 0;
function drawPairs() {
  const s = marketState();
  if (Date.now() - lastPairs < 1500) return;
  lastPairs = Date.now();
  mount(
    $("[data-pairs]", view),
    PAIRS.map((sym) => {
      const t = s.tickers[sym];
      const m = s.markets.find((x) => x.symbol === sym);
      const up = (t?.changePercent ?? 0) >= 0;
      return html`<button type="button" class="pair-card" data-pair="${sym}" aria-pressed="${sym === selected}">
        <span class="flex items-center justify-between gap-2 text-sm font-extrabold text-white">${sym.replace("-", "/")} ${icon(up ? "trending-up" : "trending-down", `h-4 w-4 ${up ? "text-up" : "text-down"}`)}</span>
        <span class="num mt-2 block font-display text-xl font-extrabold text-white sm:text-2xl">${t ? formatPrice(t.lastPrice, m?.pricePrecision) : "—"}</span>
        <span class="num mt-1 block text-sm font-bold ${up ? "text-up" : "text-down"}">${t ? formatPercent(t.changePercent) : "—"}</span>
      </button>`;
    }),
  );
}
function drawMarketTable() {
  const s = marketState();
  mount($("[data-feed]", view), feedStatus(s.mode, s.provider));
  const rows = s.markets.filter((m) => s.tickers[m.symbol]).sort((a, b) => (s.tickers[b.symbol].quoteVolume ?? 0) - (s.tickers[a.symbol].quoteVolume ?? 0)).slice(0, 8);
  mount(
    $("[data-market-table]", view),
    !rows.length
      ? html`<div class="px-5 pb-5">${skeletonRows(4)}</div>`
      : html`<div class="grid grid-cols-[1fr_auto_5.5rem] gap-3 border-y border-line bg-base-2/60 px-5 py-3 text-xs font-semibold text-muted sm:px-6"><span>Name</span><span class="text-right">Price</span><span class="text-right">Change</span></div>
        ${rows.map((m) => {
          const t = s.tickers[m.symbol];
          return html`<a href="/trade/${m.symbol}" class="grid grid-cols-[1fr_auto_5.5rem] items-center gap-3 border-b border-line/70 px-5 py-3 last:border-0 hover:bg-panel-2/60 sm:px-6">
            <span class="flex min-w-0 items-center gap-3">${assetIcon(m.base.symbol, m.base.color, 36)}<span class="min-w-0"><span class="block truncate font-bold text-white">${m.base.name}</span><span class="block text-xs text-dim">${m.base.symbol}</span></span></span>
            <span class="num text-right font-bold text-white">${formatPrice(t.lastPrice, m.pricePrecision)}</span>
            <span class="num flex items-center justify-end gap-1 text-right text-sm font-bold ${t.changePercent >= 0 ? "text-up" : "text-down"}">${icon(t.changePercent >= 0 ? "trending-up" : "trending-down", "h-3.5 w-3.5")}${formatPercent(t.changePercent)}</span>
          </a>`;
        })}`,
  );
}
function selectPair(sym) {
  const s = marketState();
  const market = s.markets.find((m) => m.symbol === sym);
  if (!market) return;
  selected = sym;
  lastPairs = 0;
  drawPairs();
  $("[data-chart-title]", view).textContent = sym.replace("-", "/");
  mount($("[data-chart-pairs]", view), CHART_PAIRS.map((p) => html`<button type="button" class="chip" data-chart-pair="${p}" aria-pressed="${p === sym}">${p.replace("-", "/")}</button>`));
  chart?.destroy();
  chart = createTradeChart($("[data-chart]", view), { symbol: sym, interval: "15m", pricePrecision: market.pricePrecision, indicators: new Set(["ma"]) });
  mount($("[data-ticket-pick]", view), html`<p class="px-3 pb-1 text-xs text-dim">Currency pair: <span class="font-semibold text-white">${sym.replace("-", "/")}</span> · choose another above</p>`);
  // Fresh host per pair: the ticket binds delegated listeners to its container.
  const host = document.createElement("div");
  $("[data-ticket]", view).replaceChildren(host);
  ticket = mountOrderPanel(host, { market, user });
  ticket.setLastPrice(s.tickers[sym]?.lastPrice ?? null);
}
on(view, "click", "[data-pair]", (_e, b) => selectPair(b.dataset.pair));
on(view, "click", "[data-chart-pair]", (_e, b) => selectPair(b.dataset.chartPair));

let started = false;
let lastTable = 0;
subscribeMarkets((s) => {
  if (!s.markets.length) return;
  if (!started) {
    started = true;
    selectPair(selected);
    const btc = s.markets.find((m) => m.symbol === "BTC-USDT");
    if (btc) createTradeChart($("[data-analysis-chart]", view), { symbol: btc.symbol, interval: "1h", pricePrecision: btc.pricePrecision, indicators: new Set(["ma"]) });
  }
  drawPairs();
  const t = s.tickers[selected];
  if (ticket && s.mode !== "delayed" && s.mode !== "unavailable") ticket.setLastPrice(t?.lastPrice ?? null);
  if (Date.now() - lastTable > 3000) {
    lastTable = Date.now();
    drawMarketTable();
  }
});

mountPerformance(view);

/* ── Activity lists ── */
watch("/api/trades?pageSize=5", ({ data }) => {
  if (!data) return;
  tradeCount = data.total ?? data.items.length;
  drawStats();
  mount(
    $("[data-trades]", view),
    !data.items.length
      ? html`<div class="flex flex-col items-center py-6 text-center"><span class="grid h-16 w-16 place-items-center rounded-full bg-panel-3 text-dim">${icon("trending-up", "h-7 w-7")}</span><p class="mt-4 text-muted">No trades yet</p><a href="/trade" class="btn btn-primary mt-4">Start Trading</a></div>`
      : html`<ul class="divide-y divide-line/60">${data.items.map(
          (t) => html`<li class="flex items-center justify-between gap-3 py-3"><div class="min-w-0"><p class="flex items-center gap-2 text-sm font-bold"><span class="${t.side === "BUY" ? "text-up" : "text-down"}">${t.side === "BUY" ? "Buy" : "Sell"}</span><span class="text-white">${t.market.symbol.replace("-", "/")}</span>${t.isDemo ? smallSim() : ""}</p><p class="text-xs text-dim">${formatDate(t.createdAt)}</p></div><div class="text-right"><p class="num text-sm font-semibold text-white">${formatNumber(t.quantity, 6)}</p><p class="num text-xs text-muted">@ ${formatPrice(t.price, t.market.pricePrecision)}</p></div></li>`,
        )}</ul>`,
  );
});
watch("/api/orders?status=open&pageSize=5", ({ data }) => {
  if (!data) return;
  openCount = data.total ?? data.items.length;
  drawStats();
  mount(
    $("[data-orders]", view),
    !data.items.length
      ? html`<p class="py-3 text-center text-sm text-dim">No open orders</p>`
      : data.items.map(
          (o) => html`<a href="/trade/${o.market.symbol}" class="flex items-center justify-between rounded-xl border border-line bg-panel-2/40 px-3 py-2.5 text-sm hover:border-line-strong"><span><span class="font-bold ${o.side === "BUY" ? "text-up" : "text-down"}">${o.side === "BUY" ? "Buy" : "Sell"}</span> <span class="text-white">${o.market.symbol.replace("-", "/")}</span><span class="block text-xs text-dim">${o.type.replace("_", " ").toLowerCase()} · ${formatNumber(o.quantity, 6)} @ ${o.price ? formatPrice(o.price) : "market"}</span></span>${statusBadge(o.status)}</a>`,
        ),
  );
});
watch("/api/transactions?pageSize=5", ({ data }) => data && mount($("[data-txs]", view), data.items.length ? data.items.map(txRow) : html`<p class="py-4 text-center text-sm text-dim">No transactions yet</p>`));

/* ── Top stories (publisher headlines; every story links to its source) ── */
let newsExpanded = false;
let news = null;
const SOURCE_COLORS = { CoinDesk: "#1a5cff", Cointelegraph: "#f5b400" };
function drawNews() {
  const el = $("[data-news]", view);
  if (!news?.available) {
    mount(el, html`<p class="pb-5 text-sm text-dim">${news?.reason === "disabled" ? "Market news is turned off." : "News is temporarily unavailable. Please check back shortly."}</p>`);
    return;
  }
  const list = newsExpanded ? news.items : news.items.slice(0, 5);
  mount(
    el,
    html`<ul class="space-y-5 pb-2">${list.map(
      (n) => html`<li><a href="${n.link}" target="_blank" rel="noopener noreferrer" class="group block">
        <span class="flex items-center gap-2 text-sm text-muted"><span class="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-extrabold text-white" style="background:${SOURCE_COLORS[n.source] ?? "#52525b"}">${n.source.slice(0, 1)}</span>${n.source}${n.publishedAt ? html` · ${timeAgo(n.publishedAt)}` : ""}</span>
        <span class="mt-1.5 block text-[15px] leading-snug font-semibold text-fg group-hover:text-accent">${n.title}</span>
      </a></li>`,
    )}</ul>
    ${news.items.length > 5 ? html`<button type="button" class="mt-2 inline-flex items-center gap-1 text-sm font-bold text-info hover:underline" data-news-more>${newsExpanded ? "Show less" : "Keep reading"} ${icon(newsExpanded ? "chevron-up" : "chevron-right", "h-4 w-4")}</button>` : ""}
    <p class="mt-4 flex items-center gap-2 border-t border-line py-4 text-xs text-dim">${icon("activity", "h-3.5 w-3.5 text-accent")} Headlines from ${news.sources.join(", ")} · opens the publisher's site</p>`,
  );
}
on(view, "click", "[data-news-more]", () => {
  newsExpanded = !newsExpanded;
  drawNews();
});
watch(
  "/api/public/news",
  ({ data, error }) => {
    if (data) news = data;
    else if (error && !news) news = { available: false, reason: "unreachable" };
    drawNews();
  },
  { refresh: 5 * 60 * 1000 },
);

/* ── Referral card ── */
watch("/api/referrals", ({ data }) => {
  if (!data) return;
  const p = data.program;
  const unit = data.stats.asset ?? "USDT";
  mount(
    $("[data-referral]", view),
    html`${head("users", "Referral Program", "Invite people you know", "", true)}
    <div class="px-5 pb-5 sm:px-6 sm:pb-6">
      <p class="text-sm leading-relaxed text-muted">${!p.enabled ? "The referral programme is currently paused." : p.rewardAmount > 0 ? `A reward of ${p.rewardAmount} ${p.rewardAsset} may be credited when someone you refer completes their ${p.qualifyingAction === "FIRST_DEPOSIT" ? "first qualifying deposit" : "identity verification"}, subject to review.` : "Referrals are tracked, but no monetary reward is currently offered."}</p>
      <div class="mt-4 grid grid-cols-2 gap-3">
        <div class="tile"><p class="flex items-center gap-2 text-[13px] text-muted">${icon("users", "h-4 w-4 text-accent")}Total referrals</p><p class="num mt-1 text-xl font-extrabold text-white">${data.stats.total}</p></div>
        <div class="tile"><p class="flex items-center gap-2 text-[13px] text-muted">${icon("gift", "h-4 w-4 text-up")}Rewards</p><p class="num mt-1 text-xl font-extrabold text-white">${formatNumber(data.stats.rewardsTotal, 2)} <span class="text-sm text-muted">${unit}</span></p></div>
      </div>
      <p class="mt-5 flex items-center gap-2 text-sm font-bold text-white">${icon("share-2", "h-4 w-4 text-accent")} Your personal referral link</p>
      <div class="mt-2 flex gap-2"><div class="min-w-0 flex-1 truncate rounded-xl border border-line bg-base-2 px-3 py-2.5 font-mono text-sm text-fg">${data.link}</div>${copyButton(data.link, "Copy")}</div>
      <p class="mt-3 text-sm text-muted">Your referral code: <span class="rounded-md bg-accent-soft px-2 py-0.5 font-mono font-bold text-accent">${data.code}</span></p>
      <a href="/dashboard/referrals" class="btn btn-primary mt-5 w-full">Learn more about referrals ${icon("arrow-right", "h-4 w-4")}</a>
    </div>`,
  );
});
