import { html, $, on, mount, debounce } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { watch } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { subscribeMarkets, marketState } from "../core/tickers.js";
import { stat, card, notice, errorState, emptyState, skeleton, pageHeader, segmented, assetIcon, priceChange, DataTable, downloadCsv } from "../core/ui.js";
import { donut } from "../core/charts.js";
import { formatNumber, formatPercent, formatPrice, formatUsd } from "../core/format.js";
import { performanceCard, mountPerformance } from "../components/performance.js";

await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

const FILTERS = [
  { value: "all", label: "All" },
  { value: "crypto", label: "Crypto" },
  { value: "stable", label: "Stablecoins" },
  { value: "profit", label: "In profit" },
  { value: "loss", label: "In loss" },
];

mount(
  view,
  html`${pageHeader({
      title: "Portfolio",
      description: "Holdings valued in USDT at live market prices.",
      actions: html`<button type="button" class="btn btn-secondary" data-export disabled>${icon("download", "h-4 w-4")} Export</button><a href="/dashboard/deposit" class="btn btn-primary">Deposit</a>`,
    })}
    <div data-notice></div>
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-5" data-stats>${Array.from({ length: 5 }, (_, i) => stat({ label: "", loading: true, cls: i === 0 ? "col-span-2 lg:col-span-1" : "" }))}</div>
    <div class="mt-6 grid gap-6 lg:grid-cols-3">
      ${performanceCard({ cls: "lg:col-span-2", height: 280 })}
      ${card({ title: "Asset allocation", body: html`<div class="card-body" data-alloc>${skeleton("h-[220px] w-full")}</div>` })}
    </div>
    <section class="card mt-6">
      <div class="flex flex-col gap-3 px-5 pt-5 pb-3 md:flex-row md:items-center md:justify-between">
        <h3 class="font-display text-[15px] font-bold text-white">Holdings</h3>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div data-filters class="overflow-x-auto">${segmented(FILTERS, "all", { size: "sm", name: "filter" })}</div>
          <div class="relative">
            <span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim">${icon("search", "h-4 w-4")}</span>
            <input data-q placeholder="Search assets" aria-label="Search holdings" class="input h-8 w-full pl-9 text-sm sm:w-48" />
          </div>
        </div>
      </div>
      <div class="border-t border-line" data-table></div>
    </section>`,
);

let p = null;
let filter = "all";
let q = "";

const pnlCell = (r) =>
  r.livePnl === null
    ? html`<span class="text-dim">—</span>`
    : html`<div class="num font-semibold ${r.livePnl >= 0 ? "text-up" : "text-down"}"><p>${formatUsd(r.livePnl, { sign: true })}</p>${r.avgPrice && r.livePrice !== null ? html`<p class="text-xs font-medium">${formatPercent(((r.livePrice - Number(r.avgPrice)) / Number(r.avgPrice)) * 100)}</p>` : ""}</div>`;

const table = new DataTable($("[data-table]", view), {
  columns: [
    { key: "asset", header: "Asset", sortValue: (r) => r.symbol, cell: (r) => html`<div class="flex items-center gap-3">${assetIcon(r.symbol, r.color, 30)}<div><p class="font-semibold text-white">${r.symbol}</p><p class="text-xs text-dim">${r.name}</p></div></div>` },
    { key: "qty", header: "Quantity", align: "right", sortValue: (r) => Number(r.quantity), cell: (r) => html`<div class="num"><p class="text-white">${formatNumber(r.quantity, 8)}</p>${Number(r.locked) > 0 ? html`<p class="text-xs text-dim">${formatNumber(r.locked, 8)} locked</p>` : ""}</div>` },
    { key: "avg", header: "Average price", align: "right", hideOnMobile: true, sortValue: (r) => (r.avgPrice ? Number(r.avgPrice) : null), cell: (r) => html`<span class="num text-muted">${r.avgPrice ? formatPrice(r.avgPrice) : "—"}</span>` },
    { key: "price", header: "Current price", align: "right", sortValue: (r) => r.livePrice, cell: (r) => html`<span class="num">${r.livePrice !== null ? formatPrice(r.livePrice) : "—"}</span>` },
    { key: "value", header: "Value", align: "right", sortValue: (r) => r.liveValue, cell: (r) => html`<span class="num font-semibold text-white">${r.liveValue !== null ? formatUsd(r.liveValue) : "—"}</span>` },
    { key: "chg", header: "24h Change", align: "right", hideOnMobile: true, sortValue: (r) => r.liveChange, cell: (r) => priceChange(r.liveChange) },
    { key: "pnl", header: "P&L", align: "right", sortValue: (r) => r.livePnl, cell: pnlCell },
  ],
  defaultSort: { key: "value", dir: "desc" },
  onRowClick: (r) => (location.href = r.symbol === "USDT" ? "/dashboard/wallets" : `/trade/${r.symbol}-USDT`),
  empty: emptyState({ title: "No holdings match", description: "Adjust the filter or deposit funds.", action: html`<a href="/dashboard/deposit" class="text-sm font-semibold text-accent">Deposit →</a>` }),
});

