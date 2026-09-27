import "server-only";
import { prisma, withTransaction } from "@/lib/db/prisma";
import { D, ZERO, floor } from "@/lib/db/decimal";
import { AppError } from "@/lib/api/errors";
import { isDemoMode } from "@/lib/config";
import { getLastPrice, getMarket, getTickers } from "@/lib/market-data/service";
import { closePosition, openPosition } from "@/lib/trading/managed-position";
import { venueStatus } from "@/lib/trading/venue";
import * as wallet from "@/lib/trading/wallet-service";
import { recordTransaction } from "@/lib/trading/transaction-service";
import { announce, createNotification, notify } from "@/lib/notifications/service";
import { publish } from "@/lib/realtime/bus";
import { audit } from "./audit";

/**
 * Copy trading.
 *
 *   Admin creates a lead trader → admin issues a signal → the engine opens a
 *   copy trade for every active follower → each copy trade is a normal MARKET
 *   order through placeOrder() → P&L comes from the actual entry and exit fills.
 *
 * Signal lifecycle: CREATED → ACTIVE → EXECUTED → CLOSED, or CREATED/ACTIVE → CANCELLED.
 *   ACTIVE:   waiting for the entry price (or executes at once when there is none).
 *   EXECUTED: followers' positions are open; closes at take-profit, stop-loss or by the admin.
 *
 * Followers' funds stay in their own wallets. While a copy position is open, the
 * asset it holds is reserved (locked) so it cannot be spent elsewhere, and is
 * released just before the closing order.
 */

const OPEN_TRADE = ["PENDING", "OPEN"];
const LIVE_SIGNAL = ["ACTIVE", "EXECUTED"];

const actorOf = (a) => (a ? { actorId: a.id, actorEmail: a.email, ip: a.ip } : { actorEmail: "system" });
const changed = (userId) => publish(userId, { type: "copy.updated" });

/* ───────────────────────────── Followers ───────────────────────────── */

export async function startCopying(userId, traderId, cfg) {
  const trader = await prisma.copyTrader.findUnique({ where: { id: traderId } });
  if (!trader || trader.deletedAt || trader.status !== "ACTIVE") throw new AppError("NOT_FOUND", "This trader is not available.");
  if (!trader.copyEnabled) throw new AppError("CONFLICT", "This trader is not accepting new copiers right now.");
  const allocation = D(cfg.allocation);
  const perTrade = D(cfg.amountPerTrade);
  checkAmounts(trader, allocation, perTrade);

  const existing = await prisma.copySubscription.findFirst({ where: { userId, traderId, status: { not: "STOPPED" } } });
  if (existing) throw new AppError("CONFLICT", "You are already copying this trader.");
  const usdt = await wallet.assetBySymbol("USDT");
  const w = await prisma.wallet.findUnique({ where: { userId_assetId: { userId, assetId: usdt.id } } });
  if (!w || w.available.lt(perTrade)) throw new AppError("INSUFFICIENT_BALANCE", `You need at least ${perTrade} USDT available to copy a trade.`);

  const sub = await prisma.copySubscription.create({
    data: { userId, traderId, allocation, amountPerTrade: perTrade, stopLossPct: D(cfg.stopLossPct), isDemo: isDemoMode() },
  });
  await notify({
    userId,
    type: "INVESTMENT_UPDATE",
    title: `Now copying ${trader.displayName}`,
    body: `New signals will open trades of ${perTrade} USDT, up to ${allocation} USDT at a time. Stop-copy threshold: ${cfg.stopLossPct}% loss.`,
    link: "/dashboard/copy-trading",
  });
  changed(userId);
  return sub;
}

function checkAmounts(trader, allocation, perTrade) {
  if (allocation.lt(trader.minAllocation)) throw new AppError("BELOW_MINIMUM", `The minimum copy amount for this trader is ${D(trader.minAllocation)} USDT.`);
  if (trader.maxAllocation && allocation.gt(trader.maxAllocation)) throw new AppError("ABOVE_MAXIMUM", `The maximum copy amount for this trader is ${D(trader.maxAllocation)} USDT.`);
  if (perTrade.lte(0) || perTrade.gt(allocation)) throw new AppError("VALIDATION_ERROR", "The amount per trade must be more than zero and no more than the copy amount.");
}

