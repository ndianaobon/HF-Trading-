import { html, $, mount } from "../core/dom.js";
import { api } from "../core/api.js";
import { watch } from "../core/store.js";
import { initSite, getOptionalUser } from "../core/site.js";
import { subscribeMarkets } from "../core/tickers.js";
import { feedStatus, priceChange, assetIcon, sparkline, skeleton } from "../core/ui.js";
import { candlesSvg } from "../core/charts.js";
import { formatCompact, formatDuration, formatNumber, formatPrice } from "../core/format.js";
import { mountMarketTable } from "../components/market-table.js";
import { PLAN_FEATURES } from "../components/plan-card.js";
import { icon } from "../core/icons.js";

initSite();

/* Hero terminal: live BTC price, 15m candles and order book (real provider data). */
function initHero() {
  const root = $("#hero-visual");
  const priceEl = $("[data-hero-price]", root);
  const statsEl = $("[data-hero-stats]", root);
  subscribeMarkets((s) => {
    mount($("[data-hero-status]", root), feedStatus(s.mode, s.provider));
    const t = s.tickers["BTC-USDT"];
    $("[data-market-count]").textContent = s.markets.length ? String(s.markets.length) : "—";
    if (!t) return;
    mount(priceEl, html`<p class="num font-display text-3xl font-extrabold ${t.changePercent >= 0 ? "text-up" : "text-down"}">${formatPrice(t.lastPrice, 2)}</p>${priceChange(t.changePercent, { withIcon: true, cls: "mb-1 text-sm" })}`);
    mount(
      statsEl,
      html`<span>24h High <b class="num text-muted">${formatPrice(t.high, 2)}</b></span><span>24h Low <b class="num text-muted">${formatPrice(t.low, 2)}</b></span><span class="hidden sm:inline">Vol <b class="num text-muted">${formatCompact(t.quoteVolume)}</b></span>`,
    );
  });
  watch(
    "/api/markets/BTC-USDT/candles?interval=15m&limit=96",
    ({ data, error }) => mount($("[data-hero-chart]", root), data ? candlesSvg(data.candles) : error ? html`<div class="grid h-full place-items-center text-sm text-dim">Chart data unavailable</div>` : skeleton("h-full w-full")),
    { refresh: 30000 },
  );
  watch(
    "/api/markets/BTC-USDT/orderbook",
    ({ data }) => {
      if (!data) return;
      const asks = data.asks.slice(0, 6).reverse();
      const bids = data.bids.slice(0, 6);
      const max = Math.max(1e-9, ...asks.map((a) => a[1]), ...bids.map((b) => b[1]));
      const row = ([p, q], side) =>
        html`<div class="num relative flex justify-between px-1 py-0.5"><span class="absolute inset-y-0 right-0 ${side === "ask" ? "bg-down/10" : "bg-up/10"}" style="width:${(q / max) * 100}%"></span><span class="relative ${side === "ask" ? "text-down" : "text-up"}">${formatPrice(p, 2)}</span><span class="relative text-muted">${q.toFixed(4)}</span></div>`;
      const mid = (data.asks[0]?.[0] + data.bids[0]?.[0]) / 2;
      mount($("[data-hero-book]", root), html`${asks.map((a) => row(a, "ask"))}<div class="num py-1.5 text-center font-display text-sm font-bold text-white">${Number.isFinite(mid) ? formatPrice(mid, 2) : "—"}</div>${bids.map((b) => row(b, "bid"))}`);
    },
    { refresh: 4000 },
  );
}

