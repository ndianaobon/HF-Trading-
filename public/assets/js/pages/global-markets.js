import { html, $, mount } from "../core/dom.js";
import { api } from "../core/api.js";
import { initSite } from "../core/site.js";
import { errorState, priceChange, sparkline, feedStatus, assetIcon } from "../core/ui.js";
import { formatNumber } from "../core/format.js";

initSite();

const root = $("#global-markets");
const assetClass = root.dataset.class;
const COLORS = { forex: "#3b82f6", shares: "#8b5cf6", indices: "#F4BE2C" };
// A quote older than this is treated as "market closed" (weekend / outside trading hours).
const CLOSED_AFTER = 30 * 60_000;

const dp = (row) => (assetClass === "forex" ? (row.price >= 20 ? 3 : 5) : 2);
const price = (row) => (row.price === null ? "—" : formatNumber(row.price, dp(row), dp(row)));
const time = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function render(d) {
  const open = d.rows.some((r) => r.time && Date.now() - r.time < CLOSED_AFTER);
  mount(
    root,
    html`<div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div class="flex items-center gap-3">${feedStatus(d.stale ? "delayed" : "polling", d.provider)}${open ? "" : html`<span class="badge badge-neutral">Market closed · last prices</span>`}</div>
        <span class="text-xs text-dim">Updated ${new Date(d.updatedAt).toLocaleTimeString()}</span>
      </div>
      <div class="overflow-x-auto">
        <table class="table min-w-[720px]">
          <thead><tr><th>${assetClass === "forex" ? "Pair" : assetClass === "shares" ? "Company" : "Index"}</th><th class="r">Price</th><th class="r">Change</th><th class="r">Change %</th><th class="r">Day range</th><th class="r">Today</th><th class="r">Last update</th></tr></thead>
          <tbody>${d.rows.map(
            (r) => html`<tr>
              <td><div class="flex items-center gap-3">${assetIcon(r.label.replace(/[^A-Z0-9]/gi, "").slice(0, 3), COLORS[assetClass], 32)}<div><p class="font-semibold text-white">${r.label}</p><p class="text-xs text-dim">${r.name}${r.currency && assetClass !== "forex" ? ` · ${r.currency}` : ""}</p></div></div></td>
              <td class="num r font-semibold text-white">${price(r)}</td>
              <td class="num r ${r.change >= 0 ? "text-up" : "text-down"}">${r.change === null || r.change === undefined ? "—" : `${r.change >= 0 ? "+" : ""}${formatNumber(r.change, dp(r), dp(r))}`}</td>
              <td class="r">${priceChange(r.changePercent)}</td>
              <td class="num r text-muted">${r.low && r.high ? `${formatNumber(r.low, dp(r), dp(r))} – ${formatNumber(r.high, dp(r), dp(r))}` : "—"}</td>
              <td class="r"><span class="inline-block">${sparkline(r.spark, 96, 32, r.changePercent === null ? undefined : r.changePercent >= 0)}</span></td>
              <td class="r text-xs text-dim">${time(r.time)}</td>
            </tr>`,
          )}</tbody>
        </table>
      </div>`,
  );
}

async function load() {
  try {
    render(await api(`/api/public/global-markets/${assetClass}`, { allowAnonymous: true }));
  } catch (err) {
    if (!root.querySelector("table")) mount(root, errorState({ message: err.message }));
  }
}

load();
setInterval(() => document.visibilityState === "visible" && load(), 30_000);