export async function updateCopy(userId, id, patch) {
  const sub = await prisma.copySubscription.findUnique({ where: { id }, include: { trader: true } });
  if (!sub || sub.userId !== userId) throw new AppError("NOT_FOUND");
  if (sub.status === "STOPPED") throw new AppError("CONFLICT", "This copy relationship has ended.");
  if (sub.status === "SUSPENDED") throw new AppError("CONFLICT", "This copy relationship has been suspended. Please contact support.");
  const allocation = patch.allocation ? D(patch.allocation) : sub.allocation;
  const perTrade = patch.amountPerTrade ? D(patch.amountPerTrade) : sub.amountPerTrade;
  if (patch.allocation || patch.amountPerTrade) checkAmounts(sub.trader, allocation, perTrade);
  const updated = await prisma.copySubscription.update({
    where: { id },
    data: {
      ...(patch.status ? { status: patch.status } : {}),
      allocation,
      amountPerTrade: perTrade,
      ...(patch.stopLossPct !== undefined ? { stopLossPct: D(patch.stopLossPct) } : {}),
    },
  });
  changed(userId);
  return updated;
}

/**
 * Stops copying: closes the relationship's open copy positions at market, then
 * returns any funds held under the previous copy model. `actor` is set when an
 * administrator (or the system) stops it.
 */
export async function stopCopying(userId, id, actor, reason) {
  const sub = await prisma.copySubscription.findUnique({ where: { id }, include: { trader: true } });
  if (!sub || (!actor && sub.userId !== userId)) throw new AppError("NOT_FOUND");
  if (sub.status === "STOPPED") throw new AppError("CONFLICT", "Already stopped.");

  // Refuse new copies while positions are being closed.
  await prisma.copySubscription.update({ where: { id }, data: { status: "PAUSED" } });
  const open = await prisma.copyTrade.findMany({ where: { subscriptionId: id, status: { in: OPEN_TRADE } } });
  const failures = [];
  for (const t of open) {
    let r = t.status === "PENDING" ? await cancelPendingTrade(t, "Copying stopped") : await closeCopyTrade(t.id);
    // Another closer (e.g. the signal's take-profit) may be finishing this position: give it a moment.
    for (let i = 0; r?.status === "OPEN" && r.closingAt && i < 10; i++) {
      await new Promise((ok) => setTimeout(ok, 500));
      r = await prisma.copyTrade.findUnique({ where: { id: t.id } });
    }
    if (r?.status === "OPEN") failures.push(r.lastError);
  }
  if (failures.length) {
    await prisma.copySubscription.update({ where: { id }, data: { status: sub.status } });
    throw new AppError("CONFLICT", `Some copy positions could not be closed yet: ${failures[0] ?? "market unavailable"}. Please try again shortly.`);
  }

  const res = await withTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CopySubscription" WHERE id = ${id} FOR UPDATE`;
    const cur = await tx.copySubscription.findUniqueOrThrow({ where: { id } });
    if (cur.status === "STOPPED") return { updated: cur, n: null };
    const usdt = await tx.asset.findUniqueOrThrow({ where: { symbol: "USDT" } });
    if (cur.escrowed.gt(0)) {
      await wallet.credit(tx, cur.userId, usdt.id, cur.escrowed);
      await recordTransaction(tx, {
        userId: cur.userId,
        type: "COPY_TRADING",
        direction: "CREDIT",
        assetId: usdt.id,
        amount: cur.escrowed,
        isDemo: cur.isDemo,
        description: `Copy allocation returned: ${sub.trader.displayName}`,
        metadata: { subscriptionId: id },
      });
    }
    const updated = await tx.copySubscription.update({ where: { id }, data: { status: "STOPPED", stoppedAt: new Date(), escrowed: ZERO } });
    if (actor) await audit({ ...actorOf(actor), action: "copy.stop", targetType: "CopySubscription", targetId: id, metadata: reason ? { reason } : {} }, tx);
    const n = await createNotification(
      {
        userId: cur.userId,
        type: "INVESTMENT_UPDATE",
        title: `Stopped copying ${sub.trader.displayName}`,
        body: [open.length ? `${open.length} open copy position${open.length === 1 ? " was" : "s were"} closed at market.` : "", reason ?? ""].filter(Boolean).join(" ") || "No new signals will be copied.",
        link: "/dashboard/copy-trading",
      },
      tx,
    );
    return { updated, n };
  });
  announce(res.n);
  publish(res.updated.userId, { type: "wallet.updated", assets: ["USDT"] });
  changed(res.updated.userId);
  return res.updated;
}

