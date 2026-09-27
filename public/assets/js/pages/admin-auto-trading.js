// Admin → Automated Trading: SMC/ICT bot controls, market analysis, signal log,
// trades, participants and settings. Performance is calculated server-side from
// executed positions only.
import { html, raw, $, $$, on, mount, param } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { card, pageHeader, stat, notice, toast, openModal, confirmDialog, tabs, skeleton, emptyState, errorState, badge, statusBadge, smallSim } from "../core/ui.js";
import { formatDate, formatNumber, formatPercent, formatPrice, formatUsd, timeAgo, toNum } from "../core/format.js";
import { valueChart } from "../core/charts.js";
import { adminPage, adminTable, actionModal } from "../components/admin-kit.js";
import { pair, pnlCell, priceCell, sideLabel, tone } from "../components/copy-bits.js";

const { view } = await adminPage();

const TABS = [
  { value: "dashboard", label: "Dashboard" },
  { value: "analysis", label: "Market Analysis" },
  { value: "signals", label: "Signal Log" },
  { value: "trades", label: "Trades" },
  { value: "participants", label: "Participants" },
  { value: "settings", label: "Settings" },
];
let tab = TABS.some((t) => t.value === param("tab")) ? param("tab") : "dashboard";
let state = null; // GET /api/admin/auto-trading

mount(
  view,
  html`${pageHeader({ title: "Automated Trading", description: "SMC / ICT strategy bot. Trades go through the platform's order system; results are calculated from actual fills." })}
    <div data-statusbar></div>
    <div class="mb-5 overflow-x-auto" data-tabs></div>
    <div data-panel></div>`,
);

const refresh = () => invalidate("/api/admin/auto-trading");
const STATUS = { RUNNING: ["ACTIVE", "text-up"], PAUSED: ["PAUSED", "text-warn"], STOPPED: ["STOPPED", "text-down"] };

/* ───────────── Status bar (always visible) ───────────── */

