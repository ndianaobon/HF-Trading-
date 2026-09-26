// Trader profile: performance chart, risk statistics, trading history and Copy button.
import { html, $, on, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { riskBadge, demoBadge, badge, avatar, stat, notice, errorState, skeleton, DataTable, card } from "../core/ui.js";
import { valueChart } from "../core/charts.js";
import { formatCompact, formatDate, formatPercent } from "../core/format.js";
import { openCopyModal } from "./copy-modal.js";

export async function mountTraderProfile(el, { slug, signedIn, backHref }) {
  mount(el, skeleton("h-[600px] rounded-2xl"));
  let t;
  try {
    t = await api(`/api/copy-trading/traders/${encodeURIComponent(slug)}`, { allowAnonymous: true });
  } catch (err) {
    mount(el, errorState({ message: err.code === "NOT_FOUND" ? "This trader profile doesn't exist or is no longer available." : err.message, retry: false }));
    return;
  }
  document.title = `${t.displayName} — Copy Trading | HarborFinance`;
  const r = t.returns;
  const tone = (v) => (v === undefined ? "" : v >= 0 ? "text-up" : "text-down");

  mount(
    el,
    html`<div class="space-y-5">
      <a href="${backHref}" class="inline-flex items-center gap-1.5 text-sm text-muted hover:text-white">${icon("arrow-left", "h-4 w-4")} All traders</a>
      <section class="card p-5 sm:p-6">
        <div class="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div class="flex items-center gap-4">${avatar(t.displayName, t.avatarColor, 64)}<div>
            <div class="flex flex-wrap items-center gap-2"><h1 class="font-display text-2xl font-extrabold text-white">${t.displayName}</h1>${riskBadge(t.riskLevel)}${t.isDemo ? demoBadge("Demo statistics") : ""}</div>
            <p class="mt-1 text-sm text-muted">${t.strategy}</p>
            <div class="mt-2 flex flex-wrap gap-1.5">${t.strategyTags.map((s) => badge(s))}</div>
          </div></div>
          ${signedIn ? html`<button type="button" class="btn btn-primary btn-lg" data-copy-trader>${icon("copy", "h-4 w-4")} Copy Trader</button>` : html`<a class="btn btn-primary btn-lg" href="/login?next=${encodeURIComponent(`/dashboard/copy-trading/${t.slug}`)}">Log in to copy</a>`}
        </div>
        ${t.isDemo ? notice("warn", { body: "Statistics on this profile are illustrative demo data generated for the development environment. They are not a real trading record.", cls: "mt-5" }) : ""}
      </section>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        ${stat({ label: "90D return", value: html`<span class="${tone(r["90d"])}">${r["90d"] !== undefined ? formatPercent(r["90d"]) : "—"}</span>`, sub: `1Y ${r["1y"] !== undefined ? formatPercent(r["1y"]) : "—"}` })}
        ${stat({ label: "Max drawdown", value: `${Number(t.maxDrawdownPct).toFixed(2)}%`, sub: "Peak-to-trough, 1Y" })}
        ${stat({ label: "Assets under management", value: `$${formatCompact(t.aum)}`, sub: `${t.followers.toLocaleString()} followers` })}
        ${stat({ label: "Win rate", value: `${Number(t.winRatePct).toFixed(1)}%`, sub: `${Number(t.tradesPerWeek).toFixed(1)} trades / week` })}
      </div>
      <div class="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        ${card({ title: "Performance", description: "Equity index (start = 100)", body: html`<div class="card-body"><div class="h-[280px]" data-chart>${t.performanceSeries.length > 1 ? skeleton("h-full w-full") : html`<p class="py-16 text-center text-sm text-dim">No verified performance history yet.</p>`}</div></div>` })}
        ${card({
          title: "Risk statistics",
          body: html`<div class="card-body space-y-3 text-sm">${[
            ["Risk level", riskBadge(t.riskLevel)],
            ["Max drawdown", `${Number(t.maxDrawdownPct).toFixed(2)}%`],
            ["30D / 180D return", `${r["30d"] !== undefined ? formatPercent(r["30d"]) : "—"} / ${r["180d"] !== undefined ? formatPercent(r["180d"]) : "—"}`],
            ["Trading activity", `${Number(t.tradesPerWeek).toFixed(1)} trades / week`],
            ["Profit share", `${Number(t.profitSharePct)}% of positive results`],
            ["Minimum allocation", `${Number(t.minAllocation).toLocaleString()} USDT`],
            ["Markets traded", t.assets.join(", ")],
          ].map(([k, v]) => html`<div class="flex items-center justify-between gap-3 border-b border-line/60 pb-2.5 last:border-0"><span class="text-dim">${k}</span><span class="text-right font-medium text-fg">${v}</span></div>`)}<p class="pt-2 leading-relaxed text-muted">${t.bio}</p></div>`,
        })}
      </div>
      ${card({ title: "Trading history", description: "Most recent closed positions", body: html`<div data-trades></div>` })}
      <p class="text-xs leading-relaxed text-dim">Past performance is not a reliable indicator of future results. Copying a trader does not guarantee the same results, and you can lose some or all of your allocation.</p>
    </div>`,
  );

  if (t.performanceSeries.length > 1) valueChart($("[data-chart]", el), t.performanceSeries, { format: (v) => v.toFixed(2) }).catch(() => {});
  new DataTable($("[data-trades]", el), {
    rowKey: (x) => x.t + x.market,
    columns: [
      { key: "t", header: "Closed", cell: (x) => html`<span class="text-muted">${formatDate(x.t)}</span>` },
      { key: "m", header: "Market", cell: (x) => html`<span class="font-semibold text-white">${x.market.replace("-", "/")}</span>` },
      { key: "s", header: "Side", cell: (x) => html`<span class="${x.side === "BUY" ? "text-up" : "text-down"}">${x.side === "BUY" ? "Long" : "Short"}</span>` },
      { key: "p", header: "Result", align: "right", cell: (x) => html`<span class="num font-semibold ${x.pnlPct >= 0 ? "text-up" : "text-down"}">${formatPercent(x.pnlPct)}</span>` },
    ],
  }).set(t.recentTrades);
  on(el, "click", "[data-copy-trader]", () => openCopyModal(t));
}