/** Admin: suspend / reinstate / stop a follower. */
export async function adminFollowerAction(id, action, actor, reason) {
  const sub = await prisma.copySubscription.findUnique({ where: { id }, include: { trader: true } });
  if (!sub) throw new AppError("NOT_FOUND");
  if (action === "stop") return stopCopying(sub.userId, id, actor, reason ? `Stopped by HarborFinance: ${reason}` : "Stopped by HarborFinance.");
  if (sub.status === "STOPPED") throw new AppError("CONFLICT", "This copy relationship has ended.");
  const status = action === "suspend" ? "SUSPENDED" : "ACTIVE";
  if (action === "suspend" && sub.status === "SUSPENDED") throw new AppError("CONFLICT", "Already suspended.");
  if (action === "reinstate" && sub.status !== "SUSPENDED") throw new AppError("CONFLICT", "Only suspended followers can be reinstated.");
  await prisma.$transaction(async (tx) => {
    await tx.copySubscription.update({ where: { id }, data: { status } });
    await audit({ ...actorOf(actor), action: `copy.${action}`, targetType: "CopySubscription", targetId: id, metadata: reason ? { reason } : {} }, tx);
  });
  await notify({
    userId: sub.userId,
    type: "INVESTMENT_UPDATE",
    title: action === "suspend" ? `Copying ${sub.trader.displayName} suspended` : `Copying ${sub.trader.displayName} resumed`,
    body: action === "suspend" ? "New signals will not be copied to your account. Open positions stay open until their signal closes." : "New signals will be copied to your account again.",
    link: "/dashboard/copy-trading",
  });
  changed(sub.userId);
  return { ok: true };
}

/* ───────────────────────────── Copy trades ───────────────────────────── */

async function cancelPendingTrade(t, reason) {
  return prisma.copyTrade.update({ where: { id: t.id }, data: { status: "CANCELLED", failReason: reason, closedAt: new Date() } });
}

async function failTrade(id, reason) {
  const t = await prisma.copyTrade.update({ where: { id }, data: { status: "FAILED", failReason: reason.slice(0, 300), closedAt: new Date() }, include: { market: true, trader: true } });
  await notify({
    userId: t.userId,
    type: "INVESTMENT_UPDATE",
    title: `Copy trade not opened: ${t.side === "BUY" ? "Buy" : "Sell"} ${t.market.symbol.replace("-", "/")}`,
    body: `A ${t.trader.displayName} signal could not be copied: ${reason}`,
    link: "/dashboard/copy-trading",
  });
  changed(t.userId);
  return t;
}