watch(
  "/api/admin/auto-trading",
  ({ data, error }) => {
    if (!data) return error && mount($("[data-statusbar]", view), errorState({ message: error.message, retry: false }));
    state = data;
    const [label, cls] = STATUS[data.status];
    const h = data.health ?? {};
    mount(
      $("[data-statusbar]", view),
      html`<section class="card mb-5 p-5">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p class="text-[11px] font-bold tracking-[0.14em] text-dim uppercase">Bot status</p>
            <p class="mt-1 flex items-center gap-2 font-display text-2xl font-extrabold ${cls}"><span class="relative flex h-3 w-3">${data.status === "RUNNING" ? html`<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-50"></span>` : ""}<span class="relative inline-flex h-3 w-3 rounded-full bg-current"></span></span>${label}</p>
            <p class="mt-1 text-xs text-muted">${data.statusReason ? html`${data.statusReason} · ` : ""}${data.statusChangedAt ? `Changed ${timeAgo(data.statusChangedAt)} by ${data.statusChangedBy}` : "Never started"}</p>
            <p class="mt-1 text-xs text-dim">Strategy SMC / ICT · ${data.settings.timeframes.bias.join(" + ")} → ${data.settings.timeframes.setup} → ${data.settings.timeframes.entry} · Risk ${data.settings.risk.riskPerTradePct}% per trade · Last scan ${h.lastCycleAt ? timeAgo(h.lastCycleAt) : "—"}${h.dataOk === false ? html` · <span class="text-down">market data unavailable</span>` : ""}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            ${data.status === "STOPPED" ? html`<button type="button" class="btn btn-primary" data-bot="start">${icon("play", "h-4 w-4")} Start bot</button>` : ""}
            ${data.status === "RUNNING" ? html`<button type="button" class="btn btn-secondary" data-bot="pause">${icon("pause", "h-4 w-4")} Pause</button>` : ""}
            ${data.status === "PAUSED" ? html`<button type="button" class="btn btn-primary" data-bot="resume">${icon("play", "h-4 w-4")} Resume</button>` : ""}
            ${data.status !== "STOPPED" ? html`<button type="button" class="btn btn-danger" data-bot="stop">${icon("octagon-x", "h-4 w-4")} STOP BOT</button>` : ""}
            <button type="button" class="btn btn-ghost text-down" data-close-all>${icon("x-circle", "h-4 w-4")} Close all positions</button>
          </div>
        </div>
        ${data.venue.simulated ? notice("warn", { cls: "mt-4", body: html`Orders are filled by the <strong>${data.venue.name}</strong> at live market prices: no external exchange is connected, so bot trades are labelled <em>Simulated</em>.` }) : ""}
        ${h.note ? notice("warn", { cls: "mt-3", body: h.note }) : ""}
      </section>`,
    );
  },
  { refresh: 15000 },
);

on(view, "click", "[data-bot]", async (_e, b) => {
  const action = b.dataset.bot;
  const copy = {
    start: ["Start the bot?", "The bot analyses the enabled instruments and opens positions for active participants when a setup passes every condition and risk check.", "Start bot", "primary", undefined],
    resume: ["Resume trading?", "New setups can be executed again.", "Resume", "primary", undefined],
    pause: ["Pause trading?", "No new positions are opened. Open positions keep their stop loss and take profit.", "Pause", "primary", "optional"],
    stop: ["Emergency stop?", "No new automated trades. Existing positions stay open and visible, still protected by their stop loss and take profit. You decide whether to close them.", "STOP BOT", "danger", "optional"],
  }[action];
  await actionModal({
    title: copy[0],
    description: copy[1],
    confirmLabel: copy[2],
    tone: copy[3],
    reason: copy[4],
    onConfirm: async ({ reason }) => {
      await api("/api/admin/auto-trading", { method: "PATCH", body: { action, ...(reason ? { reason } : {}) } });
      toast.success({ start: "Bot started", resume: "Trading resumed", pause: "Trading paused", stop: "Bot stopped" }[action]);
      refresh();
    },
  });
});

on(view, "click", "[data-close-all]", async () => {
  const n = state?.performance.openTrades ?? 0;
  if (!n) return toast.info("No open bot positions");
  const ok = await confirmDialog({ title: `Close all ${n} bot positions?`, message: "Every open automated position is closed at the current market price. P&L is booked from the actual fills.", confirmLabel: "Close all", danger: true });
  if (!ok) return;
  try {
    const r = await api("/api/admin/auto-trading/trades/close-all", { method: "POST" });
    r.failed ? toast.error(`${r.closed} closed, ${r.failed} could not be closed`, r.firstError) : toast.success(`${r.closed} position${r.closed === 1 ? "" : "s"} closed`);
  } catch (err) {
    toast.error("Could not close positions", err.message);
  }
  refresh();
});

/* ───────────── Tabs ───────────── */

function show(next) {
  tab = next;
  history.replaceState(null, "", `${location.pathname}?tab=${tab}`);
  mount($("[data-tabs]", view), tabs(TABS, tab, { name: "tab" }));
  const host = $("[data-panel]", view);
  const panel = document.createElement("div");
  host.replaceChildren(panel);
  mount(panel, skeleton("h-96 rounded-2xl"));
  ({ dashboard, analysis, signals, trades, participants, settings })[tab](panel);
}
on(view, "click", "[data-tab]", (_e, b) => show(b.dataset.tab));

/* ───────────── Dashboard ───────────── */

function dashboard(panel) {
  mount(
    panel,
    html`<div class="grid grid-cols-2 gap-3 lg:grid-cols-4" data-kpis>${Array.from({ length: 8 }, () => skeleton("h-28 rounded-2xl"))}</div>
      <h2 class="mt-8 mb-3 font-display text-lg font-bold text-white">All-time performance</h2>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4" data-perf></div>
      ${card({ title: "Cumulative realised P&L", description: "Net of fees, from closed bot positions", cls: "mt-6", body: html`<div class="card-body"><div class="h-[260px]" data-chart></div></div>` })}
      <div class="mt-6" data-instr-note></div>`,
  );
  let drawn = false;
  watch("/api/admin/auto-trading", ({ data }) => {
    if (!data) return;
    const p = data.performance;
    const t = p.today;
    mount(
      $("[data-kpis]", panel),
      html`${stat({ label: "Supported pairs", value: data.enabledCount, sub: `${data.instruments.tradable.length} tradable on the platform`, iconName: "list-checks" })}
        ${stat({ label: "Active positions", value: p.openTrades, sub: `Exposure ${formatUsd(p.exposure)}`, iconName: "radio" })}
        ${stat({ label: "Today's trades", value: t.opened, sub: `${data.signalsToday.EXECUTED ?? 0} signals executed · ${data.signalsToday.REJECTED ?? 0} rejected`, iconName: "activity" })}
        ${stat({ label: "Winning / losing today", value: html`<span class="text-up">${t.wins}</span> <span class="text-dim">/</span> <span class="text-down">${t.losses}</span>`, iconName: "target" })}
        ${stat({ label: "Today's P&L", value: html`<span class="${tone(t.pnl)}">${formatUsd(t.pnl, { sign: true })}</span>`, sub: `Realised ${formatUsd(t.realizedPnl, { sign: true })}`, iconName: "wallet" })}
        ${stat({ label: "Daily drawdown", value: `${formatNumber(t.drawdownPct, 2)}%`, sub: `Limit ${data.settings.risk.maxDailyLossPct}% per account`, iconName: "trending-down" })}
        ${stat({ label: "Participants", value: data.participants.ACTIVE ?? 0, sub: `${data.participants.PAUSED ?? 0} paused`, iconName: "users" })}
        ${stat({ label: "Rejected / failed", value: `${p.rejectedTrades} / ${p.failedTrades}`, sub: "Per-account risk checks / orders", iconName: "shield-alert" })}`,
    );
    mount(
      $("[data-perf]", panel),
      html`${stat({ label: "Realised P&L", value: html`<span class="${tone(p.realizedPnl)}">${formatUsd(p.realizedPnl, { sign: true })}</span>` })}
        ${stat({ label: "Unrealised P&L", value: html`<span class="${tone(p.unrealizedPnl)}">${formatUsd(p.unrealizedPnl, { sign: true })}</span>` })}
        ${stat({ label: "Win / loss", value: `${p.wins} / ${p.losses}`, sub: p.winRatePct === null ? "No closed trades yet" : `${p.winRatePct.toFixed(1)}% win rate` })}
        ${stat({ label: "Return", value: html`<span class="${tone(p.returnPct)}">${formatPercent(p.returnPct)}</span>`, sub: `On ${formatUsd(p.capitalBase)} participant capital` })}
        ${stat({ label: "Fees", value: formatUsd(p.fees) })}
        ${stat({ label: "Trading volume", value: formatUsd(p.volume) })}
        ${stat({ label: "Max drawdown", value: formatUsd(p.maxDrawdown), sub: p.maxDrawdownPct === null ? "" : `${p.maxDrawdownPct.toFixed(2)}% of capital` })}
        ${stat({ label: "Current exposure", value: formatUsd(p.exposure) })}`,
    );
    if (!drawn) {
      drawn = true;
      const el = $("[data-chart]", panel);
      if (p.curve.length > 1) valueChart(el, p.curve, { format: (v) => formatUsd(v) }).catch(() => {});
      else mount(el, html`<p class="py-16 text-center text-sm text-dim">The curve appears once bot positions start closing.</p>`);
      mount(
        $("[data-instr-note]", panel),
        notice("info", {
          iconName: "info",
          title: "Instrument availability",
          body: html`The bot trades the platform's crypto spot markets (BTCUSD = BTC-USDT). Gold, silver and forex pairs have no tradable market or execution venue here, and spot trading cannot sell short, so bearish setups are logged and rejected. See Settings → Instruments.`,
        }),
      );
    }
  });
}

