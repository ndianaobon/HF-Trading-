import "server-only";
import { prisma } from "@/lib/db/prisma";
import { D } from "@/lib/db/decimal";
import { AppError } from "@/lib/api/errors";
import { getCandles, getMarket, getTickers } from "@/lib/market-data/service";
import { venueStatus } from "@/lib/trading/venue";
import { closePosition, openPosition } from "@/lib/trading/managed-position";
import { getPortfolio } from "@/lib/trading/portfolio-service";
import { announce, createNotification, notify } from "@/lib/notifications/service";
import { publish } from "@/lib/realtime/bus";
import { audit } from "@/lib/services/audit";
import { TIMEFRAMES, enabledSymbols, getBotConfig } from "./config";
import { detectSetup, marketOverview } from "./smc";
import { sizePosition } from "./risk";

/**
 * Automated trading bot engine.
 *
 *   Market data → SMC/ICT analysis → setup → gates (status, session, news,
 *   instrument) → per-account risk engine → position size → existing order
 *   system (placeOrder via managed positions) → actual fill → P&L.
 *
 * Every detected setup is written to AutoBotSignal with its condition checklist
 * and the decision (EXECUTED / REJECTED / EXPIRED + reason). Positions are closed
 * at their stop loss or take profit by `runBotExits`, which keeps protecting open
 * positions even while the bot is paused or stopped.
 */

const CRITICAL_ERROR_LIMIT = 3;
const changed = (userId) => publish(userId, { type: "autobot.updated" });

/* ───────────── Helpers ───────────── */

const minutesOfDay = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();
const hm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const inWindow = (now, start, end) => {
  const m = minutesOfDay(now);
  const a = hm(start);
  const b = hm(end);
  return a <= b ? m >= a && m < b : m >= a || m < b; // windows may wrap midnight
};

/** Open sessions right now, and whether the instrument may open new positions. */
export function sessionState(settings, symbol, now = new Date()) {
  const open = settings.sessions.filter((s) => s.enabled && inWindow(now, s.start, s.end));
  const hours = settings.instruments[symbol]?.hours;
  const instrumentOk = !hours || inWindow(now, hours.start, hours.end);
  return { open: open.map((s) => s.label), allowed: open.length > 0 && instrumentOk, instrumentHours: hours ?? null };
}

/** The high-impact news event currently blocking `symbol`, if any. */
export function newsBlock(settings, symbol, now = new Date()) {
  if (!settings.news.enabled) return null;
  const base = symbol.split("-")[0];
  return (
    settings.news.events.find((e) => {
      const t = new Date(e.time).getTime();
      const applies = !e.instruments.length || e.instruments.some((i) => i === symbol || i === base);
      return applies && now.getTime() >= t - e.before * 60_000 && now.getTime() <= t + e.after * 60_000;
    }) ?? null
  );
}

const fmtPrice = (market) => (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(market.pricePrecision));

async function setHealth(patch) {
  const cfg = await prisma.autoBotConfig.findUnique({ where: { id: "default" } });
  await prisma.autoBotConfig.update({ where: { id: "default" }, data: { health: { ...(cfg?.health ?? {}), ...patch } } });
}

/** Changes the bot status (admin action or automatic circuit breaker). */
export async function setBotStatus(status, { actor, reason } = {}) {
  await prisma.autoBotConfig.upsert({
    where: { id: "default" },
    create: { id: "default", status, statusReason: reason ?? null, statusChangedAt: new Date(), statusChangedBy: actor?.email ?? "system" },
    update: { status, statusReason: reason ?? null, statusChangedAt: new Date(), statusChangedBy: actor?.email ?? "system" },
  });
  await audit({ actorId: actor?.id ?? null, actorEmail: actor?.email ?? "system", ip: actor?.ip, action: `autobot.${status.toLowerCase()}`, targetType: "AutoBotConfig", targetId: "default", metadata: reason ? { reason } : {} });
  if (status === "RUNNING") await setHealth({ criticalErrors: 0 });
}

async function criticalError(message) {
  const cfg = await prisma.autoBotConfig.findUnique({ where: { id: "default" } });
  const n = (cfg?.health?.criticalErrors ?? 0) + 1;
  await setHealth({ criticalErrors: n, lastError: message, lastErrorAt: new Date().toISOString() });
  if (n >= CRITICAL_ERROR_LIMIT && cfg?.status === "RUNNING") {
    await setBotStatus("PAUSED", { reason: `Paused automatically after ${n} execution errors: ${message}` });
  }
}

/* ───────────── Candles ───────────── */