/** Opens one follower's position for an executed signal. Idempotent per (signal, subscription). */
async function openCopyTrade(signal, sub, market, last) {
  let t = await prisma.copyTrade.findUnique({ where: { signalId_subscriptionId: { signalId: signal.id, subscriptionId: sub.id } } });
  if (t && t.status !== "PENDING") return t;

  if (!t) {
    const open = await prisma.copyTrade.aggregate({ where: { subscriptionId: sub.id, status: { in: OPEN_TRADE } }, _sum: { notional: true } });
    const room = sub.allocation.minus(open._sum.notional ?? ZERO);
    let notional = sub.amountPerTrade.mul(signal.sizeMultiplier);
    if (notional.gt(room)) notional = room;
    try {
      t = await prisma.copyTrade.create({
        data: {
          signalId: signal.id,
          subscriptionId: sub.id,
          userId: sub.userId,
          traderId: signal.traderId,
          marketId: market.id,
          side: signal.side,
          notional: notional.gt(0) ? notional.toDecimalPlaces(8) : ZERO,
          isDemo: venueStatus().simulated,
        },
      });
    } catch (err) {
      if (err?.code === "P2002") return prisma.copyTrade.findUnique({ where: { signalId_subscriptionId: { signalId: signal.id, subscriptionId: sub.id } } });
      throw err;
    }
    if (notional.lt(market.minNotional)) {
      return failTrade(t.id, notional.lte(0) ? "Your copy amount is fully in use by open copy trades." : `The remaining copy amount (${notional.toDecimalPlaces(2)} USDT) is below this market's minimum order.`);
    }
  }
  if (sub.user?.status && sub.user.status !== "ACTIVE") return failTrade(t.id, "Your account is not active.");

  const quantity = floor(t.notional.div(last), market.quantityPrecision);
  const res = await openPosition({ model: "copyTrade", id: t.id, userId: sub.userId, market, side: signal.side, quantity, clientOrderId: `copy-${t.id}-in`, label: "Copy trade" });
  if (res.error) {
    return failTrade(t.id, signal.side === "SELL" && res.code === "INSUFFICIENT_BALANCE" ? `You need ${quantity} ${market.base.symbol} available to follow a sell signal.` : res.error);
  }
  changed(sub.userId);
  return res.row;
}

/**
 * Closes an open copy position at market and books its P&L from the actual
 * fills (see lib/trading/managed-position.js). Safe to call repeatedly.
 * Returns the updated copy trade (still OPEN with lastError if it failed).
 */
export async function closeCopyTrade(id) {
  const res = await closePosition({
    model: "copyTrade",
    id,
    include: { trader: true },
    label: "Copy trade",
    onClosed: async (tx, t, r) => {
      await tx.copySubscription.update({ where: { id: t.subscriptionId }, data: { pnl: { increment: r.netPnl } } });
      const pair = t.market.symbol.replace("-", "/");
      const sign = r.netPnl.gte(0) ? "+" : "";
      return createNotification(
        {
          userId: t.userId,
          type: "INVESTMENT_UPDATE",
          title: `Copy trade closed: ${pair} ${sign}${r.netPnl.toDecimalPlaces(2)} USDT`,
          body: `${t.side === "BUY" ? "Buy" : "Sell"} ${t.quantity} ${t.market.baseAsset.symbol} from ${t.trader.displayName}: entry ${t.entryPrice}, exit ${r.exitPrice}. Net result after fees ${sign}${r.netPnl.toDecimalPlaces(2)} USDT.`,
          link: "/dashboard/copy-trading",
        },
        tx,
      );
    },
  });
  if (res.closed) {
    announce(res.extra);
    changed(res.row.userId);
  }
  return res.row;
}

/* ───────────────────────────── Signals ───────────────────────────── */

async function signalMarket(symbol) {
  const market = await getMarket(symbol);
  if (!market || market.status !== "ACTIVE") throw new AppError("VALIDATION_ERROR", "Choose an active market.");
  return market;
}

/** Take-profit must be on the winning side and stop-loss on the losing side of the entry. */
function checkLevels(side, ref, tp, sl) {
  const buy = side === "BUY";
  if (tp && (buy ? tp.lte(ref) : tp.gte(ref))) throw new AppError("VALIDATION_ERROR", `Take profit must be ${buy ? "above" : "below"} the entry price (${ref}).`);
  if (sl && (buy ? sl.gte(ref) : sl.lte(ref))) throw new AppError("VALIDATION_ERROR", `Stop loss must be ${buy ? "below" : "above"} the entry price (${ref}).`);
}

const optD = (v) => (v === undefined || v === null || v === "" ? null : D(v));