/* ───────────── Market analysis ───────────── */

function analysis(panel) {
  mount(panel, html`<div class="grid gap-4 xl:grid-cols-2" data-grid>${skeleton("h-72 rounded-2xl")}</div>`);
  const trendBadge = (t) => badge(t.toLowerCase(), t === "BULLISH" ? "up" : t === "BEARISH" ? "down" : "neutral");
  watch(
    "/api/admin/auto-trading/analysis",
    ({ data, error }) => {
      const grid = $("[data-grid]", panel);
      if (!data) return error && mount(grid, errorState({ message: error.message, retry: false }));
      if (!data.length) return mount(grid, html`<div class="card xl:col-span-2">${emptyState({ title: "No instruments enabled", description: "Enable instruments in Settings to start the analysis.", iconName: "line-chart" })}</div>`);
      mount(
        grid,
        data.map((a) => {
          const px = (v) => (v === null || v === undefined ? "—" : formatPrice(v));
          if (a.error || !a.at) return card({ title: pair(a.symbol), body: html`<div class="card-body text-sm text-muted">${a.error ?? "Waiting for the first scan (every 30 s)."}</div>` });
          const row = (k, v) => html`<div class="flex justify-between gap-3 border-b border-line/60 py-1.5 last:border-0"><dt class="text-dim">${k}</dt><dd class="text-right text-fg">${v}</dd></div>`;
          return card({
            title: html`${pair(a.symbol)} <span class="ml-2 font-mono text-sm text-muted">${px(a.last)}</span>`,
            description: `Updated ${timeAgo(a.at)} · ${a.session.open.length ? a.session.open.join(", ") : "No session open"}${a.news ? ` · News: ${a.news.title}` : ""}`,
            body: html`<div class="card-body grid gap-4 text-sm md:grid-cols-2">
              <dl>
                ${row("HTF bias", html`<span class="flex flex-wrap justify-end gap-1">${a.bias.map((b) => html`<span class="text-xs text-dim">${b.tf}</span>${trendBadge(b.trend)}`)}</span>`)}
                ${row(`${a.timeframes.setup} structure`, trendBadge(a.setupTrend))}
                ${row("Last event", a.lastEvent ? `${a.lastEvent.type} ${a.lastEvent.dir.toLowerCase()} @ ${px(a.lastEvent.level)}` : "—")}
                ${row("Liquidity above / below", `${px(a.liquidityAbove)} / ${px(a.liquidityBelow)}`)}
                ${row("Prev. day high / low", `${px(a.prevDayHigh)} / ${px(a.prevDayLow)}`)}
                ${row("Asian high / low", `${px(a.asiaHigh)} / ${px(a.asiaLow)}`)}
              </dl>
              <div>
                <p class="text-xs font-semibold text-dim uppercase">Unfilled FVGs</p>
                <p class="mt-1 text-xs text-up">${a.bullishFvgs.length ? a.bullishFvgs.map((g) => `${px(g.low)}–${px(g.high)}`).join(" · ") : "No bullish FVG"}</p>
                <p class="mt-1 text-xs text-down">${a.bearishFvgs.length ? a.bearishFvgs.map((g) => `${px(g.low)}–${px(g.high)}`).join(" · ") : "No bearish FVG"}</p>
                <p class="mt-4 text-xs font-semibold text-dim uppercase">Detected setups</p>
                ${a.setups.length
                  ? a.setups.map(
                      (s) => html`<div class="mt-2 rounded-lg border border-line p-2 text-xs">${sideLabel(s.side)} · ${badge({ READY: "ready", WAITING: "waiting for entry", REJECTED: "rejected", EXPIRED: "expired" }[s.status], { READY: "up", WAITING: "info", REJECTED: "down", EXPIRED: "neutral" }[s.status])}
                        ${s.zone ? html`<span class="block text-dim">Zone ${px(s.zone.low)}–${px(s.zone.high)} · SL ${px(s.stopLoss)} · TP ${px(s.takeProfit)}${s.riskReward ? ` · 1:${s.riskReward.toFixed(2)}` : ""}</span>` : ""}
                        ${s.reason ? html`<span class="block text-dim">${s.reason}</span>` : ""}</div>`,
                    )
                  : html`<p class="mt-1 text-xs text-dim">No sweep + structure shift in the lookback window.</p>`}
              </div>
            </div>`,
          });
        }),
      );
    },
    { refresh: 30000 },
  );
}

/* ───────────── Signal log ───────────── */

const SIGNAL_TONE = { WATCHING: "info", EXECUTED: "up", REJECTED: "down", EXPIRED: "neutral" };
const signalBadge = (s) => badge(s === "WATCHING" ? "Watching" : s.charAt(0) + s.slice(1).toLowerCase(), SIGNAL_TONE[s]);
const symbolOptions = () => [["", "All instruments"], ...Object.entries(state?.settings.instruments ?? {}).map(([s]) => [s, pair(s)])];

