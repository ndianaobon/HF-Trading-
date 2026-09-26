import { html, $, $$, on, mount, cx } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { renderSystemBanner } from "../core/site.js";
import { initTradeShell } from "../core/app-shell.js";
import { subscribeMarkets, marketState } from "../core/tickers.js";
import { openMarketStream } from "../core/stream.js";
import { assetIcon, feedStatus, emptyState, errorState, tabs, openModal, skeleton } from "../core/ui.js";
import { formatCompact, formatDate, formatNumber, formatPercent, formatPrice } from "../core/format.js";
import { mountMarketSelector } from "../components/market-selector.js";
import { createTradeChart } from "../components/trade-chart.js";
import { mountOrderPanel } from "../components/order-panel.js";
import { mountOrdersPanel } from "../components/orders-panel.js";

const TIMEFRAMES = [
  ["1m", "1m"],
  ["5m", "5m"],
  ["15m", "15m"],
  ["1h", "1h"],
  ["4h", "4h"],
  ["1d", "1D"],
  ["1w", "1W"],
];
const INDICATORS = [
  ["ma", "MA"],
  ["ema", "EMA"],
  ["bb", "BOLL"],
  ["rsi", "RSI"],
  ["macd", "MACD"],
];
const readLocal = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};
const writeLocal = (key, v) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};

const symbol = location.pathname.split("/").pop().toUpperCase();
const root = $("#terminal");
renderSystemBanner();
const user = await initTradeShell();

// Wait for the market catalogue.
const markets = await new Promise((resolve) => {
  const unsub = subscribeMarkets((s) => {
    if (!s.markets.length && s.mode === "connecting") return;
    queueMicrotask(() => unsub());
    resolve(s.markets);
  });
});
const market = markets.find((m) => m.symbol === symbol);
root.removeAttribute("aria-busy");

if (!markets.length) {
  mount(root, errorState({ title: "Markets unavailable", message: "The market list could not be loaded. Please try again shortly.", cls: "py-24", retry: false }));
} else if (!market) {
  document.title = "Market not found | HarborFinance";
  mount(root, emptyState({ title: "Market not found", description: `${symbol} is not listed on HarborFinance.`, action: html`<a href="/markets" class="font-semibold text-accent">Browse markets →</a>`, cls: "py-24" }));
} else {
  start(market);
}