export async function createSignal(input, actor) {
  const trader = await prisma.copyTrader.findUnique({ where: { id: input.traderId } });
  if (!trader || trader.deletedAt) throw new AppError("NOT_FOUND", "Unknown lead trader.");
  if (input.status === "ACTIVE" && trader.status !== "ACTIVE") throw new AppError("CONFLICT", "Signals can only be activated for an active lead trader.");
  const market = await signalMarket(input.market);
  const entry = optD(input.entryPrice);
  const tp = optD(input.takeProfit);
  const sl = optD(input.stopLoss);
  const last = D(await getLastPrice(market.symbol));
  checkLevels(input.side, entry ?? last, tp, sl);

  const signal = await prisma.$transaction(async (tx) => {
    const s = await tx.copySignal.create({
      data: {
        traderId: trader.id,
        marketId: market.id,
        side: input.side,
        entryPrice: entry,
        takeProfit: tp,
        stopLoss: sl,
        sizeMultiplier: D(input.sizeMultiplier ?? 1),
        note: input.note?.trim() || null,
        status: input.status,
        activatedAt: input.status === "ACTIVE" ? new Date() : null,
        createdById: actor.id,
      },
    });
    await audit({ ...actorOf(actor), action: "signal.create", targetType: "CopySignal", targetId: s.id, metadata: { trader: trader.displayName, market: market.symbol, side: input.side, status: input.status } }, tx);
    return s;
  });
  if (signal.status === "ACTIVE") void runCopyEngine().catch((err) => console.error("[copy] engine run failed", err));
  return signal;
}

export async function updateSignal(id, input, actor) {
  const s = await prisma.copySignal.findUnique({ where: { id }, include: { market: true, trader: true } });
  if (!s) throw new AppError("NOT_FOUND");
  const { action } = input;

  if (action === "activate") {
    if (s.status !== "CREATED") throw new AppError("CONFLICT", "Only draft signals can be activated.");
    if (s.trader.status !== "ACTIVE" || s.trader.deletedAt) throw new AppError("CONFLICT", "Signals can only be activated for an active lead trader.");
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.copySignal.updateMany({ where: { id, status: "CREATED" }, data: { status: "ACTIVE", activatedAt: new Date() } });
      if (!count) throw new AppError("CONFLICT", "This signal has changed. Refresh and try again.");
      await audit({ ...actorOf(actor), action: "signal.activate", targetType: "CopySignal", targetId: id }, tx);
    });
    void runCopyEngine().catch((err) => console.error("[copy] engine run failed", err));
    return { ok: true };
  }

  if (action === "cancel") {
    if (!["CREATED", "ACTIVE"].includes(s.status)) throw new AppError("CONFLICT", "Only signals that have not executed can be cancelled.");
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.copySignal.updateMany({ where: { id, status: { in: ["CREATED", "ACTIVE"] } }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      if (!count) throw new AppError("CONFLICT", "This signal has already executed.");
      await audit({ ...actorOf(actor), action: "signal.cancel", targetType: "CopySignal", targetId: id, metadata: input.reason ? { reason: input.reason } : {} }, tx);
    });
    return { ok: true };
  }

  if (action === "close") {
    if (s.status !== "EXECUTED") throw new AppError("CONFLICT", "Only executed signals can be closed.");
    const last = D(await getLastPrice(s.market.symbol));
    await closeSignal(s, last, "MANUAL", actor);
    return prisma.copySignal.findUnique({ where: { id } });
  }

  // Edit: levels can change while live; entry, market and side only before execution.
  if (!["CREATED", "ACTIVE", "EXECUTED"].includes(s.status)) throw new AppError("CONFLICT", "Closed or cancelled signals cannot be edited.");
  const executed = s.status === "EXECUTED";
  if (executed && (input.entryPrice !== undefined || input.side || input.market || input.sizeMultiplier)) {
    throw new AppError("CONFLICT", "Only take profit, stop loss and the note can change after a signal has executed.");
  }
  const market = input.market ? await signalMarket(input.market) : s.market;
  const side = input.side ?? s.side;
  const entry = input.entryPrice !== undefined ? optD(input.entryPrice) : s.entryPrice;
  const tp = input.takeProfit !== undefined ? optD(input.takeProfit) : s.takeProfit;
  const sl = input.stopLoss !== undefined ? optD(input.stopLoss) : s.stopLoss;
  const ref = executed ? s.executedPrice : (entry ?? D(await getLastPrice(market.symbol)));
  checkLevels(side, ref, tp, sl);
  await prisma.$transaction(async (tx) => {
    await tx.copySignal.update({
      where: { id },
      data: {
        marketId: market.id,
        side,
        entryPrice: entry,
        takeProfit: tp,
        stopLoss: sl,
        ...(input.sizeMultiplier ? { sizeMultiplier: D(input.sizeMultiplier) } : {}),
        ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
      },
    });
    await audit({ ...actorOf(actor), action: "signal.update", targetType: "CopySignal", targetId: id, metadata: { changes: input } }, tx);
  });
  return prisma.copySignal.findUnique({ where: { id } });
}