function signals(panel) {
  const t = adminTable(panel, {
    endpoint: "/api/admin/auto-trading/signals",
    filters: [
      { name: "status", type: "select", options: [["", "All decisions"], ["EXECUTED", "Executed"], ["REJECTED", "Rejected"], ["WATCHING", "Watching"], ["EXPIRED", "Expired"]] },
      { name: "symbol", type: "select", options: symbolOptions() },
    ],
    empty: emptyState({ title: "No setups detected yet", description: "Every setup the strategy detects is logged here with its full checklist.", iconName: "scroll-text" }),
    onRowClick: (s) => signalDetail(s),
    columns: [
      { key: "t", header: "Time (UTC)", cell: (s) => html`<span class="text-xs text-muted">${new Date(s.updatedAt).toISOString().slice(5, 16).replace("T", " ")}</span>` },
      { key: "m", header: "Setup", cell: (s) => html`<span class="flex items-center gap-2"><span class="font-semibold text-white">${pair(s.symbol)}</span>${sideLabel(s.side)}</span><span class="block text-[11px] text-dim">${s.htfBias}</span>` },
      { key: "c", header: "Checks", hideOnMobile: true, cell: (s) => html`<span class="flex flex-wrap gap-1">${s.conditions.map((c) => html`<span title="${c.label}: ${c.detail}" class="rounded px-1 text-[10px] font-semibold ${c.passed ? "bg-up-soft text-up" : c.required ? "bg-down-soft text-down" : "bg-panel-3 text-dim"}">${c.label.split(" ")[0]}</span>`)}</span>` },
      { key: "l", header: "Entry / SL / TP", align: "right", hideOnMobile: true, cell: (s) => html`<span class="num text-xs">${formatPrice(s.entryPrice, s.market.pricePrecision)}</span><span class="block text-[11px] text-dim">${s.stopLoss ? formatPrice(s.stopLoss, s.market.pricePrecision) : "—"} / ${s.takeProfit ? formatPrice(s.takeProfit, s.market.pricePrecision) : "—"}${s.riskReward ? ` · 1:${toNum(s.riskReward).toFixed(2)}` : ""}</span>` },
      { key: "d", header: "Decision", cell: (s) => html`${signalBadge(s.status)}${s.reason ? html`<span class="mt-0.5 block max-w-[18rem] text-[11px] leading-snug text-dim">${s.reason}</span>` : ""}` },
      { key: "p", header: "Trades · P&L", align: "right", cell: (s) => (s.trades.open + s.trades.closed ? html`<span class="num text-xs">${s.trades.open + s.trades.closed}</span><span class="block">${s.trades.closed ? pnlCell(s.realizedPnl) : html`<span class="text-[11px] text-dim">open</span>`}</span>` : html`<span class="text-dim">—</span>`) },
    ],
  });
  void t;
}

function signalDetail(s) {
  openModal({
    title: `${pair(s.symbol)} ${s.side === "BUY" ? "BUY" : "SELL"} · ${new Date(s.updatedAt).toISOString().slice(11, 16)} UTC`,
    description: `${s.strategy.replace("_", " / ")} · ${s.timeframes.bias.join(" + ")} → ${s.timeframes.setup} → ${s.timeframes.entry}`,
    size: "lg",
    body: html`<dl class="space-y-1.5 text-sm">${s.conditions.map(
        (c) => html`<div class="flex items-start justify-between gap-3 border-b border-line/60 pb-1.5"><dt class="flex items-center gap-2 text-fg">${icon(c.passed ? "check-circle-2" : "x-circle", `h-4 w-4 ${c.passed ? "text-up" : c.required ? "text-down" : "text-dim"}`)}${c.label}${c.required ? "" : html`<span class="text-[10px] text-dim">(optional)</span>`}</dt><dd class="text-right text-xs text-muted">${c.detail}</dd></div>`,
      )}</dl>
      <div class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">${[
        ["Entry", formatPrice(s.entryPrice, s.market.pricePrecision)],
        ["Stop loss", s.stopLoss ? formatPrice(s.stopLoss, s.market.pricePrecision) : "—"],
        ["Take profit", s.takeProfit ? formatPrice(s.takeProfit, s.market.pricePrecision) : "—"],
        ["Risk/Reward", s.riskReward ? `1:${toNum(s.riskReward).toFixed(2)}` : "—"],
      ].map(([k, v]) => html`<div class="rounded-lg border border-line p-2"><p class="text-[11px] text-dim">${k}</p><p class="num font-semibold text-white">${v}</p></div>`)}</div>
      <p class="mt-4 text-sm"><span class="text-dim">Signal:</span> ${signalBadge(s.status)} ${s.reason ? html`<span class="text-muted">— ${s.reason}</span>` : ""}</p>`,
  });
}

/* ───────────── Trades ───────────── */

const TRADE_BADGE = { OPEN: ["Open", "badge-accent"], CLOSED: ["Closed", "badge-neutral"], FAILED: ["Failed", "badge-down"], REJECTED: ["Rejected (risk)", "badge-warn"], PENDING: ["Opening", "badge-warn"] };
const tradeStatus = (x) => html`<span class="badge badge-dot ${TRADE_BADGE[x.status][1]}">${TRADE_BADGE[x.status][0]}</span>${x.failReason || x.lastError ? html`<span class="mt-0.5 block max-w-[16rem] text-[11px] leading-snug text-dim">${x.lastError ?? x.failReason}</span>` : ""}${x.closeReason ? html`<span class="mt-0.5 block text-[11px] text-dim">${{ TAKE_PROFIT: "Take profit", STOP_LOSS: "Stop loss", MANUAL: "Closed manually", PARTICIPANT_LEFT: "Participant left" }[x.closeReason]}</span>` : ""}`;

