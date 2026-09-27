// Lead-trader profile: calculated performance, open positions, signal history,
// risk information and Start / Stop copying.
import { html, $, on, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { invalidate } from "../core/store.js";
import { riskBadge, badge, stat, notice, errorState, skeleton, DataTable, card, emptyState, confirmDialog, toast } from "../core/ui.js";
import { valueChart } from "../core/charts.js";
import { formatDate, formatPercent, formatUsd } from "../core/format.js";
import { openCopyModal } from "./copy-modal.js";
import { traderAvatar, traderStatusBadge, copyStatusBadge, sideLabel, pair, pctCell, priceCell, closeReason, tone, RISK_NOTE } from "./copy-bits.js";

export async function mountTraderProfile(el, { slug, signedIn, backHref }) {
  mount(el, skeleton("h-[600px] rounded-2xl"));
  const load = () => api(`/api/copy-trading/traders/${encodeURIComponent(slug)}`, { allowAnonymous: true });
  let t;
  try {
    t = await load();
  } catch (err) {
    mount(el, errorState({ message: err.code === "NOT_FOUND" ? "This trader profile doesn't exist or is no longer available." : err.message, retry: false }));
    return;
  }
  document.title = `${t.displayName} — Copy Trading | HarborFinance`;

  const render = () => {
    const s = t.stats;
    const canCopy = t.status === "ACTIVE" && t.copyEnabled;
    const action = !signedIn
      ? html`<a class="btn btn-primary btn-lg" href="/login?next=${encodeURIComponent(`/dashboard/copy-trading/${t.slug}`)}">Log in to copy</a>`
      : t.following
        ? html`<div class="flex flex-wrap items-center gap-2">${copyStatusBadge(t.following.status)}<a class="btn btn-secondary" href="/dashboard/copy-trading">Manage</a><button type="button" class="btn btn-danger" data-stop>${icon("square", "h-4 w-4")} Stop copying</button></div>`
        : canCopy
          ? html`<button type="button" class="btn btn-primary btn-lg" data-copy-trader>${icon("copy", "h-4 w-4")} Start copying</button>`
          : html`<span class="text-sm text-warn">${t.status === "SUSPENDED" ? "Copying is suspended for this trader." : "Not accepting new copiers right now."}</span>`;

    mount(
      el,
      html`<div class="space-y-5">
        <a href="${backHref}" class="inline-flex items-center gap-1.5 text-sm text-muted hover:text-white">${icon("arrow-left", "h-4 w-4")} All traders</a>
        <section class="card p-5 sm:p-6">
          <div class="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div class="flex items-center gap-4">${traderAvatar(t, 64)}<div>
              <div class="flex flex-wrap items-center gap-2"><h1 class="font-display text-2xl font-extrabold text-white">${t.displayName}</h1>${riskBadge(t.riskLevel)}${traderStatusBadge(t.status)}</div>
              <p class="mt-1 text-sm text-muted">${t.strategy}</p>
              <div class="mt-2 flex flex-wrap gap-1.5">${t.strategyTags.map((x) => badge(x))}</div>
            </div></div>
            ${action}
          </div>
          <p class="mt-5 max-w-3xl text-sm leading-relaxed text-muted">${t.bio}</p>
        </section>
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          ${stat({ label: "Signal return (all time)", value: html`<span class="${tone(s.totalReturnPct)}">${formatPercent(s.totalReturnPct)}</span>`, sub: `30D ${formatPercent(s.return30dPct)} · 90D ${formatPercent(s.return90dPct)}` })}
          ${stat({ label: "Win rate", value: s.winRatePct === null ? "—" : `${s.winRatePct.toFixed(1)}%`, sub: `${s.winningSignals} won · ${s.losingSignals} lost` })}
          ${stat({ label: "Signals", value: s.totalSignals.toLocaleString(), sub: `${s.openSignals} open · ${s.closedSignals} closed` })}
          ${stat({ label: "Followers", value: s.activeFollowers.toLocaleString(), sub: `Copiers' realised P&L ${formatUsd(s.realizedPnl, { sign: true })}` })}
        </div>
        <div class="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          ${card({ title: "Performance", description: "Compounded result of closed signals (start = 100)", body: html`<div class="card-body"><div class="h-[280px]" data-chart>${t.performanceSeries.length > 1 ? skeleton("h-full w-full") : html`<p class="py-16 text-center text-sm text-dim">Performance appears here once this trader's signals start closing.</p>`}</div></div>` })}
          ${card({
            title: "Risk information",
            body: html`<div class="card-body space-y-3 text-sm">${[
              ["Risk level", riskBadge(t.riskLevel)],
              ["Average result per signal", formatPercent(s.avgResultPct)],
              ["Minimum copy amount", `${Number(t.minAllocation).toLocaleString()} USDT`],
              ["Maximum copy amount", t.maxAllocation ? `${Number(t.maxAllocation).toLocaleString()} USDT` : "No limit"],
              ["Instruments", t.assets.join(", ") || "—"],
            ].map(([k, v]) => html`<div class="flex items-center justify-between gap-3 border-b border-line/60 pb-2.5 last:border-0"><span class="text-dim">${k}</span><span class="text-right font-medium text-fg">${v}</span></div>`)}<p class="pt-2 text-xs leading-relaxed text-dim">${RISK_NOTE}</p></div>`,
          })}
        </div>
        ${t.pendingSignals.length ? card({ title: "Signals awaiting entry", description: "Visible to followers. Copied automatically when the entry price is reached.", body: html`<div data-pending></div>` }) : ""}
        ${card({ title: "Open positions", description: "Signals currently in the market, valued at the live price", body: html`<div data-open></div>` })}
        ${card({ title: "Trading history", description: "Closed signals, most recent first", body: html`<div data-history></div>` })}
        ${t.following ? "" : notice("info", { iconName: "info", body: "Take-profit and stop-loss levels are visible to this trader's followers." })}
      </div>`,
    );

    if (t.performanceSeries.length > 1) valueChart($("[data-chart]", el), t.performanceSeries, { format: (v) => v.toFixed(2) }).catch(() => {});
    const levels = t.following
      ? [
          { key: "tp", header: "Take profit", align: "right", hideOnMobile: true, cell: (x) => priceCell(x.takeProfit) },
          { key: "sl", header: "Stop loss", align: "right", hideOnMobile: true, cell: (x) => priceCell(x.stopLoss) },
        ]
      : [];
    const mkt = { key: "m", header: "Market", cell: (x) => html`<span class="font-semibold text-white">${pair(x.market)}</span>` };
    const side = { key: "s", header: "Direction", cell: (x) => sideLabel(x.side) };

    if (t.pendingSignals.length) {
      new DataTable($("[data-pending]", el), {
        columns: [mkt, side, { key: "e", header: "Entry", align: "right", cell: (x) => (x.entryPrice ? priceCell(x.entryPrice) : html`<span class="text-muted">Market</span>`) }, ...levels, { key: "c", header: "Issued", align: "right", hideOnMobile: true, cell: (x) => html`<span class="text-muted">${formatDate(x.createdAt)}</span>` }],
      }).set(t.pendingSignals);
    }
    new DataTable($("[data-open]", el), {
      empty: emptyState({ title: "No open positions", iconName: "radio" }),
      columns: [
        mkt,
        side,
        { key: "e", header: "Entry", align: "right", cell: (x) => priceCell(x.entryPrice) },
        { key: "p", header: "Current", align: "right", cell: (x) => priceCell(x.currentPrice) },
        { key: "r", header: "Result", align: "right", cell: (x) => pctCell(x.resultPct) },
        ...levels,
        { key: "o", header: "Opened", align: "right", hideOnMobile: true, cell: (x) => html`<span class="text-muted">${formatDate(x.openedAt)}</span>` },
      ],
    }).set(t.openPositions);
    new DataTable($("[data-history]", el), {
      empty: emptyState({ title: "No closed signals yet", iconName: "history" }),
      columns: [
        { key: "t", header: "Closed", cell: (x) => html`<span class="text-muted">${formatDate(x.closedAt)}</span>` },
        mkt,
        side,
        { key: "e", header: "Entry", align: "right", hideOnMobile: true, cell: (x) => priceCell(x.entryPrice) },
        { key: "x", header: "Exit", align: "right", hideOnMobile: true, cell: (x) => priceCell(x.exitPrice) },
        { key: "why", header: "Closed by", hideOnMobile: true, cell: (x) => html`<span class="text-xs text-muted">${closeReason(x.closeReason)}</span>` },
        { key: "r", header: "Result", align: "right", cell: (x) => pctCell(x.resultPct) },
      ],
    }).set(t.history);
  };

  const refresh = async () => {
    invalidate("/api/copy-trading");
    t = await load();
    render();
  };
  render();

  on(el, "click", "[data-copy-trader]", () => openCopyModal(t, { onDone: refresh }));
  on(el, "click", "[data-stop]", async (_e, b) => {
    const ok = await confirmDialog({
      title: `Stop copying ${t.displayName}?`,
      message: "Any open copy positions from this trader will be closed at the current market price, and no new signals will be copied.",
      confirmLabel: "Stop copying",
      danger: true,
    });
    if (!ok) return;
    b.disabled = true;
    try {
      await api(`/api/copy-trading/subscriptions/${t.following.id}`, { method: "DELETE" });
      toast.success(`Stopped copying ${t.displayName}`);
      await refresh();
    } catch (err) {
      b.disabled = false;
      toast.error("Could not stop copying", err.message);
    }
  });
}