function rows() {
  if (!p) return [];
  const tickers = marketState().tickers;
  const Q = q.toUpperCase();
  return p.holdings
    .map((h) => {
      const t = tickers[`${h.symbol}-USDT`];
      const livePrice = t?.lastPrice ?? h.price;
      const liveValue = livePrice !== null ? Number(h.quantity) * livePrice : h.value;
      const livePnl = h.avgPrice && livePrice !== null ? (livePrice - Number(h.avgPrice)) * Number(h.quantity) : h.pnl;
      return { ...h, livePrice, liveValue, livePnl, liveChange: t?.changePercent ?? h.change24h };
    })
    .filter((h) => !Q || h.symbol.includes(Q) || h.name.toUpperCase().includes(Q))
    .filter((h) => {
      if (filter === "crypto") return h.type !== "STABLECOIN";
      if (filter === "stable") return h.type === "STABLECOIN";
      if (filter === "profit") return (h.livePnl ?? 0) > 0;
      if (filter === "loss") return (h.livePnl ?? 0) < 0;
      return true;
    });
}

const tone = (v) => (v === null || v === undefined ? "" : v >= 0 ? "text-up" : "text-down");

function drawSummary() {
  mount($("[data-notice]", view), p.isDemo ? notice("warn", { cls: "mb-6", body: "Demo account — holdings and cost basis are simulated." }) : "");
  const totalPnl = p.unrealizedPnl !== null ? p.unrealizedPnl + p.realizedPnl : null;
  mount(
    $("[data-stats]", view),
    html`${stat({ cls: "col-span-2 lg:col-span-1", label: "Total value", value: p.totalValue !== null ? formatUsd(p.totalValue) : "—" })}
    ${stat({ label: "Available cash", value: formatUsd(p.availableBalance), sub: "USDT" })}
    ${stat({ label: "Invested amount", value: formatUsd(p.investedBalance), sub: "Plans & copy" })}
    ${stat({ label: "Profit / loss", value: html`<span class="${tone(totalPnl)}">${totalPnl !== null ? formatUsd(totalPnl, { sign: true }) : "—"}</span>`, sub: "Realised + unrealised" })}
    ${stat({ label: "ROI", value: html`<span class="${tone(p.roiPct)}">${p.roiPct !== null ? formatPercent(p.roiPct) : "—"}</span>`, sub: `vs net deposits ${formatUsd(p.netDeposits, { compact: true })}` })}`,
  );
  const slices = p.holdings.filter((h) => h.value > 0).map((h) => ({ label: h.symbol, value: h.value, color: h.color }));
  if (p.investedBalance > 0) slices.push({ label: "Plans & copy", value: p.investedBalance, color: "#F4BE2C" });
  mount($("[data-alloc]", view), slices.length ? donut(slices, p.totalValue) : emptyState({ title: "No assets yet" }));
}

const drawTable = () => {
  table.set(rows());
  $("[data-export]", view).disabled = !table.rows.length;
};

watch(
  "/api/portfolio",
  ({ data, error }) => {
    if (data) {
      p = data;
      drawSummary();
      drawTable();
    } else if (error) mount(view, errorState({ message: error.message }));
  },
  { refresh: 30000 },
);

let last = 0;
subscribeMarkets(() => {
  if (p && Date.now() - last > 3000) {
    last = Date.now();
    drawTable();
  }
});

on(view, "click", "[data-filters] [data-filter]", (_e, b) => {
  filter = b.dataset.filter;
  mount($("[data-filters]", view), segmented(FILTERS, filter, { size: "sm", name: "filter" }));
  drawTable();
});
$("[data-q]", view).addEventListener(
  "input",
  debounce((e) => {
    q = e.target.value.trim();
    drawTable();
  }, 150),
);
on(view, "click", "[data-export]", () =>
  downloadCsv(
    "harborfinance-holdings.csv",
    ["asset", "quantity", "available", "locked", "avg_price", "price", "value_usdt", "change_24h", "pnl_usdt"],
    rows().map((r) => [r.symbol, r.quantity, r.available, r.locked, r.avgPrice ?? "", r.livePrice ?? "", r.liveValue?.toFixed(2) ?? "", r.liveChange?.toFixed(2) ?? "", r.livePnl?.toFixed(2) ?? ""]),
  ),
);

mountPerformance(view, "90d");