function trades(panel) {
  const t = adminTable(panel, {
    endpoint: "/api/admin/auto-trading/trades",
    filters: [
      { name: "q", type: "search", placeholder: "Search by email" },
      { name: "status", type: "select", options: [["", "All trades"], ["OPEN", "Open positions"], ["CLOSED", "Closed positions"], ["PROFIT", "Profitable"], ["LOSS", "Loss"], ["REJECTED", "Rejected by risk checks"], ["FAILED", "Failed orders"]] },
      { name: "symbol", type: "select", options: symbolOptions() },
    ],
    empty: emptyState({ title: "No bot trades", iconName: "history" }),
    columns: [
      { key: "u", header: "Account", cell: (x) => html`<a class="text-white hover:text-accent" href="/admin/users/${x.user.id}">${x.user.email}</a><span class="block text-[11px] text-dim">${formatDate(x.openedAt ?? x.createdAt)}</span>` },
      { key: "m", header: "Trade", cell: (x) => html`<span class="flex items-center gap-2"><span class="font-semibold text-white">${pair(x.market.symbol)}</span>${sideLabel(x.side)}${x.isDemo ? smallSim() : ""}</span><span class="block text-[11px] text-dim">${toNum(x.quantity) ? `${formatNumber(x.quantity)} · ${formatUsd(x.entryValue ?? x.notional)}` : "—"} · risk ${formatUsd(x.riskAmount)} (${toNum(x.riskPct)}%)</span>` },
      { key: "e", header: "Entry", align: "right", cell: (x) => priceCell(x.entryPrice, x.market.pricePrecision) },
      { key: "l", header: "SL / TP", align: "right", hideOnMobile: true, cell: (x) => html`<span class="num text-xs text-down">${formatPrice(x.stopLoss, x.market.pricePrecision)}</span><span class="num block text-xs text-up">${formatPrice(x.takeProfit, x.market.pricePrecision)}</span>` },
      { key: "x", header: "Exit", align: "right", hideOnMobile: true, cell: (x) => (x.status === "OPEN" ? html`<span class="text-[11px] text-dim">now</span> ${priceCell(x.currentPrice, x.market.pricePrecision)}` : priceCell(x.exitPrice, x.market.pricePrecision)) },
      { key: "f", header: "Fees", align: "right", hideOnMobile: true, cell: (x) => html`<span class="num text-xs text-muted">${toNum(x.fees) ? formatUsd(x.fees, { dp: 4 }) : "—"}</span>` },
      { key: "p", header: "P&L", align: "right", cell: (x) => (x.status === "OPEN" ? html`${pnlCell(x.unrealizedPnl)}<span class="block text-[11px] text-dim">unrealised</span>` : x.status === "CLOSED" ? pnlCell(x.netPnl) : html`<span class="text-dim">—</span>`) },
      { key: "s", header: "Status", cell: tradeStatus },
      { key: "a", header: html`<span class="sr-only">Actions</span>`, align: "right", cell: (x) => (x.status === "OPEN" ? html`<button type="button" class="btn btn-secondary btn-sm" data-close="${x.id}">Close</button>` : "") },
    ],
  });
  on(panel, "click", "[data-close]", async (_e, b) => {
    const x = t.rows().find((r) => r.id === b.dataset.close);
    if (!x) return;
    const ok = await confirmDialog({ title: `Close ${pair(x.market.symbol)} position?`, message: `${x.user.email}'s position is closed at the current market price.`, confirmLabel: "Close position", danger: true });
    if (!ok) return;
    b.disabled = true;
    try {
      const r = await api(`/api/admin/auto-trading/trades/${x.id}`, { method: "PATCH", body: { action: "close" } });
      toast.success("Position closed", `Net P&L ${formatUsd(r.netPnl, { sign: true })}`);
    } catch (err) {
      toast.error("Could not close", err.message);
    }
    invalidate("/api/admin/auto-trading");
  });
}

/* ───────────── Participants ───────────── */

