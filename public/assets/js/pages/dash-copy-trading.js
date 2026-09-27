import { html, $, on, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { card, emptyState, errorState, pageHeader, stat, smallSim, skeleton, tabs, pagination, toast, openModal, confirmDialog, DataTable } from "../core/ui.js";
import { field, bindForm, rules } from "../core/forms.js";
import { formatDate, formatNumber, formatUsd, toNum } from "../core/format.js";
import { mountTraderDirectory } from "../components/trader-directory.js";
import { traderAvatar, copyStatusBadge, sideLabel, pair, pnlCell, pctCell, priceCell, tone } from "../components/copy-bits.js";

await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

mount(
  view,
  html`${pageHeader({ title: "Copy Trading", description: "Follow lead traders: their signals open trades in your account automatically." })}
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4" data-stats>${Array.from({ length: 4 }, () => skeleton("h-28 rounded-2xl"))}</div>
    <h2 class="mt-8 mb-4 font-display text-lg font-bold text-white">My copy trading</h2>
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-subs>${skeleton("h-56 rounded-2xl")}</div>
    ${card({ title: "Copy trade history", description: "Every position opened from a lead trader's signal", cls: "mt-8", action: html`<div data-tabs></div>`, body: html`<div class="border-t border-line" data-trades></div><div class="border-t border-line px-4 py-3" data-pages></div>` })}
    <h2 class="mt-8 mb-4 font-display text-lg font-bold text-white">Discover lead traders</h2>
    <div data-directory></div>`,
);

let subs = [];
const refresh = () => ["/api/copy-trading", "/api/wallets", "/api/portfolio", "/api/transactions"].forEach(invalidate);

/* ───────── Relationships ───────── */

const subCard = (s) => {
  const t = s.trader;
  const live = s.status !== "STOPPED";
  const row = (k, v) => html`<div class="flex items-center justify-between gap-3"><dt class="text-dim">${k}</dt><dd class="num text-right text-fg">${v}</dd></div>`;
  return html`<section class="card flex flex-col p-5 ${live ? "" : "opacity-70"}">
    <div class="flex items-start justify-between gap-3">
      <a href="/dashboard/copy-trading/${t.slug}" class="flex min-w-0 items-center gap-3">${traderAvatar(t, 40)}<span class="min-w-0"><span class="block truncate font-display font-bold text-white">${t.displayName}</span><span class="block truncate text-xs text-dim">${t.strategy}</span></span></a>
      ${copyStatusBadge(s.status)}
    </div>
    <dl class="mt-4 space-y-2 text-sm">
      ${row("Active trades", s.openTrades)}
      ${row("P&L", html`<span class="font-semibold ${tone(s.totalPnl ?? s.realizedPnl)}">${formatUsd(s.totalPnl ?? s.realizedPnl, { sign: true })}</span>`)}
      ${row("In use", `${formatNumber(s.inUse, 2)} / ${formatNumber(s.allocation, 2)} USDT`)}
      ${row("Per trade", `${formatNumber(s.amountPerTrade, 2)} USDT`)}
      ${row("Stop-copy", `−${Number(s.stopLossPct)}%`)}
    </dl>
    ${toNum(s.escrowed) > 0 ? html`<p class="mt-3 text-xs text-dim">${formatNumber(s.escrowed, 2)} USDT from your earlier allocation is returned to your wallet when you stop copying.</p>` : ""}
    <div class="mt-auto flex flex-wrap gap-2 pt-5">
      <a class="btn btn-secondary btn-sm" href="/dashboard/copy-trading/${t.slug}">View details</a>
      ${live
        ? html`${s.status === "ACTIVE" ? html`<button type="button" class="btn btn-ghost btn-sm" data-status="PAUSED" data-id="${s.id}">${icon("pause", "h-4 w-4")} Pause</button>` : ""}
            ${s.status === "PAUSED" ? html`<button type="button" class="btn btn-ghost btn-sm" data-status="ACTIVE" data-id="${s.id}">${icon("play", "h-4 w-4")} Resume</button>` : ""}
            ${s.status !== "SUSPENDED" ? html`<button type="button" class="btn btn-ghost btn-sm" data-edit="${s.id}">${icon("sliders-horizontal", "h-4 w-4")} Settings</button>` : ""}
            <button type="button" class="btn btn-ghost btn-sm text-down" data-stop="${s.id}">${icon("square", "h-4 w-4")} Stop copying</button>`
        : html`<span class="self-center text-xs text-dim">Stopped ${formatDate(s.stoppedAt, "date")}</span>`}
    </div>
  </section>`;
};

watch("/api/copy-trading/subscriptions", ({ data, error }) => {
  if (!data) return error && mount($("[data-subs]", view), html`<div class="md:col-span-2 xl:col-span-3">${errorState({ message: error.message, retry: false })}</div>`);
  subs = data;
  const live = data.filter((s) => s.status !== "STOPPED");
  const realized = data.reduce((a, s) => a + toNum(s.realizedPnl), 0);
  const open = live.some((s) => s.unrealizedPnl === null) ? null : live.reduce((a, s) => a + toNum(s.unrealizedPnl), 0);
  mount(
    $("[data-stats]", view),
    html`${stat({ label: "Traders copied", value: live.length, iconName: "users" })}
      ${stat({ label: "Open copy trades", value: live.reduce((a, s) => a + s.openTrades, 0), iconName: "radio" })}
      ${stat({ label: "Realised P&L", value: html`<span class="${tone(realized)}">${formatUsd(realized, { sign: true })}</span>`, iconName: "wallet" })}
      ${stat({ label: "Open P&L", value: html`<span class="${tone(open)}">${formatUsd(open, { sign: true })}</span>`, sub: "At live prices, before closing fees", iconName: "activity" })}`,
  );
  const shown = [...live, ...data.filter((s) => s.status === "STOPPED").slice(0, 3)];
  mount(
    $("[data-subs]", view),
    shown.length
      ? shown.map(subCard)
      : html`<div class="card md:col-span-2 xl:col-span-3">${emptyState({ title: "You're not copying anyone yet", description: "Browse the lead traders below and review their strategy, history and risk before copying.", iconName: "users" })}</div>`,
  );
});

const find = (id) => subs.find((s) => s.id === id);

on(view, "click", "[data-status][data-id]", async (_e, b) => {
  b.disabled = true;
  try {
    await api(`/api/copy-trading/subscriptions/${b.dataset.id}`, { method: "PATCH", body: { status: b.dataset.status } });
    toast.success(b.dataset.status === "PAUSED" ? "Copying paused" : "Copying resumed", b.dataset.status === "PAUSED" ? "New signals won't be copied. Open positions stay open." : undefined);
    refresh();
  } catch (err) {
    b.disabled = false;
    toast.error("Could not update", err.message);
  }
});

on(view, "click", "[data-edit]", (_e, b) => {
  const s = find(b.dataset.edit);
  if (!s) return;
  const m = openModal({
    title: "Copy settings",
    description: s.trader.displayName,
    body: html`<form id="copy-edit" class="space-y-4" novalidate>
      ${field({ name: "allocation", label: "Copy amount", inputmode: "decimal", suffix: "USDT", value: String(toNum(s.allocation)), hint: "The most this trader's copied positions may use at one time." })}
      ${field({ name: "amountPerTrade", label: "Amount per trade", inputmode: "decimal", suffix: "USDT", value: String(toNum(s.amountPerTrade)) })}
      ${field({ name: "stopLossPct", label: "Stop-copy threshold", type: "number", suffix: "%", value: String(Number(s.stopLossPct)), hint: "Between 5% and 90% of your copy amount", attrs: html`min="5" max="90"` })}
      <div data-form-error hidden></div>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="copy-edit" class="btn btn-primary">Save</button>`,
  });
  bindForm(
    $("#copy-edit", m.el),
    {
      allocation: [rules.decimal("Copy amount")],
      amountPerTrade: [rules.decimal("Amount per trade"), (v, all) => (toNum(v) > toNum(all.allocation) ? "Must not be more than the copy amount" : null)],
      stopLossPct: [(v) => (Number(v) >= 5 && Number(v) <= 90 ? null : "Enter a value between 5 and 90")],
    },
    async (v) => {
      await api(`/api/copy-trading/subscriptions/${s.id}`, { method: "PATCH", body: { allocation: v.allocation, amountPerTrade: v.amountPerTrade, stopLossPct: Number(v.stopLossPct) } });
      toast.success("Settings updated");
      m.close();
      refresh();
    },
  );
});

on(view, "click", "[data-stop]", async (_e, b) => {
  const s = find(b.dataset.stop);
  if (!s) return;
  const ok = await confirmDialog({
    title: `Stop copying ${s.trader.displayName}?`,
    message: `${s.openTrades ? `Your ${s.openTrades} open copy position${s.openTrades === 1 ? "" : "s"} will be closed at the current market price. ` : ""}No new signals will be copied.`,
    confirmLabel: "Stop copying",
    danger: true,
  });
  if (!ok) return;
  b.disabled = true;
  try {
    await api(`/api/copy-trading/subscriptions/${s.id}`, { method: "DELETE" });
    toast.success(`Stopped copying ${s.trader.displayName}`);
    refresh();
  } catch (err) {
    b.disabled = false;
    toast.error("Could not stop copying", err.message);
  }
});

/* ───────── Copy trade history ───────── */

const TABS = [
  { value: "", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "CLOSED", label: "Closed" },
  { value: "FAILED", label: "Not opened" },
];
const hist = { status: "", page: 1 };
const drawTabs = () => mount($("[data-tabs]", view), tabs(TABS, hist.status, { size: "sm", name: "hist" }));

const history = new DataTable($("[data-trades]", view), {
  empty: emptyState({ title: "No copy trades yet", description: "Trades appear here when a trader you copy issues a signal.", iconName: "history" }),
  columns: [
    { key: "m", header: "Market", cell: (x) => html`<span class="flex items-center gap-1.5"><span class="font-semibold text-white">${pair(x.market.symbol)}</span>${x.isDemo ? smallSim() : ""}</span><span class="block text-xs text-dim">${x.trader.displayName}</span>` },
    { key: "s", header: "Side", cell: (x) => sideLabel(x.side) },
    { key: "e", header: "Entry", align: "right", cell: (x) => priceCell(x.entryPrice, x.market.pricePrecision) },
    { key: "x", header: "Exit", align: "right", hideOnMobile: true, cell: (x) => (x.status === "OPEN" ? html`<span class="text-dim">${x.currentPrice ? html`now ${priceCell(x.currentPrice, x.market.pricePrecision)}` : "—"}</span>` : priceCell(x.exitPrice, x.market.pricePrecision)) },
    { key: "z", header: "Size", align: "right", hideOnMobile: true, cell: (x) => html`<span class="num">${x.entryValue ? formatUsd(x.entryValue) : formatUsd(x.notional)}</span>` },
    {
      key: "p",
      header: "P&L",
      align: "right",
      cell: (x) =>
        x.status === "OPEN" ? html`${pnlCell(x.unrealizedPnl)}<span class="block text-[11px]">${pctCell(x.unrealizedPct)}</span>` : x.status === "CLOSED" ? pnlCell(x.netPnl) : html`<span class="text-dim">—</span>`,
    },
    {
      key: "st",
      header: "Status",
      cell: (x) => html`${copyTradeStatus(x)}${x.failReason && x.status !== "CLOSED" ? html`<span class="mt-0.5 block max-w-[16rem] text-[11px] leading-snug text-dim">${x.failReason}</span>` : ""}`,
    },
    { key: "d", header: "Date", align: "right", hideOnMobile: true, cell: (x) => html`<span class="text-xs text-muted">${formatDate(x.closedAt ?? x.openedAt ?? x.createdAt)}</span>` },
  ],
});

function copyTradeStatus(x) {
  const label = { PENDING: "Opening", OPEN: "Open", CLOSED: "Closed", FAILED: "Not opened", CANCELLED: "Cancelled" }[x.status];
  const cls = { OPEN: "badge-accent", CLOSED: "badge-neutral", FAILED: "badge-down", PENDING: "badge-warn", CANCELLED: "badge-neutral" }[x.status];
  return html`<span class="badge badge-dot ${cls}">${label}</span>`;
}

let unsub = null;
const loadHistory = () => {
  unsub?.();
  history.set(undefined, { loading: true });
  const qs = new URLSearchParams({ page: String(hist.page), pageSize: "15", ...(hist.status ? { status: hist.status } : {}) });
  unsub = watch(`/api/copy-trading/trades?${qs}`, ({ data, error }) => {
    if (!data) return error && history.set(undefined, { error });
    history.set(data.items);
    mount($("[data-pages]", view), pagination(hist.page, data.pageCount, data.total));
  });
};
drawTabs();
loadHistory();
on(view, "click", "[data-hist]", (_e, b) => {
  hist.status = b.dataset.hist;
  hist.page = 1;
  drawTabs();
  loadHistory();
});
on(view, "click", "[data-pages] [data-page]", (_e, b) => {
  hist.page = Number(b.dataset.page);
  loadHistory();
});

mountTraderDirectory($("[data-directory]", view), { profileBase: "/dashboard/copy-trading" });
