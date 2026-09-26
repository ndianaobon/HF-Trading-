import { html, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { subscribeMarkets } from "../core/tickers.js";
import { assetIcon, priceChange, skeleton } from "../core/ui.js";
import { formatCompact, formatPrice } from "../core/format.js";

/** Top gainers, losers and volume leaders from the live feed (stablecoins excluded). */
export function mountTopMovers(el, { tradeBase = "/trade" } = {}) {
  let last = 0;
  subscribeMarkets((s) => {
    if (Date.now() - last < 2000 && el.childElementCount) return;
    last = Date.now();
    const rows = s.markets.filter((m) => !m.categories.includes("STABLECOIN")).map((m) => ({ m, t: s.tickers[m.symbol] })).filter((r) => r.t);
    const groups = [
      ["Top gainers", "trending-up", [...rows].sort((a, b) => b.t.changePercent - a.t.changePercent).slice(0, 4), false],
      ["Top losers", "trending-down", [...rows].sort((a, b) => a.t.changePercent - b.t.changePercent).slice(0, 4), false],
      ["Highest volume", "flame", [...rows].sort((a, b) => b.t.quoteVolume - a.t.quoteVolume).slice(0, 4), true],
    ];
    mount(
      el,
      groups.map(
        ([title, ic, items, vol]) => html`<div class="rounded-2xl border border-line bg-panel p-4">
          <p class="flex items-center gap-2 text-xs font-bold tracking-wider text-dim uppercase">${icon(ic, "h-3.5 w-3.5")} ${title}</p>
          <div class="mt-3 space-y-1">${
            items.length
              ? items.map(
                  ({ m, t }) => html`<a href="${tradeBase}/${m.symbol}" class="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-panel-2">
                    <span class="flex items-center gap-2">${assetIcon(m.base.symbol, m.base.color, 22)}<span class="text-sm font-semibold text-white">${m.base.symbol}</span></span>
                    <span class="flex items-center gap-3 text-sm"><span class="num text-muted">${vol ? formatCompact(t.quoteVolume) : formatPrice(t.lastPrice, m.pricePrecision)}</span>${priceChange(t.changePercent, { cls: "w-16 justify-end" })}</span>
                  </a>`,
                )
              : Array.from({ length: 4 }, () => skeleton("h-9 w-full"))
          }</div>
        </div>`,
      ),
    );
  });
}