function participants(panel) {
  const mode = state?.settings.participation.mode;
  const t = adminTable(panel, {
    endpoint: "/api/admin/auto-trading/participants",
    filters: [
      { name: "q", type: "search", placeholder: "Search by email" },
      { name: "status", type: "select", options: [["", "All participants"], ["ACTIVE", "Active"], ["PAUSED", "Paused"], ["STOPPED", "Stopped"]] },
    ],
    toolbarExtra: html`<span class="self-center text-xs text-dim">${mode === "ADMIN_ONLY" ? "Only administrators enrol users" : "Users can opt in themselves"}</span><button type="button" class="btn btn-primary btn-sm" data-enrol>${icon("user-plus", "h-4 w-4")} Enrol user</button>`,
    empty: emptyState({ title: "No participants yet", iconName: "users" }),
    columns: [
      { key: "u", header: "User", cell: (p) => html`<a class="font-semibold text-white hover:text-accent" href="/admin/users/${p.user.id}">${[p.user.profile?.firstName, p.user.profile?.lastName].filter(Boolean).join(" ") || p.user.email}</a><span class="block text-xs text-dim">${p.user.email}</span>` },
      { key: "s", header: "Status", cell: (p) => html`${statusBadge(p.status === "STOPPED" ? "CANCELLED" : p.status, p.status.charAt(0) + p.status.slice(1).toLowerCase())}${p.statusReason ? html`<span class="mt-0.5 block max-w-[16rem] text-[11px] text-dim">${p.statusReason}</span>` : ""}` },
      { key: "b", header: "Enabled by", hideOnMobile: true, cell: (p) => html`<span class="text-xs text-muted">${p.enabledBy === "ADMIN" ? "Administrator" : "User"}</span>` },
      { key: "e", header: "Start equity", align: "right", hideOnMobile: true, cell: (p) => html`<span class="num">${formatUsd(p.startEquity)}</span>` },
      { key: "t", header: "Trades", align: "right", cell: (p) => html`<span class="num text-xs">${p.openTrades} open · ${p.closedTrades} closed</span>` },
      { key: "p", header: "Realised P&L", align: "right", cell: (p) => pnlCell(p.realizedPnl) },
      { key: "j", header: "Joined", align: "right", hideOnMobile: true, cell: (p) => html`<span class="text-xs text-muted">${formatDate(p.joinedAt, "date")}</span>` },
      {
        key: "a",
        header: html`<span class="sr-only">Actions</span>`,
        align: "right",
        cell: (p) => html`<div class="flex justify-end gap-1">
          ${p.status !== "ACTIVE" ? html`<button type="button" class="btn btn-secondary btn-sm" data-part="activate" data-id="${p.id}">Activate</button>` : html`<button type="button" class="btn btn-ghost btn-sm" data-part="pause" data-id="${p.id}">Pause</button>`}
          ${p.status !== "STOPPED" ? html`<button type="button" class="btn btn-ghost btn-sm text-down" data-part="stop" data-id="${p.id}">Stop</button>` : ""}
        </div>`,
      },
    ],
  });
  on(panel, "click", "[data-part]", async (_e, b) => {
    const p = t.rows().find((r) => r.id === b.dataset.id);
    if (!p) return;
    const action = b.dataset.part;
    await actionModal({
      title: { activate: "Activate participant?", pause: "Pause participant?", stop: "Stop participant?" }[action],
      description: { activate: `${p.user.email} will receive new bot trades.`, pause: `No new bot trades for ${p.user.email}. Open positions keep their stop loss and take profit.`, stop: `${p.user.email} leaves automated trading.` }[action],
      confirmLabel: { activate: "Activate", pause: "Pause", stop: "Stop" }[action],
      tone: action === "activate" ? "primary" : "danger",
      reason: action === "activate" ? undefined : "optional",
      extraFields: action === "stop" ? html`<label class="flex items-center gap-2 text-sm text-muted"><input type="checkbox" class="checkbox" name="closePositions" /> Also close their open bot positions at market</label>` : "",
      onConfirm: async ({ reason, form }) => {
        await api(`/api/admin/auto-trading/participants/${p.id}`, { method: "PATCH", body: { action, ...(reason ? { reason } : {}), closePositions: !!form.closePositions?.checked } });
        toast.success("Participant updated");
        invalidate("/api/admin/auto-trading");
      },
    });
  });
  on(panel, "click", "[data-enrol]", () => {
    const m = openModal({
      title: "Enrol a user",
      description: "The bot can then open positions in this account, sized by the risk settings.",
      body: html`<form id="enrol-form" class="space-y-3" novalidate><div class="field"><label class="label" for="enrol-email">Email</label><input id="enrol-email" name="email" type="email" class="input" autocomplete="off" /></div><div data-err></div></form>`,
      footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="enrol-form" class="btn btn-primary">Enrol</button>`,
    });
    $("#enrol-form", m.el).addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("/api/admin/auto-trading/participants", { body: { email: e.target.email.value } });
        toast.success("User enrolled");
        m.close();
        invalidate("/api/admin/auto-trading");
      } catch (err) {
        mount($("[data-err]", m.el), notice("down", { body: err.message }));
      }
    });
  });
}

/* ───────────── Settings ───────────── */

const TF = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"];

function settings(panel) {
  if (!state) return mount(panel, skeleton("h-96 rounded-2xl"));
  const s = structuredClone(state.settings);
  const sp = s.strategyParams;
  const r = s.risk;
  const num = (name, label, value, suffix, hint, attrs = "") =>
    html`<div class="field"><label class="label" for="s-${name}">${label}</label><div class="input-wrap"><input id="s-${name}" name="${name}" class="input ${suffix ? "pr-12" : ""}" inputmode="decimal" value="${value}" ${raw(attrs)} />${suffix ? html`<span class="input-suffix">${suffix}</span>` : ""}</div>${hint ? html`<p class="hint">${hint}</p>` : ""}</div>`;
  const sel = (name, label, value, options, hint) =>
    html`<div class="field"><label class="label" for="s-${name}">${label}</label><select id="s-${name}" name="${name}" class="select">${options.map(([v, l]) => html`<option value="${v}" ${v === value ? raw("selected") : ""}>${l}</option>`)}</select>${hint ? html`<p class="hint">${hint}</p>` : ""}</div>`;
  const chk = (name, label, checked, hint) => html`<label class="flex items-start gap-2.5 text-sm text-muted"><input type="checkbox" class="checkbox mt-0.5" name="${name}" ${checked ? raw("checked") : ""} /><span>${label}${hint ? html`<span class="block text-xs text-dim">${hint}</span>` : ""}</span></label>`;
  const section = (title, desc, body) => card({ title, description: desc, cls: "mb-5", body: html`<div class="card-body">${body}</div>` });

  mount(
    panel,
    html`<form data-settings novalidate>
      ${section(
        "Strategy & timeframes",
        "SMC / ICT: higher-timeframe bias → setup (sweep, displacement, BOS, FVG / order block) → lower-timeframe entry confirmation",
        html`<div class="grid gap-4 md:grid-cols-3">
            <div class="field"><p class="label">Bias timeframes</p><div class="flex flex-wrap gap-3">${["30m", "1h", "2h", "4h", "1d"].map((t) => chk(`bias_${t}`, t, s.timeframes.bias.includes(t)))}</div><p class="hint">Market structure & direction</p></div>
            ${sel("setup", "Setup timeframe", s.timeframes.setup, TF.map((t) => [t, t]), "Setup confirmation")}
            ${sel("entry", "Entry timeframe", s.timeframes.entry, TF.map((t) => [t, t]), "Entry confirmation")}
          </div>
          <div class="mt-4 grid gap-4 md:grid-cols-3">
            ${sel("entryZone", "Entry zone", sp.entryZone, [["FVG_OR_OB", "FVG, else order block"], ["FVG", "Fair value gap only"], ["OB", "Order block only"]])}
            ${sel("htfMode", "HTF alignment", sp.htfMode, [["ALL", "All bias timeframes agree"], ["ANY", "Any bias timeframe agrees"]])}
            ${sel("takeProfitMode", "Take profit", sp.takeProfitMode, [["LIQUIDITY", "Opposing liquidity"], ["FIXED_RR", "Fixed risk multiple"]])}
            ${num("fixedRiskReward", "Fixed R multiple", sp.fixedRiskReward, "R", "Used with fixed take profit")}
            ${num("swingLength", "Swing length", sp.swingLength, "bars", "Candles each side of a swing point")}
            ${num("sweepLookback", "Sweep lookback", sp.sweepLookback, "bars")}
            ${num("displacementAtr", "Displacement", sp.displacementAtr, "× ATR", "Minimum candle body")}
            ${num("stopBufferAtr", "Stop buffer", sp.stopBufferAtr, "× ATR", "Beyond the sweep extreme")}
            ${num("setupExpiryCandles", "Setup expiry", sp.setupExpiryCandles, "bars", "Setup candles to wait for the entry")}
          </div>
          <div class="mt-4 grid gap-3 md:grid-cols-2">
            ${chk("requireHtfAlignment", "Require higher-timeframe alignment", sp.requireHtfAlignment)}
            ${chk("requireDisplacement", "Require displacement", sp.requireDisplacement)}
            ${chk("requirePremiumDiscount", "Require discount (buys) / premium (sells) entry", sp.requirePremiumDiscount)}
            ${chk("requireLtfConfirmation", "Require lower-timeframe confirmation", sp.requireLtfConfirmation)}
          </div>`,
      )}
      ${section(
        "Risk management",
        "Checked for every account before each trade; a trade that fails any check is rejected and logged",
        html`<div class="grid gap-4 md:grid-cols-3">
          ${num("riskPerTradePct", "Risk per trade", r.riskPerTradePct, "%", "Of the account value, from entry to stop loss")}
          ${num("maxOpenTrades", "Maximum open trades", r.maxOpenTrades, "per account")}
          ${num("maxDailyLossPct", "Maximum daily loss", r.maxDailyLossPct, "%", "Realised + open, resets 00:00 UTC")}
          ${num("maxDrawdownPct", "Maximum drawdown", r.maxDrawdownPct, "%", "Of start equity; pauses the account")}
          ${num("maxExposurePerInstrumentPct", "Max exposure per instrument", r.maxExposurePerInstrumentPct, "%")}
          ${num("maxTotalExposurePct", "Max total exposure", r.maxTotalExposurePct, "%")}
          ${num("maxConsecutiveLosses", "Max consecutive losses", r.maxConsecutiveLosses, "per day")}
          ${num("minRiskReward", "Minimum risk/reward", r.minRiskReward, "R")}
          <div class="field"><p class="label">Leverage / stop loss</p><p class="rounded-xl border border-line px-3 py-2.5 text-sm text-muted">1× (spot) · stop loss always required</p></div>
        </div>`,
      )}
      ${section(
        "Trading sessions",
        "Times in UTC. New positions only open while at least one enabled session is open.",
        html`<div class="space-y-3">${s.sessions.map(
          (x, i) => html`<div class="grid grid-cols-[1fr_auto_auto] items-center gap-3 sm:grid-cols-[14rem_8rem_8rem]">${chk(`sess_on_${i}`, x.label, x.enabled)}<input class="input h-10" name="sess_start_${i}" value="${x.start}" aria-label="${x.label} start" /><input class="input h-10" name="sess_end_${i}" value="${x.end}" aria-label="${x.label} end" /></div>`,
        )}</div>`,
      )}
      ${section(
        "Instruments",
        "The bot never trades an instrument that is not enabled here",
        html`<div class="overflow-x-auto"><table class="table dense"><thead><tr><th>Instrument</th><th class="c">Enabled</th><th class="r">Max exposure %</th><th>Trading hours (UTC, optional)</th></tr></thead><tbody>
            ${state.instruments.tradable.map(
              (m) => html`<tr><td><span class="font-semibold text-white">${pair(m.symbol)}</span>${m.alias ? html` <span class="text-xs text-dim">(${m.alias})</span>` : ""}<span class="block text-[11px] text-dim">${m.name}</span></td>
                <td class="c"><input type="checkbox" class="checkbox" name="inst_on_${m.symbol}" ${m.enabled ? raw("checked") : ""} aria-label="Enable ${m.symbol}" /></td>
                <td class="r"><input class="input h-9 w-24 text-right" name="inst_exp_${m.symbol}" value="${m.maxExposurePct ?? ""}" placeholder="default" /></td>
                <td><div class="flex gap-2"><input class="input h-9 w-20" name="inst_hs_${m.symbol}" value="${m.hours?.start ?? ""}" placeholder="HH:MM" /><input class="input h-9 w-20" name="inst_he_${m.symbol}" value="${m.hours?.end ?? ""}" placeholder="HH:MM" /></div></td></tr>`,
            )}
            ${state.instruments.unavailable.map(
              (m) => html`<tr class="opacity-60"><td><span class="font-semibold text-white">${m.symbol}</span><span class="block text-[11px] text-dim">${m.name} · ${m.group}</span></td><td class="c"><input type="checkbox" class="checkbox" disabled aria-label="${m.symbol} unavailable" /></td><td colspan="2" class="text-xs text-dim">${m.reason}</td></tr>`,
            )}
          </tbody></table></div>`,
      )}
      ${section(
        "News / high-volatility filter",
        "No new positions from the minutes before to the minutes after each event. Add high-impact events from your economic calendar.",
        html`${chk("newsEnabled", "News filter enabled", s.news.enabled)}
          <div class="mt-3 space-y-2" data-events>${s.news.events.map((e) => eventRow(e))}</div>
          <button type="button" class="btn btn-secondary btn-sm mt-3" data-add-event>${icon("plus", "h-4 w-4")} Add event</button>`,
      )}
      ${section(
        "User participation",
        "Who can take part and how",
        html`<div class="grid gap-4 md:grid-cols-3">
          <div class="flex items-end pb-2">${chk("availableToUsers", "Show Automated Trading to users", s.participation.availableToUsers)}</div>
          ${sel("mode", "Who controls participation", s.participation.mode, [["USER_OPT_IN", "Users opt in / pause / leave"], ["ADMIN_ONLY", "Administrators only"]])}
          ${num("minEquity", "Minimum account value to join", s.participation.minEquity, "USDT")}
        </div>`,
      )}
      <div data-save-error></div>
      <div class="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-bg/90 py-3 backdrop-blur"><button type="submit" class="btn btn-primary">${icon("save", "h-4 w-4")} Save settings</button></div>
    </form>`,
  );

  const form = $("[data-settings]", panel);
  on(panel, "click", "[data-add-event]", () => {
    const wrap = document.createElement("div");
    wrap.innerHTML = String(eventRow({ id: `ev-${Date.now().toString(36)}`, title: "", time: new Date(Date.now() + 86_400_000).toISOString(), instruments: [], before: 30, after: 30 }));
    $("[data-events]", panel).appendChild(wrap.firstElementChild);
  });
  on(panel, "click", "[data-del-event]", (_e, b) => b.closest("[data-event]").remove());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = form.elements;
    const v = (name) => f[name]?.value.trim();
    const n = (name) => Number(v(name));
    const next = {
      ...s,
      timeframes: { bias: ["30m", "1h", "2h", "4h", "1d"].filter((t) => f[`bias_${t}`].checked), setup: v("setup"), entry: v("entry") },
      strategyParams: {
        swingLength: n("swingLength"),
        sweepLookback: n("sweepLookback"),
        displacementAtr: n("displacementAtr"),
        entryZone: v("entryZone"),
        requireHtfAlignment: f.requireHtfAlignment.checked,
        htfMode: v("htfMode"),
        requireDisplacement: f.requireDisplacement.checked,
        requirePremiumDiscount: f.requirePremiumDiscount.checked,
        requireLtfConfirmation: f.requireLtfConfirmation.checked,
        setupExpiryCandles: n("setupExpiryCandles"),
        takeProfitMode: v("takeProfitMode"),
        fixedRiskReward: n("fixedRiskReward"),
        stopBufferAtr: n("stopBufferAtr"),
      },
      risk: {
        ...r,
        riskPerTradePct: n("riskPerTradePct"),
        maxOpenTrades: n("maxOpenTrades"),
        maxDailyLossPct: n("maxDailyLossPct"),
        maxDrawdownPct: n("maxDrawdownPct"),
        maxExposurePerInstrumentPct: n("maxExposurePerInstrumentPct"),
        maxTotalExposurePct: n("maxTotalExposurePct"),
        maxConsecutiveLosses: n("maxConsecutiveLosses"),
        minRiskReward: n("minRiskReward"),
      },
      sessions: s.sessions.map((x, i) => ({ ...x, enabled: f[`sess_on_${i}`].checked, start: v(`sess_start_${i}`), end: v(`sess_end_${i}`) })),
      instruments: Object.fromEntries(
        state.instruments.tradable
          .map((m) => {
            const on = f[`inst_on_${m.symbol}`].checked;
            const exp = v(`inst_exp_${m.symbol}`);
            const hs = v(`inst_hs_${m.symbol}`);
            const he = v(`inst_he_${m.symbol}`);
            return [m.symbol, { enabled: on, maxExposurePct: exp ? Number(exp) : null, hours: hs && he ? { start: hs, end: he } : null }];
          })
          .filter(([, x]) => x.enabled || x.maxExposurePct !== null || x.hours),
      ),
      news: {
        enabled: f.newsEnabled.checked,
        events: $$("[data-event]", panel).map((row) => {
          const q = (k) => row.querySelector(`[name="${k}"]`).value.trim();
          const when = q("ev_time");
          return {
            id: row.dataset.event,
            title: q("ev_title"),
            time: when ? new Date(`${when}:00Z`).toISOString() : "",
            instruments: q("ev_inst").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
            before: Number(q("ev_before")),
            after: Number(q("ev_after")),
          };
        }),
      },
      participation: { availableToUsers: f.availableToUsers.checked, mode: v("mode"), minEquity: n("minEquity") },
    };
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    mount($("[data-save-error]", panel), "");
    try {
      await api("/api/admin/auto-trading/settings", { method: "PUT", body: { settings: next } });
      toast.success("Settings saved", "They apply from the next scan.");
      refresh();
    } catch (err) {
      const fields = err.fields ? Object.entries(err.fields).map(([k, m]) => html`<li><code class="text-xs">${k}</code>: ${m}</li>`) : [];
      mount($("[data-save-error]", panel), notice("down", { cls: "mb-3", title: err.message, body: fields.length ? html`<ul class="mt-1 list-disc pl-4">${fields}</ul>` : "" }));
    } finally {
      btn.disabled = false;
    }
  });
}

function eventRow(e) {
  const local = e.time ? new Date(e.time).toISOString().slice(0, 16) : "";
  return html`<div class="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_12rem_9rem_5rem_5rem_auto] sm:items-end" data-event="${e.id}">
    <div class="field"><label class="label text-xs">Event</label><input class="input h-9" name="ev_title" value="${e.title}" placeholder="e.g. US CPI" /></div>
    <div class="field"><label class="label text-xs">Time (UTC)</label><input class="input h-9" type="datetime-local" name="ev_time" value="${local}" /></div>
    <div class="field"><label class="label text-xs">Instruments</label><input class="input h-9" name="ev_inst" value="${e.instruments.join(", ")}" placeholder="All" /></div>
    <div class="field"><label class="label text-xs">Min before</label><input class="input h-9" name="ev_before" value="${e.before}" /></div>
    <div class="field"><label class="label text-xs">Min after</label><input class="input h-9" name="ev_after" value="${e.after}" /></div>
    <button type="button" class="btn btn-ghost btn-sm text-down" data-del-event aria-label="Remove event">${icon("trash-2", "h-4 w-4")}</button>
  </div>`;
}

// Wait for the first status load so every tab has the settings it needs.
const first = setInterval(() => {
  if (!state) return;
  clearInterval(first);
  show(tab);
}, 50);
