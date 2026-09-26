// Market overview table: category tabs, search, sortable columns, favourites
// (signed-in users) and live prices from the shared market feed.

import { html, $, on, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { DataTable, tabs, feedStatus, assetIcon, priceChange, emptyState } from "../core/ui.js";
import { subscribeMarkets } from "../core/tickers.js";
import { formatCompact, formatPrice } from "../core/format.js";

export const CATEGORY_LABELS = {
  ALL: "All",
  FAVORITES: "Favorites",
  SPOT: "Spot",
  MAJOR: "Major Coins",
  LAYER1: "Layer 1",
  LAYER2: "Layer 2",
  DEFI: "DeFi",
  STABLECOIN: "Stablecoins",
  MEME: "Meme",
};

export function mountMarketTable(el, { categories = ["ALL", "LAYER1", "DEFI", "STABLECOIN", "MEME", "MAJOR"], initial = "ALL", limit, signedIn = false, tradeBase = "/trade" } = {}) {
  let category = categories.includes(initial) ? initial : categories[0];
  let q = "";
  let favs = new Set();
  let feed = null;
  const lastPrices = new Map();
  const visibleCats = categories.filter((c) => c !== "FAVORITES" || signedIn);

  mount(
    el,
    html`<div class="flex flex-col gap-3 px-4 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div data-tabs></div>
        <div class="flex items-center gap-3">
          <span class="hidden sm:inline-flex" data-status></span>
          <div class="relative w-full sm:w-56">${icon("search", "pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-dim")}<input type="search" placeholder="Search BTC, ETH, SOL…" aria-label="Search markets" class="h-9 w-full rounded-lg border border-line-strong bg-base-2 pr-3 pl-9 text-sm text-fg placeholder:text-dim focus:border-accent/60 focus:outline-none" /></div>
        </div>
      </div>
      <div class="mt-2 border-t border-line" data-table></div>`,
  );

  const drawTabs = () => mount($("[data-tabs]", el), tabs(visibleCats.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })), category, { size: "sm", cls: "border-0", name: "cat" }));
  drawTabs();

  const table = new DataTable($("[data-table]", el), {
    rowKey: (r) => r.m.symbol,
    onRowClick: (r) => (location.href = `${tradeBase}/${r.m.symbol}`),
    defaultSort: { key: "volume", dir: "desc" },
    empty: emptyState({
      title: category === "FAVORITES" ? "No favorites yet" : "No markets found",
      description: category === "FAVORITES" ? "Tap the star next to any market to add it here." : "Try a different search or category.",
    }),
    columns: [
      {
        key: "asset",
        header: "Asset",
        sortValue: (r) => r.m.base.symbol,
        cell: (r) => html`<div class="flex items-center gap-3">
          ${signedIn ? html`<button type="button" data-fav="${r.m.symbol}" class="text-dim hover:text-accent" aria-label="${favs.has(r.m.symbol) ? "Remove from" : "Add to"} favorites">${icon("star", favs.has(r.m.symbol) ? "h-4 w-4 fill-accent text-accent" : "h-4 w-4")}</button>` : ""}
          ${assetIcon(r.m.base.symbol, r.m.base.color, 30)}
          <div class="leading-tight"><p class="font-semibold text-white">${r.m.base.symbol}</p><p class="text-xs text-dim">${r.m.base.name}</p></div>
        </div>`,
      },
      { key: "pair", header: "Pair", hideOnMobile: true, cell: (r) => html`<span class="text-muted">${r.m.base.symbol}/${r.m.quote.symbol}</span>` },
      {
        key: "price",
        header: "Price",
        align: "right",
        sortValue: (r) => r.t?.lastPrice ?? null,
        cell: (r) => html`<span class="num rounded px-1 font-semibold text-white ${r.flash === 1 ? "animate-flash-up" : r.flash === -1 ? "animate-flash-down" : ""}">${r.t ? formatPrice(r.t.lastPrice, r.m.pricePrecision) : "—"}</span>`,
      },
      { key: "change", header: "24h Change", align: "right", sortValue: (r) => r.t?.changePercent ?? null, cell: (r) => priceChange(r.t?.changePercent) },
      { key: "high", header: "24h High", align: "right", hideOnMobile: true, sortValue: (r) => r.t?.high ?? null, cell: (r) => html`<span class="num text-muted">${r.t ? formatPrice(r.t.high, r.m.pricePrecision) : "—"}</span>` },
      { key: "low", header: "24h Low", align: "right", hideOnMobile: true, sortValue: (r) => r.t?.low ?? null, cell: (r) => html`<span class="num text-muted">${r.t ? formatPrice(r.t.low, r.m.pricePrecision) : "—"}</span>` },
      { key: "volume", header: "Volume (USDT)", align: "right", hideOnMobile: true, sortValue: (r) => r.t?.quoteVolume ?? null, cell: (r) => html`<span class="num text-muted">${r.t ? formatCompact(r.t.quoteVolume) : "—"}</span>` },
      { key: "action", header: html`<span class="sr-only">Action</span>`, align: "right", cell: (r) => html`<a href="${tradeBase}/${r.m.symbol}" class="btn btn-outline btn-sm">Trade</a>` },
    ],
  });

  let lastDraw = 0;
  let pending = null;
  const draw = (force = false) => {
    if (!feed) return;
    const now = Date.now();
    if (!force && now - lastDraw < 1500) {
      pending ??= setTimeout(() => {
        pending = null;
        draw(true);
      }, 1500 - (now - lastDraw));
      return;
    }
    lastDraw = now;
    mount($("[data-status]", el), feedStatus(feed.mode, feed.provider));
    if (feed.mode === "unavailable" && !feed.markets.length) {
      table.el.innerHTML = String(emptyState({ title: "Market data unavailable", description: "We couldn't reach the market-data provider. Prices will appear as soon as the connection is restored." }));
      return;
    }
    const needle = q.trim().toUpperCase();
    let rows = feed.markets
      .filter((m) => (category === "FAVORITES" ? favs.has(m.symbol) : category === "ALL" || m.categories.includes(category)))
      .filter((m) => !needle || m.symbol.includes(needle) || m.base.name.toUpperCase().includes(needle))
      .map((m) => {
        const t = feed.tickers[m.symbol];
        const prev = lastPrices.get(m.symbol);
        const flash = t && prev !== undefined && t.lastPrice !== prev ? Math.sign(t.lastPrice - prev) : 0;
        if (t) lastPrices.set(m.symbol, t.lastPrice);
        return { m, t, flash };
      });
    if (limit) rows = [...rows].sort((a, b) => (b.t?.quoteVolume ?? 0) - (a.t?.quoteVolume ?? 0)).slice(0, limit);
    table.empty = emptyState(
      category === "FAVORITES"
        ? { title: "No favorites yet", description: "Tap the star next to any market to add it here.", iconName: "star" }
        : { title: "No markets found", description: "Try a different search or category." },
    );
    table.set(feed.markets.length ? rows : undefined, { loading: !feed.markets.length });
  };

  subscribeMarkets((s) => {
    feed = s;
    draw();
  });

  if (signedIn) {
    api("/api/markets/favorites")
      .then((list) => {
        favs = new Set(list);
        draw(true);
      })
      .catch(() => {});
  }

  on(el, "click", "[data-cat]", (_e, b) => {
    category = b.dataset.cat;
    drawTabs();
    draw(true);
  });
  on(el, "input", "input[type=search]", (e) => {
    q = e.target.value;
    draw(true);
  });
  on(el, "click", "[data-fav]", async (e, b) => {
    e.stopPropagation();
    const symbol = b.dataset.fav;
    try {
      const res = await api("/api/markets/favorites", { body: { market: symbol } });
      if (res.favorite) favs.add(symbol);
      else favs.delete(symbol);
      draw(true);
    } catch {
      /* ignore */
    }
  });
}