/** Closed candles only (drops the one still forming) for structure analysis. */
async function closedCandles(symbol, tf, limit) {
  const rows = await getCandles(symbol, tf, limit);
  const now = Date.now() / 1000;
  return rows.filter((c) => c.time + TIMEFRAMES[tf] * 60 <= now);
}

async function loadData(symbol, settings, last) {
  const { bias, setup, entry } = settings.timeframes;
  const [biasCandles, setupCandles, entryCandles] = await Promise.all([
    Promise.all(bias.map(async (tf) => ({ tf, candles: await closedCandles(symbol, tf, 300) }))),
    closedCandles(symbol, setup, 300),
    getCandles(symbol, entry, 200),
  ]);
  return { bias: biasCandles, setup: setupCandles, entry: entryCandles, last };
}

/* ───────────── Scan cycle ───────────── */

let scanning = false;

/** Scheduler job: analyse every enabled instrument and act on setups. */
export async function runBotCycle() {
  if (scanning) return;
  scanning = true;
  try {
    const cfg = await getBotConfig();
    const { settings } = cfg;
    const symbols = enabledSymbols(settings);
    if (!symbols.length) return;

    let tickers;
    try {
      const t = await getTickers();
      if (t.status.stale) throw new AppError("MARKET_DATA_UNAVAILABLE");
      tickers = t.tickers;
    } catch {
      await setHealth({ dataOk: false, lastCycleAt: new Date().toISOString(), note: "Market data unavailable: no analysis or new trades until it returns." });
      return;
    }
    const venue = venueStatus();
    const analysed = [];
    for (const symbol of symbols) {
      const market = await getMarket(symbol);
      if (!market || market.status !== "ACTIVE") continue;
      const last = tickers.get(symbol)?.lastPrice;
      if (!Number.isFinite(last) || last <= 0) continue;
      try {
        await scanInstrument(cfg, market, last, venue);
        analysed.push(symbol);
      } catch (err) {
        console.error(`[autobot] analysis failed for ${symbol}`, err);
        await prisma.autoBotAnalysis.upsert({ where: { symbol }, create: { symbol, data: { error: "Market data unavailable" } }, update: { data: { error: "Market data unavailable" } } });
      }
    }
    await setHealth({ dataOk: true, lastCycleAt: new Date().toISOString(), analysed, note: venue.available ? null : "Execution venue unavailable: no new trades." });
  } finally {
    scanning = false;
  }
}

async function scanInstrument(cfg, market, last, venue) {
  const { settings } = cfg;
  const params = { ...settings.strategyParams, minRiskReward: settings.risk.minRiskReward };
  const data = await loadData(market.symbol, settings, last);
  const fmt = fmtPrice(market);
  const session = sessionState(settings, market.symbol);
  const news = newsBlock(settings, market.symbol);
  const setups = [];
  for (const side of ["BUY", "SELL"]) {
    const s = detectSetup(side, data, params, fmt);
    if (!s) continue;
    setups.push({ side, status: s.status, reason: s.reason, zone: s.zone, stopLoss: s.stopLoss, takeProfit: s.takeProfit, riskReward: s.riskReward });
    await handleSetup(cfg, market, s, { session, news, venue });
  }
  const overview = marketOverview(data, params);
  const snapshot = { ...overview, setups, session, news: news ? { title: news.title, time: news.time } : null, at: new Date().toISOString(), timeframes: settings.timeframes };
  await prisma.autoBotAnalysis.upsert({ where: { symbol: market.symbol }, create: { symbol: market.symbol, data: snapshot }, update: { data: snapshot } });
}