/** Marks an executed signal closed at `price` and closes every follower's position. */
async function closeSignal(signal, price, reason, actor) {
  const resultPct = signal.executedPrice?.gt(0)
    ? (signal.side === "BUY" ? price.minus(signal.executedPrice) : signal.executedPrice.minus(price)).div(signal.executedPrice).mul(100).toDecimalPlaces(8)
    : null;
  const claimed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.copySignal.updateMany({
      where: { id: signal.id, status: "EXECUTED" },
      data: { status: "CLOSED", closePrice: price, closeReason: reason, resultPct, closedAt: new Date() },
    });
    if (count && actor) await audit({ ...actorOf(actor), action: "signal.close", targetType: "CopySignal", targetId: signal.id, metadata: { price: price.toString() } }, tx);
    return count === 1;
  });
  if (!claimed) return;
  await closeSignalTrades(signal.id);
}

async function closeSignalTrades(signalId) {
  const trades = await prisma.copyTrade.findMany({ where: { signalId, status: { in: OPEN_TRADE } } });
  for (const t of trades) {
    if (t.status === "PENDING") await cancelPendingTrade(t, "The signal closed before this trade was opened.");
    else await closeCopyTrade(t.id).catch((err) => console.error(`[copy] close failed for ${t.id}`, err));
  }
}

async function executeSignal(signal, market, last) {
  const { count } = await prisma.copySignal.updateMany({ where: { id: signal.id, status: "ACTIVE" }, data: { status: "EXECUTED", executedPrice: last, executedAt: new Date() } });
  if (!count) return;
  await copyToFollowers({ ...signal, status: "EXECUTED", executedPrice: last }, market, last);
}

async function copyToFollowers(signal, market, last) {
  const subs = await prisma.copySubscription.findMany({
    where: { traderId: signal.traderId, status: "ACTIVE", startedAt: { lte: signal.executedAt ?? new Date() } },
    include: { user: { select: { status: true } } },
  });
  for (const sub of subs) {
    await openCopyTrade(signal, sub, market, last).catch((err) => console.error(`[copy] could not copy signal ${signal.id} to ${sub.id}`, err));
  }
}

const hit = (side, last, tp, sl) => {
  if (side === "BUY") return tp && last.gte(tp) ? "TAKE_PROFIT" : sl && last.lte(sl) ? "STOP_LOSS" : null;
  return tp && last.lte(tp) ? "TAKE_PROFIT" : sl && last.gte(sl) ? "STOP_LOSS" : null;
};

let running = false;
// The stop-copy threshold is checked every 30 s rather than on every 5 s cycle.
const STOP_CHECK_MS = 30_000;
let lastStopCheck = 0;

/**
 * Scheduler job. Executes active signals whose entry has been reached, closes
 * executed signals at take-profit/stop-loss, retries unfinished copy trades and
 * enforces each follower's stop-copy threshold. Never acts on stale prices.
 */