function start(market) {
  let interval = readLocal("hf.chart.interval", "1h");
  if (!TIMEFRAMES.some(([v]) => v === interval)) interval = "1h";
  const indicators = new Set(readLocal("hf.chart.indicators", ["ma", "ema"]).filter((k) => INDICATORS.some(([v]) => v === k)));
  let mobileTab = "chart";
  const xl = window.matchMedia("(min-width: 1280px)");
  const pdp = market.pricePrecision;
  const b = market.base;

  mount(
    root,
    html`<div class="flex flex-col">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-base-2 px-4 py-2.5">
        <button type="button" data-pick class="flex items-center gap-2.5 rounded-lg py-1 pr-2 xl:pointer-events-none" aria-label="Choose market">
          ${assetIcon(b.symbol, b.color, 30)}
          <span class="text-left leading-tight"><span class="flex items-center gap-1 font-display text-lg font-extrabold text-white">${b.symbol}/${market.quote.symbol} ${icon("chevron-down", "h-4 w-4 text-dim xl:hidden")}</span><span class="block text-xs text-dim">${b.name}</span></span>
        </button>
        ${user ? html`<button type="button" data-fav class="-ml-4 text-dim hover:text-accent" aria-label="Add to favorites">${icon("star", "h-4 w-4")}</button>` : ""}
        <p class="num font-display text-xl font-extrabold" data-last>—</p>
        <div class="contents" data-stats></div>
        <div class="ml-auto" data-feed></div>
      </div>

      <div class="grid gap-px bg-line lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[250px_minmax(0,1fr)_320px]">
        <aside class="hidden bg-panel xl:row-span-2 xl:block" data-selector></aside>
        <section class="flex min-w-0 flex-col bg-panel">
          <div class="px-2 xl:hidden" data-mtabs></div>
          <div data-pane="chart">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
              <div class="flex gap-0.5" data-intervals></div>
              <div class="flex gap-0.5" data-indicators></div>
            </div>
            <div data-chart></div>
          </div>
          <div class="xl:hidden" data-pane="book" hidden><div data-book="10"></div></div>
          <div class="xl:hidden" data-pane="trades" hidden><div data-trades></div></div>
        </section>
        <aside class="bg-panel lg:row-span-2" data-order></aside>
        <div class="hidden h-[330px] grid-cols-2 gap-px bg-line xl:grid">
          <div class="overflow-hidden bg-panel"><p class="border-b border-line px-3 py-2 text-xs font-bold text-white">Order book</p><div data-book="7"></div></div>
          <div class="overflow-hidden bg-panel"><p class="border-b border-line px-3 py-2 text-xs font-bold text-white">Market trades</p><div data-trades></div></div>
        </div>
      </div>

      <div class="border-t border-line bg-panel" data-orders></div>
    </div>`,
  );

  /* ── Toolbar ── */
  const drawToolbar = () => {
    mount($("[data-intervals]", root), TIMEFRAMES.map(([v, l]) => html`<button type="button" data-interval="${v}" aria-pressed="${interval === v}" class="${cx("rounded-md px-2 py-1 text-xs font-semibold", interval === v ? "bg-accent-soft text-accent" : "text-dim hover:text-fg")}">${l}</button>`));
    mount($("[data-indicators]", root), INDICATORS.map(([k, l]) => html`<button type="button" data-ind="${k}" aria-pressed="${indicators.has(k)}" class="${cx("rounded-md px-2 py-1 text-[11px] font-bold", indicators.has(k) ? "bg-panel-3 text-white" : "text-dim hover:text-fg")}">${l}</button>`));
  };
  const drawMobileTabs = () =>
    mount(
      $("[data-mtabs]", root),
      tabs(
        [
          { value: "chart", label: "Chart" },
          { value: "book", label: "Order book" },
          { value: "trades", label: "Trades" },
        ],
        mobileTab,
        { size: "sm", name: "mtab" },
      ),
    );
  const applyMobileTab = () => {
    $('[data-pane="chart"]', root).classList.toggle("max-xl:hidden", mobileTab !== "chart");
    $('[data-pane="book"]', root).hidden = mobileTab !== "book";
    $('[data-pane="trades"]', root).hidden = mobileTab !== "trades";
  };

  /* ── Chart ── */
  let chart = null;
  const chartHeight = () => {
    const extra = (indicators.has("rsi") ? 1 : 0) + (indicators.has("macd") ? 1 : 0);
    return xl.matches ? 460 + extra * 110 : 380 + extra * 100;
  };
  const buildChart = () => {
    chart?.destroy();
    const el = $("[data-chart]", root);
    el.style.height = `${chartHeight()}px`;
    $("[data-selector]", root).style.height = xl.matches ? `${chartHeight() + 44 + 330}px` : "";
    chart = createTradeChart(el, { symbol: market.symbol, interval, pricePrecision: pdp, indicators });
  };
  xl.addEventListener("change", buildChart);

  on(root, "click", "[data-interval]", (_e, btn) => {
    interval = btn.dataset.interval;
    writeLocal("hf.chart.interval", interval);
    drawToolbar();
    buildChart();
    openStream();
  });
  on(root, "click", "[data-ind]", (_e, btn) => {
    const k = btn.dataset.ind;
    if (indicators.has(k)) indicators.delete(k);
    else indicators.add(k);
    writeLocal("hf.chart.indicators", [...indicators]);
    drawToolbar();
    buildChart();
  });
  on(root, "click", "[data-mtab]", (_e, btn) => {
    mobileTab = btn.dataset.mtab;
    drawMobileTabs();
    applyMobileTab();
  });

  /* ── Order book & trades ── */
  const drawBook = (book, lastPrice) => {
    $$("[data-book]", root).forEach((el) => {
      const rows = Number(el.dataset.book);
      if (!book) return mount(el, html`<div class="space-y-1 p-3">${Array.from({ length: rows * 2 }, () => skeleton("h-4 w-full"))}</div>`);
      const asks = book.asks.slice(0, rows).reverse();
      const bids = book.bids.slice(0, rows);
      const max = Math.max(1e-12, ...asks.map((a) => a[1]), ...bids.map((x) => x[1]));
      const spread = book.bids[0] && book.asks[0] ? book.asks[0][0] - book.bids[0][0] : null;
      const row = ([p, q], side) =>
        html`<button type="button" data-price="${p}" title="Use this price" class="num relative grid w-full grid-cols-3 px-3 py-[3px] text-[11.5px] hover:bg-panel-2"><span class="${cx("absolute inset-y-0 right-0", side === "ask" ? "bg-down/10" : "bg-up/10")}" style="width:${(q / max) * 100}%"></span><span class="${cx("relative text-left", side === "ask" ? "text-down" : "text-up")}">${formatPrice(p, pdp)}</span><span class="relative text-right text-fg">${formatNumber(q, 5)}</span><span class="relative text-right text-dim">${formatNumber(p * q, 2)}</span></button>`;
      mount(
        el,
        html`<div class="grid grid-cols-3 px-3 py-1.5 text-[10px] font-semibold tracking-wider text-dim uppercase"><span>Price</span><span class="text-right">Amount (${b.symbol})</span><span class="text-right">Total</span></div>
        ${asks.map((a) => row(a, "ask"))}
        <div class="flex items-center justify-between border-y border-line px-3 py-1.5"><span class="num font-display text-sm font-bold text-white">${lastPrice !== null ? formatPrice(lastPrice, pdp) : "—"}</span><span class="text-[10px] text-dim">Spread ${spread !== null ? formatPrice(spread, pdp) : "—"}</span></div>
        ${bids.map((x) => row(x, "bid"))}`,
      );
    });
  };
  const drawTrades = (trades, connected) =>
    $$("[data-trades]", root).forEach((el) =>
      mount(
        el,
        html`<div class="grid grid-cols-3 px-3 py-1.5 text-[10px] font-semibold tracking-wider text-dim uppercase"><span>Price</span><span class="text-right">Amount (${b.symbol})</span><span class="text-right">Time</span></div>
        ${
          !connected && !trades.length
            ? html`<p class="px-3 py-6 text-center text-xs text-dim">Live trade stream unavailable.</p>`
            : trades.slice(0, 22).map((t) => html`<div class="num grid grid-cols-3 px-3 py-[3px] text-[11.5px]"><span class="${t.sell ? "text-down" : "text-up"}">${formatPrice(t.price, pdp)}</span><span class="text-right text-fg">${formatNumber(t.qty, 5)}</span><span class="text-right text-dim">${formatDate(new Date(t.time), "time")}</span></div>`)
        }`,
      ),
    );

  /* ── Info bar ── */
  const drawInfo = (lastPrice) => {
    const s = marketState();
    const t = s.tickers[market.symbol];
    const last = $("[data-last]", root);
    last.textContent = lastPrice !== null ? formatPrice(lastPrice, pdp) : "—";
    last.className = cx("num font-display text-xl font-extrabold", t && t.changePercent >= 0 ? "text-up" : "text-down");
    const stat = (k, v) => html`<div class="hidden text-xs sm:block"><p class="text-dim">${k}</p><p class="num font-semibold text-fg">${v}</p></div>`;
    mount(
      $("[data-stats]", root),
      html`${stat("24h Change", t ? html`<span class="${t.changePercent >= 0 ? "text-up" : "text-down"}">${formatPrice(t.priceChange, pdp)} (${formatPercent(t.changePercent)})</span>` : "—")}
      ${stat("24h High", t ? formatPrice(t.high, pdp) : "—")}${stat("24h Low", t ? formatPrice(t.low, pdp) : "—")}
      ${stat(`24h Vol (${b.symbol})`, t ? formatCompact(t.volume) : "—")}${stat("24h Vol (USDT)", t ? formatCompact(t.quoteVolume) : "—")}`,
    );
    mount($("[data-feed]", root), feedStatus(s.mode, s.provider));
    if (lastPrice !== null) document.title = `${formatPrice(lastPrice, pdp)} · ${b.symbol}/USDT | HarborFinance`;
  };

  /* ── Live data ── */
  const order = mountOrderPanel($("[data-order]", root), { market, user });
  let stream = { kline: null, book: null, trades: [], connected: false };
  const lastPrice = () => {
    const s = marketState();
    if (s.mode === "delayed" || s.mode === "unavailable") return null;
    return stream.kline?.close ?? s.tickers[market.symbol]?.lastPrice ?? null;
  };
  let lastInfo = 0;
  const refresh = () => {
    const p = lastPrice();
    order.setLastPrice(p);
    if (Date.now() - lastInfo > 500) {
      lastInfo = Date.now();
      drawInfo(p);
    }
  };
  let closeStream = null;
  const openStream = () => {
    closeStream?.();
    closeStream = openMarketStream(market.symbol, market.providerSymbol ?? market.symbol.replace("-", ""), interval, (st) => {
      stream = st;
      chart?.update(st.kline);
      drawBook(st.book, lastPrice());
      drawTrades(st.trades, st.connected);
      refresh();
    });
  };
  subscribeMarkets(refresh);
  on(root, "click", "[data-price]", (_e, btn) => order.pickPrice(Number(btn.dataset.price)));

  /* ── Favorites ── */
  if (user) {
    const favBtn = $("[data-fav]", root);
    watch("/api/markets/favorites", ({ data }) => {
      if (!data) return;
      const fav = data.includes(market.symbol);
      favBtn.setAttribute("aria-label", fav ? "Remove from favorites" : "Add to favorites");
      favBtn.setAttribute("aria-pressed", String(fav));
      mount(favBtn, icon("star", cx("h-4 w-4", fav && "fill-accent text-accent")));
    });
    favBtn.addEventListener("click", async () => {
      await api("/api/markets/favorites", { body: { market: market.symbol } }).catch(() => {});
      invalidate("/api/markets/favorites");
    });
  }

  /* ── Market picker (below xl) ── */
  on(root, "click", "[data-pick]", () => {
    if (xl.matches) return;
    const m = openModal({ title: "Select market", size: "sm", body: html`<div class="-mx-5 -my-4 h-[60vh]" data-picker></div>` });
    mountMarketSelector($("[data-picker]", m.el), { current: market.symbol, signedIn: !!user });
  });

  drawToolbar();
  drawMobileTabs();
  applyMobileTab();
  drawBook(null, null);
  drawTrades([], true);
  drawInfo(null);
  mountMarketSelector($("[data-selector]", root), { current: market.symbol, signedIn: !!user });
  mountOrdersPanel($("[data-orders]", root), { market: market.symbol, user });
  buildChart();
  openStream();
}