/** Records the setup and, when it is ready and every gate passes, executes it. */
export async function handleSetup(cfg, market, s, { session, news, venue }) {
  const setupKey = `${market.symbol}:${s.key}`;
  const existing = await prisma.autoBotSignal.findUnique({ where: { setupKey } });
  if (existing && (existing.status !== "WATCHING" || existing.decidedAt)) return; // decided, or being executed

  const settings = cfg.settings;
  const gates = [];
  if (s.status === "READY") {
    gates.push({ key: "spot", label: "Direction supported", required: true, passed: s.side === "BUY", detail: s.side === "BUY" ? "Long on spot" : "Short selling is not available on spot markets" });
    gates.push({ key: "session", label: "Trading session", required: true, passed: session.allowed, detail: session.allowed ? session.open.join(", ") : session.open.length ? "Outside this instrument's trading hours" : "No enabled session is open" });
    gates.push({ key: "news", label: "News filter", required: true, passed: !news, detail: news ? `${news.title} (${new Date(news.time).toUTCString().slice(17, 22)} UTC)` : settings.news.enabled ? "No high-impact event" : "Off" });
    gates.push({ key: "botStatus", label: "Bot status", required: true, passed: cfg.status === "RUNNING", detail: cfg.status === "RUNNING" ? "Running" : `${cfg.status.toLowerCase()}${cfg.statusReason ? `: ${cfg.statusReason}` : ""}` });
    gates.push({ key: "venue", label: "Execution available", required: true, passed: venue.available, detail: venue.name });
  }
  const conditions = [...s.conditions, ...gates];
  const failedGate = gates.find((g) => !g.passed);
  const expiresMs = settings.strategyParams.setupExpiryCandles * TIMEFRAMES[settings.timeframes.setup] * 60_000;

  let status = { WAITING: "WATCHING", READY: "WATCHING", REJECTED: "REJECTED", EXPIRED: "EXPIRED" }[s.status];
  let reason = s.reason;
  if (s.status === "READY" && failedGate) {
    status = "REJECTED";
    reason =
      failedGate.key === "spot"
        ? "Short selling is not available on spot markets"
        : failedGate.key === "session"
          ? "Outside the configured trading sessions"
          : failedGate.key === "news"
            ? `High-impact news window: ${news.title}`
            : failedGate.key === "botStatus"
              ? `Bot is ${cfg.status.toLowerCase()}`
              : "Execution venue unavailable";
  }

  const data = {
    marketId: market.id,
    symbol: market.symbol,
    side: s.side,
    status,
    timeframes: settings.timeframes,
    htfBias: s.htfBias.map((b) => `${b.tf} ${b.trend}`).join(", "),
    conditions,
    zoneLow: s.zone ? D(s.zone.low) : null,
    zoneHigh: s.zone ? D(s.zone.high) : null,
    entryPrice: D(s.entryPrice),
    stopLoss: s.stopLoss ? D(s.stopLoss) : null,
    takeProfit: s.takeProfit ? D(s.takeProfit) : null,
    riskReward: s.riskReward !== null ? D(s.riskReward.toFixed(8)) : null,
    reason: reason ?? null,
    decidedAt: status === "WATCHING" ? null : new Date(),
  };
  const signal = existing
    ? await prisma.autoBotSignal.update({ where: { id: existing.id }, data })
    : await prisma.autoBotSignal.create({ data: { ...data, setupKey, expiresAt: new Date(Date.now() + expiresMs) } }).catch(async (err) => {
        if (err?.code === "P2002") return prisma.autoBotSignal.findUnique({ where: { setupKey } });
        throw err;
      });
  if (s.status === "READY" && !failedGate && signal.status === "WATCHING") await executeSignal(signal, market, cfg);
}

/**
 * Opens a position for every active participant whose account passes the risk
 * engine. The signal is EXECUTED when at least one position actually opened.
 */
export async function executeSignal(signal, market, cfg) {
  // Claim: only one engine run executes a given signal.
  const { count } = await prisma.autoBotSignal.updateMany({ where: { id: signal.id, status: "WATCHING", decidedAt: null }, data: { reason: "Executing", decidedAt: new Date() } });
  if (!count) return;
  const settings = cfg.settings;
  const participants = await prisma.autoBotParticipant.findMany({ where: { status: "ACTIVE", user: { status: "ACTIVE" } } });
  const { tickers } = await getTickers();
  const priceOf = (sym) => {
    const t = tickers.get(sym);
    return t?.lastPrice > 0 ? D(t.lastPrice) : null;
  };
  let opened = 0;
  const reasons = [];
  for (const p of participants) {
    const r = await openBotTrade(signal, p, market, settings, priceOf).catch((err) => {
      console.error(`[autobot] trade for ${p.userId} failed`, err);
      return { status: "FAILED", reason: "Unexpected error" };
    });
    if (r.status === "OPEN") opened++;
    else reasons.push(r.reason);
  }
  const status = opened ? "EXECUTED" : "REJECTED";
  const reason = opened
    ? `${opened} position${opened === 1 ? "" : "s"} opened${reasons.length ? `, ${reasons.length} account${reasons.length === 1 ? "" : "s"} skipped` : ""}`
    : participants.length
      ? `No account passed the risk checks (${[...new Set(reasons)].slice(0, 2).join("; ")})`
      : "No active participants";
  await prisma.autoBotSignal.update({ where: { id: signal.id }, data: { status, reason, decidedAt: new Date() } });
}