/* Featured market cards with 24h sparklines. */
function initMarketCards() {
  const el = $("#market-cards");
  const FEATURED = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "BNB-USDT", "XRP-USDT"];
  const series = {};
  let feed = null;
  const draw = () => {
    if (!feed) return;
    if (feed.mode === "unavailable" && !Object.keys(feed.tickers).length) {
      el.className = "";
      mount(el, html`<p class="rounded-2xl border border-line bg-panel px-4 py-6 text-center text-sm text-muted">Live prices are temporarily unavailable. Please check back shortly.</p>`);
      return;
    }
    mount(
      el,
      FEATURED.map((symbol) => {
        const m = feed.markets.find((x) => x.symbol === symbol);
        const t = feed.tickers[symbol];
        const pts = series[symbol] ? [...series[symbol]] : [];
        if (t && pts.length) pts[pts.length - 1] = t.lastPrice;
        return html`<a href="/trade/${symbol}" class="group rounded-2xl border border-line bg-panel/80 p-4 transition-all hover:-translate-y-0.5 hover:border-line-strong hover:bg-panel-2">
          <div class="flex items-center justify-between"><div class="flex items-center gap-2.5">${assetIcon(symbol.split("-")[0], m?.base.color, 30)}<div class="leading-tight"><p class="text-sm font-bold text-white">${symbol.replace("-", "/")}</p><p class="text-[11px] text-dim">${m?.base.name ?? ""}</p></div></div>${priceChange(t?.changePercent, { cls: "text-xs" })}</div>
          <div class="mt-3 flex items-end justify-between gap-2">${t ? html`<p class="num font-display text-lg font-bold text-white">${formatPrice(t.lastPrice, m?.pricePrecision)}</p>` : skeleton("h-6 w-24")}${pts.length > 1 ? sparkline(pts, 88, 30) : skeleton("h-[30px] w-[88px]")}</div>
        </a>`;
      }),
    );
  };
  let last = 0;
  subscribeMarkets((s) => {
    feed = s;
    if (Date.now() - last > 1000) {
      last = Date.now();
      draw();
    }
  });
  for (const symbol of FEATURED) {
    api(`/api/markets/${symbol}/candles?interval=1h&limit=50`, { allowAnonymous: true })
      .then((d) => {
        series[symbol] = d.candles.slice(-24).map((c) => c.close);
        draw();
      })
      .catch(() => {});
  }
}

async function initPlans() {
  const el = $("#plans-preview");
  try {
    const plans = await api("/api/investments/plans", { allowAnonymous: true });
    mount(
      el,
      plans.slice(0, 4).map(
        (p) => html`<a href="/investment-plans#${p.slug}" class="rounded-2xl border border-line bg-panel p-6 transition-colors hover:border-line-strong">
          <div class="flex items-center justify-between gap-3"><h3 class="font-display text-lg font-bold text-white">${p.name}</h3><span class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-up/25 bg-up-soft px-2.5 py-1 text-xs font-semibold text-up">${icon("badge-check", "h-3.5 w-3.5")} Verified</span></div>
          <p class="mt-2 text-sm text-muted">${p.tagline}</p>
          <dl class="mt-5 space-y-2 text-sm">
            <div class="flex justify-between"><dt class="text-dim">Min. Deposit</dt><dd class="num font-semibold text-white">$${formatNumber(p.minAllocation, 0)}</dd></div>
            <div class="flex justify-between"><dt class="text-dim">Max. Deposit</dt><dd class="num font-semibold text-white">$${formatNumber(p.maxAllocation, 0)}</dd></div>
            <div class="flex justify-between"><dt class="text-dim">Duration</dt><dd class="font-semibold text-white">${formatDuration(p.durationDays)}</dd></div>
          </dl>
          <ul class="mt-5 space-y-2 border-t border-line pt-4 text-sm">
            ${(PLAN_FEATURES[p.slug] ?? ["Full Analysis"]).map((f) => html`<li class="flex items-center gap-2 text-white">${icon("circle-check", "h-4 w-4 shrink-0 text-accent")} ${f}</li>`)}
          </ul>
        </a>`,
      ),
    );
  } catch {
    mount(el, html`<p class="text-sm text-dim">Plans are temporarily unavailable.</p>`);
  }
}

initHero();
initMarketCards();
void initPlans();
getOptionalUser().then((user) => {
  const el = $("#market-table");
  mountMarketTable(el, { categories: el.dataset.categories.split(","), limit: Number(el.dataset.limit), signedIn: !!user });
});
