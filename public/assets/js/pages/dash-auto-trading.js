import { html, $, on, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { card, emptyState, errorState, notice, pageHeader, stat, smallSim, skeleton, tabs, pagination, toast, confirmDialog, DataTable, badge } from "../core/ui.js";
import { formatDate, formatNumber, formatPercent, formatPrice, formatUsd, toNum } from "../core/format.js";
import { pair, pnlCell, pctCell, priceCell, sideLabel, tone } from "../components/copy-bits.js";

await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

mount(
  view,
  html`${pageHeader({ title: "Automated Trading", description: "An SMC / ICT strategy bot that opens and closes positions in your account under fixed risk rules." })}
    <div data-top>${skeleton("h-48 rounded-2xl")}</div>
    <div class="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-stats></div>
    ${card({ title: "Your automated trades", description: "Only trades in your own account", cls: "mt-6", action: html`<div data-tabs></div>`, body: html`<div class="border-t border-line" data-trades></div><div class="border-t border-line px-4 py-3" data-pages></div>` })}
    <p class="mt-6 text-xs leading-relaxed text-dim">Automated trading is not guaranteed-profit software. Smart Money Concepts and ICT are trading methodologies, and every trade can lose. Results shown are calculated from the bot's executed positions in your account, including fees. Past results do not predict future returns.</p>`,
);

const STATUS = { RUNNING: ["Active", "text-up"], PAUSED: ["Paused", "text-warn"], STOPPED: ["Stopped", "text-down"] };
let info = null;

watch("/api/auto-trading", ({ data, error }) => {
  if (!data) return error && mount($("[data-top]", view), errorState({ message: error.message, retry: false }));
  info = data;
  const p = data.participant;
  const joined = p && p.status !== "STOPPED";
  if (!data.available && !joined) {
    mount($("[data-top]", view), card({ body: emptyState({ title: "Automated trading isn't available right now", description: "HarborFinance has not opened the automated trading bot to users.", iconName: "cpu" }) }));
    return;
  }
  const [botLabel, botCls] = STATUS[data.botStatus];
  const userControl = data.mode === "USER_OPT_IN";
  const actions = !joined
    ? userControl
      ? html`<button type="button" class="btn btn-primary btn-lg" data-join>${icon("play", "h-4 w-4")} Start automated trading</button>`
      : html`<p class="text-sm text-muted">Automated trading is enabled by HarborFinance for eligible accounts. Contact support to request access.</p>`
    : html`<div class="flex flex-wrap gap-2">
        <a href="#trades" class="btn btn-secondary">${icon("list", "h-4 w-4")} View trades</a>
        ${userControl && p.status === "ACTIVE" ? html`<button type="button" class="btn btn-secondary" data-act="pause">${icon("pause", "h-4 w-4")} Pause bot</button>` : ""}
        ${userControl && p.status === "PAUSED" ? html`<button type="button" class="btn btn-primary" data-act="resume">${icon("play", "h-4 w-4")} Resume</button>` : ""}
        <button type="button" class="btn btn-ghost text-down" data-leave>${icon("square", "h-4 w-4")} Leave</button>
      </div>`;
  mount(
    $("[data-top]", view),
    html`<section class="card p-5 sm:p-6">
      <div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p class="text-[11px] font-bold tracking-[0.14em] text-dim uppercase">Automated trading</p>
          <p class="mt-1 font-display text-2xl font-extrabold ${joined ? (p.status === "ACTIVE" && data.botStatus === "RUNNING" ? "text-up" : "text-warn") : "text-muted"}">${joined ? (p.status === "PAUSED" ? "Paused for your account" : data.botStatus === "RUNNING" ? "Active" : `Bot ${botLabel.toLowerCase()} by HarborFinance`) : "Not started"}</p>
          ${p?.statusReason ? html`<p class="mt-1 text-sm text-warn">${p.statusReason}</p>` : ""}
          <dl class="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <div><dt class="text-dim">Strategy</dt><dd class="text-fg">${data.strategy}</dd></div>
            <div><dt class="text-dim">Risk</dt><dd class="text-fg">${data.riskPerTradePct}% per trade</dd></div>
            <div><dt class="text-dim">Bot</dt><dd class="${botCls}">${botLabel}</dd></div>
            <div><dt class="text-dim">Timeframes</dt><dd class="text-fg">${data.timeframes.bias.join(" + ")} → ${data.timeframes.setup} → ${data.timeframes.entry}</dd></div>
            <div><dt class="text-dim">Instruments</dt><dd class="text-fg">${data.instruments.map(pair).join(", ") || "—"}</dd></div>
            <div><dt class="text-dim">Limits</dt><dd class="text-fg">${data.maxOpenTrades} open trades · ${data.maxDailyLossPct}% daily loss</dd></div>
          </dl>
          <p class="mt-3 text-xs text-dim">Trades only in ${data.sessions.join(" · ") || "configured sessions"}. Each trade has a stop loss and a take profit with at least 1:${data.minRiskReward} risk/reward.</p>
        </div>
        <div class="shrink-0">${actions}</div>
      </div>
      ${!joined && userControl ? notice("info", { iconName: "info", cls: "mt-5", body: html`When you start, the bot can open positions in your account using your USDT balance. Each trade risks about ${data.riskPerTradePct}% of your account value between entry and stop loss. You can pause or leave at any time. Minimum account value: ${formatNumber(data.minEquity, 2)} USDT.` }) : ""}
    </section>`,
  );

  const perf = data.performance;
  mount(
    $("[data-stats]", view),
    perf
      ? html`${stat({ label: "Open trades", value: perf.openTrades, iconName: "radio" })}
          ${stat({ label: "Today's P&L", value: html`<span class="${tone(perf.today.pnl)}">${formatUsd(perf.today.pnl, { sign: true })}</span>`, iconName: "activity" })}
          ${stat({ label: "Realised P&L", value: html`<span class="${tone(perf.realizedPnl)}">${formatUsd(perf.realizedPnl, { sign: true })}</span>`, sub: `Open ${formatUsd(perf.unrealizedPnl, { sign: true })}`, iconName: "wallet" })}
          ${stat({ label: "Return", value: html`<span class="${tone(perf.returnPct)}">${formatPercent(perf.returnPct)}</span>`, sub: `${perf.wins} won · ${perf.losses} lost · fees ${formatUsd(perf.fees)}`, iconName: "target" })}`
      : "",
  );
});

on(view, "click", "[data-join]", async (_e, b) => {
  const ok = await confirmDialog({
    title: "Start automated trading?",
    message: `The bot will open and close positions in your account automatically, risking about ${info.riskPerTradePct}% of your account value per trade. Trading can lose money and results are not guaranteed.`,
    confirmLabel: "Start",
  });
  if (!ok) return;
  b.disabled = true;
  try {
    await api("/api/auto-trading", { method: "POST" });
    toast.success("Automated trading started", "New setups can now be traded in your account.");
  } catch (err) {
    b.disabled = false;
    toast.error("Could not start", err.message);
  }
  invalidate("/api/auto-trading");
});

on(view, "click", "[data-act]", async (_e, b) => {
  b.disabled = true;
  try {
    await api("/api/auto-trading", { method: "PATCH", body: { action: b.dataset.act } });
    toast.success(b.dataset.act === "pause" ? "Bot paused for your account" : "Bot resumed", b.dataset.act === "pause" ? "No new trades. Open positions keep their stop loss and take profit." : undefined);
  } catch (err) {
    b.disabled = false;
    toast.error("Could not update", err.message);
  }
  invalidate("/api/auto-trading");
});

on(view, "click", "[data-leave]", async (_e, b) => {
  const open = info?.performance?.openTrades ?? 0;
  const ok = await confirmDialog({
    title: "Leave automated trading?",
    message: `${open ? `Your ${open} open automated position${open === 1 ? " is" : "s are"} closed at the current market price. ` : ""}The bot will no longer trade in your account.`,
    confirmLabel: "Leave",
    danger: true,
  });
  if (!ok) return;
  b.disabled = true;
  try {
    await api("/api/auto-trading", { method: "DELETE" });
    toast.success("You left automated trading");
  } catch (err) {
    b.disabled = false;
    toast.error("Could not leave", err.message);
  }
  invalidate("/api/auto-trading");
});

/* ───────── Trades ───────── */

const TABS = [
  { value: "", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "CLOSED", label: "Closed" },
  { value: "REJECTED", label: "Skipped" },
];
const st = { status: "", page: 1 };
$("[data-trades]", view).id = "trades";
const drawTabs = () => mount($("[data-tabs]", view), tabs(TABS, st.status, { size: "sm", name: "tt" }));
const REASON = { TAKE_PROFIT: "Take profit", STOP_LOSS: "Stop loss", MANUAL: "Closed by HarborFinance", PARTICIPANT_LEFT: "You left" };
const statusCell = (x) => {
  const [label, tone2] = { OPEN: ["Open", "accent"], CLOSED: ["Closed", "neutral"], FAILED: ["Not opened", "down"], REJECTED: ["Skipped", "warn"], PENDING: ["Opening", "warn"] }[x.status];
  return html`${badge(label, tone2)}${x.closeReason ? html`<span class="mt-0.5 block text-[11px] text-dim">${REASON[x.closeReason]}</span>` : ""}${x.failReason ? html`<span class="mt-0.5 block max-w-[16rem] text-[11px] leading-snug text-dim">${x.failReason}</span>` : ""}`;
};

const table = new DataTable($("[data-trades]", view), {
  empty: emptyState({ title: "No automated trades yet", description: "Trades appear here when the bot executes a setup in your account.", iconName: "history" }),
  columns: [
    { key: "m", header: "Market", cell: (x) => html`<span class="flex items-center gap-1.5"><span class="font-semibold text-white">${pair(x.market.symbol)}</span>${x.isDemo ? smallSim() : ""}</span><span class="block text-[11px] text-dim">SMC / ICT · ${x.signal.timeframes.setup}</span>` },
    { key: "s", header: "Side", cell: (x) => sideLabel(x.side) },
    { key: "e", header: "Entry", align: "right", cell: (x) => priceCell(x.entryPrice, x.market.pricePrecision) },
    { key: "l", header: "SL / TP", align: "right", hideOnMobile: true, cell: (x) => html`<span class="num text-xs text-down">${formatPrice(x.stopLoss, x.market.pricePrecision)}</span><span class="num block text-xs text-up">${formatPrice(x.takeProfit, x.market.pricePrecision)}</span>` },
    { key: "x", header: "Exit", align: "right", hideOnMobile: true, cell: (x) => (x.status === "OPEN" ? html`<span class="text-[11px] text-dim">now</span> ${priceCell(x.currentPrice, x.market.pricePrecision)}` : priceCell(x.exitPrice, x.market.pricePrecision)) },
    { key: "z", header: "Size", align: "right", hideOnMobile: true, cell: (x) => html`<span class="num">${toNum(x.entryValue ?? x.notional) ? formatUsd(x.entryValue ?? x.notional) : "—"}</span><span class="block text-[11px] text-dim">risk ${formatUsd(x.riskAmount)}</span>` },
    { key: "p", header: "P&L", align: "right", cell: (x) => (x.status === "OPEN" ? html`${pnlCell(x.unrealizedPnl)}<span class="block text-[11px]">${pctCell(x.unrealizedPct)}</span>` : x.status === "CLOSED" ? pnlCell(x.netPnl) : html`<span class="text-dim">—</span>`) },
    { key: "st", header: "Status", cell: statusCell },
    { key: "d", header: "Time", align: "right", hideOnMobile: true, cell: (x) => html`<span class="text-xs text-muted">${formatDate(x.closedAt ?? x.openedAt ?? x.createdAt)}</span>` },
  ],
});

let unsub = null;
const load = () => {
  unsub?.();
  table.set(undefined, { loading: true });
  const qs = new URLSearchParams({ page: String(st.page), pageSize: "15", ...(st.status ? { status: st.status } : {}) });
  unsub = watch(`/api/auto-trading/trades?${qs}`, ({ data, error }) => {
    if (!data) return error && table.set(undefined, { error });
    table.set(data.items);
    mount($("[data-pages]", view), pagination(st.page, data.pageCount, data.total));
  });
};
drawTabs();
load();
on(view, "click", "[data-tt]", (_e, b) => {
  st.status = b.dataset.tt;
  st.page = 1;
  drawTabs();
  load();
});
on(view, "click", "[data-pages] [data-page]", (_e, b) => {
  st.page = Number(b.dataset.page);
  load();
});