async function openBotTrade(signal, p, market, settings, priceOf) {
  const base = {
    signalId: signal.id,
    participantId: p.id,
    userId: p.userId,
    marketId: market.id,
    side: signal.side,
    riskPct: D(settings.risk.riskPerTradePct),
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfit,
    isDemo: venueStatus().simulated,
  };
  const sized = await sizePosition({
    participant: p,
    market,
    signal: { side: signal.side, entryPrice: priceOf(market.symbol) ?? signal.entryPrice, stopLoss: signal.stopLoss, takeProfit: signal.takeProfit, riskReward: signal.riskReward === null ? null : Number(signal.riskReward) },
    settings,
    priceOf,
  });
  if (!sized.ok) {
    await prisma.autoBotTrade.create({ data: { ...base, status: "REJECTED", failReason: sized.reason, closedAt: new Date() } }).catch(() => {});
    if (sized.pause) await prisma.autoBotParticipant.update({ where: { id: p.id }, data: { status: "PAUSED", statusReason: sized.reason } });
    changed(p.userId);
    return { status: "REJECTED", reason: sized.reason };
  }

  let t;
  try {
    t = await prisma.autoBotTrade.create({ data: { ...base, quantity: sized.quantity, notional: sized.notional, riskAmount: sized.riskAmount } });
  } catch (err) {
    if (err?.code === "P2002") return { status: "SKIPPED", reason: "Already processed" };
    throw err;
  }
  const res = await openPosition({ model: "autoBotTrade", id: t.id, userId: p.userId, market, side: signal.side, quantity: sized.quantity, clientOrderId: `bot-${t.id}-in`, label: "Automated trade" });
  if (res.error) {
    await prisma.autoBotTrade.update({ where: { id: t.id }, data: { status: "FAILED", failReason: res.error.slice(0, 300), closedAt: new Date() } });
    if (res.critical) await criticalError(res.error);
    changed(p.userId);
    return { status: "FAILED", reason: res.error };
  }
  await setHealth({ criticalErrors: 0 });
  await notify({
    userId: p.userId,
    type: "TRADE_EXECUTED",
    title: `Automated trade opened: ${signal.side === "BUY" ? "Buy" : "Sell"} ${market.symbol.replace("-", "/")}`,
    body: `Entry ${res.row.entryPrice}, stop loss ${signal.stopLoss}, take profit ${signal.takeProfit}. Risk ${sized.riskAmount.toDecimalPlaces(2)} USDT (${settings.risk.riskPerTradePct}% of account).`,
    link: "/dashboard/auto-trading",
  });
  changed(p.userId);
  return { status: "OPEN" };
}

/* ───────────── Exits ───────────── */

let exiting = false;

/** Scheduler job: closes open bot positions at their stop loss or take profit. */
export async function runBotExits() {
  if (exiting) return;
  exiting = true;
  try {
    const open = await prisma.autoBotTrade.findMany({ where: { status: "OPEN" }, include: { market: { select: { symbol: true } } }, take: 1000 });
    if (!open.length) return;
    const { tickers, status } = await getTickers();
    if (status.stale) return; // never act on stale prices
    for (const t of open) {
      const last = tickers.get(t.market.symbol)?.lastPrice;
      if (!Number.isFinite(last)) continue;
      const p = D(last);
      const buy = t.side === "BUY";
      const reason = buy ? (p.gte(t.takeProfit) ? "TAKE_PROFIT" : p.lte(t.stopLoss) ? "STOP_LOSS" : null) : p.lte(t.takeProfit) ? "TAKE_PROFIT" : p.gte(t.stopLoss) ? "STOP_LOSS" : null;
      if (reason) await closeBotTrade(t.id, reason).catch((err) => console.error(`[autobot] close failed for ${t.id}`, err));
    }
  } finally {
    exiting = false;
  }
}

const REASON_LABEL = { TAKE_PROFIT: "take profit", STOP_LOSS: "stop loss", MANUAL: "closed by HarborFinance", PARTICIPANT_LEFT: "you left automated trading" };