export async function runCopyEngine() {
  if (running) return;
  running = true;
  try {
    const signals = await prisma.copySignal.findMany({
      where: { status: { in: LIVE_SIGNAL } },
      include: { trader: { select: { status: true, deletedAt: true } }, market: { select: { symbol: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    const hasOpenTrades = await prisma.copyTrade.count({ where: { status: { in: OPEN_TRADE } } });
    if (!signals.length && !hasOpenTrades) return;

    const { tickers, status } = await getTickers();
    if (status.stale) return;
    const priceOf = (symbol) => {
      const t = tickers.get(symbol);
      return t && Number.isFinite(t.lastPrice) && t.lastPrice > 0 ? D(t.lastPrice) : null;
    };

    for (const s of signals) {
      const market = await getMarket(s.market.symbol);
      const last = market && priceOf(market.symbol);
      if (!last) continue;
      if (s.status === "ACTIVE") {
        if (s.trader.status !== "ACTIVE" || s.trader.deletedAt) continue;
        const reached = !s.entryPrice || (s.side === "BUY" ? last.lte(s.entryPrice) : last.gte(s.entryPrice));
        if (reached) await executeSignal(s, market, last);
      } else {
        // Retry followers whose entry did not complete (e.g. after a restart); recent ones may still be in flight.
        const pending = await prisma.copyTrade.findMany({ where: { signalId: s.id, status: "PENDING", createdAt: { lt: new Date(Date.now() - 60_000) } }, include: { subscription: { include: { user: { select: { status: true } } } } } });
        for (const p of pending) await openCopyTrade(s, p.subscription, market, last).catch(() => {});
        const reason = hit(s.side, last, s.takeProfit, s.stopLoss);
        if (reason) await closeSignal(s, last, reason);
      }
    }

    // Positions left open after their signal closed (a closing order failed earlier).
    const stranded = await prisma.copyTrade.findMany({ where: { status: "OPEN", signal: { status: { in: ["CLOSED", "CANCELLED"] } } }, take: 100 });
    for (const t of stranded) await closeCopyTrade(t.id).catch(() => {});

    if (Date.now() - lastStopCheck >= STOP_CHECK_MS) {
      lastStopCheck = Date.now();
      await enforceStopCopy(priceOf);
    }
  } finally {
    running = false;
  }
}

/** Stops a follower once realised + open losses reach their stop-copy threshold. */
async function enforceStopCopy(priceOf) {
  // Only relationships that can be at a loss: an open position or negative realised P&L.
  const subs = await prisma.copySubscription.findMany({
    where: { status: { in: ["ACTIVE", "PAUSED"] }, OR: [{ pnl: { lt: 0 } }, { copyTrades: { some: { status: "OPEN" } } }] },
    include: { copyTrades: { where: { status: "OPEN" }, include: { market: { select: { symbol: true } } } } },
    take: 1000,
  });
  for (const s of subs) {
    const open = s.copyTrades.reduce((sum, t) => sum.plus(unrealizedPnl(t, priceOf(t.market.symbol)) ?? ZERO), ZERO);
    const total = s.pnl.plus(open);
    if (total.gte(0)) continue;
    const limit = s.allocation.mul(s.stopLossPct).div(100);
    if (total.neg().gte(limit)) {
      await stopCopying(s.userId, s.id, { email: "system" }, `Your stop-copy threshold of ${s.stopLossPct}% was reached.`).catch((err) => console.error(`[copy] stop-copy failed for ${s.id}`, err));
    }
  }
}

/** Open position's P&L at `price`, before the closing fee. */
export function unrealizedPnl(t, price) {
  if (t.status !== "OPEN" || !price || !t.entryValue) return null;
  const value = t.quantity.mul(price);
  return t.side === "BUY" ? value.minus(t.entryValue) : t.entryValue.minus(value);
}

/* ───────────────────────────── Lead traders ───────────────────────────── */

/** Removes a lead trader: history is kept, followers are stopped. */
export async function removeTrader(id, actor) {
  const t = await prisma.copyTrader.findUnique({ where: { id } });
  if (!t || t.deletedAt) throw new AppError("NOT_FOUND");
  const live = await prisma.copySignal.count({ where: { traderId: id, status: { in: LIVE_SIGNAL } } });
  if (live) throw new AppError("CONFLICT", "Close or cancel this trader's active signals before removing them.");
  await prisma.$transaction(async (tx) => {
    await tx.copyTrader.update({ where: { id }, data: { deletedAt: new Date(), status: "INACTIVE", copyEnabled: false } });
    await tx.copySignal.updateMany({ where: { traderId: id, status: "CREATED" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await audit({ ...actorOf(actor), action: "copytrader.remove", targetType: "CopyTrader", targetId: id }, tx);
  });
  const subs = await prisma.copySubscription.findMany({ where: { traderId: id, status: { not: "STOPPED" } } });
  for (const s of subs) await stopCopying(s.userId, s.id, actor, `${t.displayName} is no longer available for copy trading.`).catch(() => {});
  return { ok: true };
}
