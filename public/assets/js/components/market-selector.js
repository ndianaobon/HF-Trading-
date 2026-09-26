// Compact market list for the trading page (desktop sidebar and mobile picker).

import { html, $, on, mount, cx, debounce } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { watch } from "../core/store.js";
import { subscribeMarkets, marketState } from "../core/tickers.js";
import { segmented } from "../core/ui.js";
import { formatPercent, formatPrice } from "../core/format.js";

export function mountMarketSelector(el, { current, signedIn }) {
  let q = "";
  let tab = "all";
  let favs = [];

  mount(
    el,
    html`<div class="flex h-full flex-col">
      <div class="space-y-2 p-3">
        <div class="relative">${icon("search", "pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-dim")}<input data-q placeholder="Search" aria-label="Search markets" autocomplete="off" class="h-8 w-full rounded-lg border border-line bg-base-2 pr-2 pl-8 text-xs focus:border-accent/60 focus:outline-none" /></div>
        <div data-tabs></div>
      </div>
      <div class="grid grid-cols-[1fr_auto_auto] gap-2 px-3 pb-1 text-[10px] font-semibold tracking-wider text-dim uppercase"><span>Pair</span><span class="text-right">Price</span><span class="w-14 text-right">24h</span></div>
      <div class="flex-1 overflow-y-auto" data-list></div>
    </div>`,
  );

  const drawTabs = () =>
    mount(
      $("[data-tabs]", el),
      segmented(
        [
          { value: "all", label: "USDT" },
          ...(signedIn ? [{ value: "fav", label: icon("star", "mx-auto h-3.5 w-3.5") }] : []),
          { value: "gainers", label: "Gainers" },
        ],
        tab,
        { size: "sm", name: "mtab", cls: "w-full" },
      ),
    );

  let last = 0;
  let timer = null;
  const draw = () => {
    const now = Date.now();
    if (now - last < 1000) {
      timer ??= setTimeout(() => {
        timer = null;
        draw();
      }, 1000);
      return;
    }
    last = now;
    const { markets, tickers } = marketState();
    const n = q.toUpperCase();
    let list = markets.filter((m) => !n || m.base.symbol.includes(n) || m.base.name.toUpperCase().includes(n));
    if (tab === "fav") list = list.filter((m) => favs.includes(m.symbol));
    const rows = list.map((m) => ({ m, t: tickers[m.symbol] }));
    if (tab === "gainers") rows.sort((a, b) => (b.t?.changePercent ?? -1e9) - (a.t?.changePercent ?? -1e9));
    else rows.sort((a, b) => (b.t?.quoteVolume ?? 0) - (a.t?.quoteVolume ?? 0));
    const listEl = $("[data-list]", el);
    const scroll = listEl.scrollTop;
    mount(
      listEl,
      rows.length
        ? rows.map(
            ({ m, t }) =>
              html`<a href="/trade/${m.symbol}" class="${cx("grid grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-1.5 text-xs hover:bg-panel-2", m.symbol === current && "bg-panel-3")}" ${m.symbol === current ? html`aria-current="page"` : ""}>
                <span class="truncate"><span class="font-semibold text-white">${m.base.symbol}</span><span class="text-dim">/USDT</span></span>
                <span class="num text-right text-fg">${t ? formatPrice(t.lastPrice, m.pricePrecision) : "—"}</span>
                <span class="${cx("num w-14 text-right", !t ? "text-dim" : t.changePercent >= 0 ? "text-up" : "text-down")}">${t ? formatPercent(t.changePercent) : "—"}</span>
              </a>`,
          )
        : html`<p class="px-3 py-6 text-center text-xs text-dim">${tab === "fav" ? "No favorite markets yet" : "No markets found"}</p>`,
    );
    listEl.scrollTop = scroll;
  };

  drawTabs();
  subscribeMarkets(draw);
  if (signedIn)
    watch("/api/markets/favorites", ({ data }) => {
      if (!data) return;
      favs = data;
      last = 0;
      draw();
    });
  on(el, "click", "[data-mtab]", (_e, b) => {
    tab = b.dataset.mtab;
    drawTabs();
    last = 0;
    draw();
  });
  $("[data-q]", el).addEventListener(
    "input",
    debounce((e) => {
      q = e.target.value.trim();
      last = 0;
      draw();
    }, 120),
  );
}