/** Closes one bot position at market; P&L comes from the actual fills. */
export async function closeBotTrade(id, reason, actor) {
  const res = await closePosition({
    model: "autoBotTrade",
    id,
    closeData: { closeReason: reason },
    label: "Automated trade",
    onClosed: async (tx, t, r) => {
      if (actor) await audit({ actorId: actor.id, actorEmail: actor.email, ip: actor.ip, action: "autobot.trade.close", targetType: "AutoBotTrade", targetId: id }, tx);
      const sign = r.netPnl.gte(0) ? "+" : "";
      return createNotification(
        {
          userId: t.userId,
          type: "TRADE_EXECUTED",
          title: `Automated trade closed: ${t.market.symbol.replace("-", "/")} ${sign}${r.netPnl.toDecimalPlaces(2)} USDT`,
          body: `Closed at ${r.exitPrice} (${REASON_LABEL[reason] ?? reason}). Entry ${t.entryPrice}. Net result after fees ${sign}${r.netPnl.toDecimalPlaces(2)} USDT.`,
          link: "/dashboard/auto-trading",
        },
        tx,
      );
    },
  });
  if (res.closed) {
    announce(res.extra);
    changed(res.row.userId);
  }
  return res;
}

/* ───────────── Participation ───────────── */

export async function joinBot(userId, { byAdmin = null } = {}) {
  const { settings } = await getBotConfig();
  if (!byAdmin) {
    if (!settings.participation.availableToUsers) throw new AppError("FEATURE_DISABLED", "Automated trading is not available right now.");
    if (settings.participation.mode !== "USER_OPT_IN") throw new AppError("FORBIDDEN", "Automated trading is enabled by HarborFinance for eligible accounts.");
  }
  const p = await getPortfolio(userId);
  if (p.totalValue === null) throw new AppError("MARKET_DATA_UNAVAILABLE", "Your account value can't be calculated right now. Please try again shortly.");
  if (!byAdmin && p.totalValue < settings.participation.minEquity) throw new AppError("BELOW_MINIMUM", `An account value of at least ${settings.participation.minEquity} USDT is required.`);
  const startEquity = D(p.totalValue.toFixed(8));
  const existing = await prisma.autoBotParticipant.findUnique({ where: { userId } });
  const row = existing
    ? await prisma.autoBotParticipant.update({
        where: { userId },
        data: { status: "ACTIVE", statusReason: null, enabledBy: byAdmin ? "ADMIN" : "USER", ...(existing.status === "STOPPED" ? { startEquity, joinedAt: new Date() } : {}) },
      })
    : await prisma.autoBotParticipant.create({ data: { userId, startEquity, enabledBy: byAdmin ? "ADMIN" : "USER" } });
  if (byAdmin) await audit({ actorId: byAdmin.id, actorEmail: byAdmin.email, ip: byAdmin.ip, action: "autobot.participant.enable", targetType: "AutoBotParticipant", targetId: row.id });
  await notify({
    userId,
    type: "INVESTMENT_UPDATE",
    title: "Automated trading enabled",
    body: `The SMC/ICT bot can now open positions in your account, risking ${settings.risk.riskPerTradePct}% of your account value per trade. Results are not guaranteed.`,
    link: "/dashboard/auto-trading",
  });
  changed(userId);
  return row;
}

export async function setParticipantStatus(userId, status, { actor, reason, closePositions = false } = {}) {
  const p = await prisma.autoBotParticipant.findUnique({ where: { userId } });
  if (!p) throw new AppError("NOT_FOUND", "Not participating in automated trading.");
  if (!actor) {
    const { settings } = await getBotConfig();
    if (settings.participation.mode !== "USER_OPT_IN" && status !== "STOPPED") throw new AppError("FORBIDDEN", "Automated trading for your account is managed by HarborFinance.");
    if (p.status === "PAUSED" && status === "ACTIVE" && p.statusReason?.startsWith("Maximum drawdown")) throw new AppError("FORBIDDEN", "Paused after reaching the maximum drawdown. Please contact support.");
  }
  if (status === "ACTIVE" && p.status === "STOPPED") return joinBot(userId, { byAdmin: actor ?? null });
  const failures = [];
  if (closePositions) {
    const open = await prisma.autoBotTrade.findMany({ where: { participantId: p.id, status: "OPEN" } });
    for (const t of open) {
      const r = await closeBotTrade(t.id, actor ? "MANUAL" : "PARTICIPANT_LEFT", actor);
      if (!r.closed && r.row?.status === "OPEN") failures.push(r.error ?? "in progress");
    }
  }
  const row = await prisma.autoBotParticipant.update({ where: { userId }, data: { status, statusReason: reason ?? null } });
  if (actor) await audit({ actorId: actor.id, actorEmail: actor.email, ip: actor.ip, action: `autobot.participant.${status.toLowerCase()}`, targetType: "AutoBotParticipant", targetId: p.id, metadata: reason ? { reason } : {} });
  changed(userId);
  if (failures.length) throw new AppError("CONFLICT", `Participation updated, but ${failures.length} position(s) could not be closed yet: ${failures[0]}`);
  return row;
}
