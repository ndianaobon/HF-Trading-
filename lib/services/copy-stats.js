import "server-only";
import { prisma } from "@/lib/db/prisma";
import { D, ZERO } from "@/lib/db/decimal";
import { getTickers } from "@/lib/market-data/service";
import { unrealizedPnl } from "./copy-trading";

/**
 * Lead-trader statistics, calculated only from recorded signals (executed and
 * closed at live market prices) and followers' copy trades (actual fills).
 * Nothing here can be typed in by an administrator.
 */

const num = (d) => (d === null || d === undefined ? null : Number(d));

export const avatarUrl = (t) => (t.avatarKey ? `/api/copy-trading/traders/${t.id}/avatar?v=${t.updatedAt.getTime()}` : null);

export function traderProfile(t) {
  return {
    id: t.id,
    slug: t.slug,
    displayName: t.displayName,
    avatarColor: t.avatarColor,
    avatarUrl: avatarUrl(t),
    bio: t.bio,
    strategy: t.strategy,
    strategyTags: t.strategyTags,
    assets: t.assets,
    riskLevel: t.riskLevel,
    status: t.status,
    copyEnabled: t.copyEnabled,
    minAllocation: t.minAllocation,
    maxAllocation: t.maxAllocation,
    createdAt: t.createdAt,
  };
}

/** Compounded return of closed signals, as an index starting at 100. */
function equitySeries(closed) {
  let v = 100;
  return closed.map((s) => {
    v *= 1 + Number(s.resultPct) / 100;
    return { t: s.closedAt.toISOString(), v: Number(v.toFixed(4)) };
  });
}

/** Statistics for many traders at once. Returns Map(traderId → stats). */
export async function traderStats(traderIds) {
  const where = { traderId: { in: traderIds } };
  const [signals, closed, subs, followers, trades] = await Promise.all([
    prisma.copySignal.groupBy({ by: ["traderId", "status"], where, _count: { _all: true } }),
    prisma.copySignal.findMany({ where: { ...where, status: "CLOSED", resultPct: { not: null } }, select: { traderId: true, resultPct: true, closedAt: true }, orderBy: { closedAt: "asc" } }),
    prisma.copySubscription.groupBy({ by: ["traderId", "status"], where, _count: { _all: true } }),
    prisma.copySubscription.findMany({ where, distinct: ["traderId", "userId"], select: { traderId: true } }),
    prisma.copyTrade.groupBy({ by: ["traderId", "status"], where, _count: { _all: true }, _sum: { netPnl: true, notional: true } }),
  ]);
  const out = new Map();
  for (const id of traderIds) {
    const count = (rows, status) => rows.filter((r) => r.traderId === id && (!status || [].concat(status).includes(r.status))).reduce((a, r) => a + r._count._all, 0);
    const mine = closed.filter((s) => s.traderId === id);
    const wins = mine.filter((s) => s.resultPct.gt(0)).length;
    const losses = mine.filter((s) => s.resultPct.lt(0)).length;
    const series = equitySeries(mine);
    const closedTrades = trades.find((r) => r.traderId === id && r.status === "CLOSED");
    const since = (days) => {
      const from = Date.now() - days * 86_400_000;
      return mine.filter((s) => s.closedAt.getTime() >= from).reduce((v, s) => v * (1 + Number(s.resultPct) / 100), 1) * 100 - 100;
    };
    out.set(id, {
      totalSignals: count(signals, ["ACTIVE", "EXECUTED", "CLOSED"]),
      pendingSignals: count(signals, "ACTIVE"),
      openSignals: count(signals, "EXECUTED"),
      closedSignals: count(signals, "CLOSED"),
      draftSignals: count(signals, "CREATED"),
      cancelledSignals: count(signals, "CANCELLED"),
      winningSignals: wins,
      losingSignals: losses,
      winRatePct: mine.length ? (wins / mine.length) * 100 : null,
      avgResultPct: mine.length ? mine.reduce((a, s) => a + Number(s.resultPct), 0) / mine.length : null,
      totalReturnPct: mine.length ? series[series.length - 1].v - 100 : null,
      return30dPct: mine.length ? since(30) : null,
      return90dPct: mine.length ? since(90) : null,
      followers: followers.filter((f) => f.traderId === id).length,
      activeFollowers: count(subs, ["ACTIVE", "PAUSED"]),
      copyTrades: count(trades, ["OPEN", "CLOSED"]),
      openCopyTrades: count(trades, "OPEN"),
      failedCopyTrades: count(trades, "FAILED"),
      copiedVolume: num(trades.filter((r) => r.traderId === id && ["OPEN", "CLOSED"].includes(r.status)).reduce((a, r) => a.plus(r._sum.notional ?? ZERO), ZERO)),
      realizedPnl: num(closedTrades?._sum.netPnl ?? ZERO),
      sparkline: series.slice(-60).map((p) => p.v),
    });
  }
  return out;
}

async function priceLookup() {
  try {
    const { tickers, status } = await getTickers();
    return (symbol) => {
      const t = tickers.get(symbol);
      return !status.stale && t?.lastPrice > 0 ? D(t.lastPrice) : null;
    };
  } catch {
    return () => null;
  }
}

const movePct = (side, from, to) => (from && to ? Number((side === "BUY" ? to.minus(from) : from.minus(to)).div(from).mul(100)) : null);

/**
 * Full public profile. Take-profit/stop-loss levels and signals waiting for
 * entry are shown only to the trader's current followers.
 */
export async function traderDetail(idOrSlug, viewerId) {
  const t = await prisma.copyTrader.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }], deletedAt: null } });
  if (!t) return null;
  const following = viewerId ? await prisma.copySubscription.findFirst({ where: { traderId: t.id, userId: viewerId, status: { not: "STOPPED" } } }) : null;
  if (t.status === "INACTIVE" && !following) return null;

  const [stats, closed, live] = await Promise.all([
    traderStats([t.id]).then((m) => m.get(t.id)),
    prisma.copySignal.findMany({ where: { traderId: t.id, status: "CLOSED" }, include: { market: { select: { symbol: true } } }, orderBy: { closedAt: "asc" } }),
    prisma.copySignal.findMany({ where: { traderId: t.id, status: { in: ["ACTIVE", "EXECUTED"] } }, include: { market: { select: { symbol: true } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const price = await priceLookup();
  const levels = (s) => (following ? { takeProfit: s.takeProfit, stopLoss: s.stopLoss } : {});

  return {
    ...traderProfile(t),
    stats,
    following: following ? { id: following.id, status: following.status } : null,
    performanceSeries: equitySeries(closed.filter((s) => s.resultPct !== null)),
    openPositions: live
      .filter((s) => s.status === "EXECUTED")
      .map((s) => {
        const last = price(s.market.symbol);
        return { id: s.id, market: s.market.symbol, side: s.side, entryPrice: s.executedPrice, openedAt: s.executedAt, currentPrice: last, resultPct: movePct(s.side, s.executedPrice, last), ...levels(s) };
      }),
    pendingSignals: following
      ? live.filter((s) => s.status === "ACTIVE").map((s) => ({ id: s.id, market: s.market.symbol, side: s.side, entryPrice: s.entryPrice, createdAt: s.activatedAt ?? s.createdAt, ...levels(s) }))
      : [],
    history: closed
      .slice(-50)
      .reverse()
      .map((s) => ({ id: s.id, market: s.market.symbol, side: s.side, entryPrice: s.executedPrice, exitPrice: s.closePrice, resultPct: num(s.resultPct), closeReason: s.closeReason, openedAt: s.executedAt, closedAt: s.closedAt })),
  };
}

/** A user's copy relationships with open positions and live P&L. */
export async function userCopySummary(userId) {
  const subs = await prisma.copySubscription.findMany({
    where: { userId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      trader: true,
      copyTrades: { where: { status: "OPEN" }, include: { market: { select: { symbol: true } } } },
    },
  });
  const price = await priceLookup();
  return subs.map(({ trader, copyTrades, ...s }) => {
    let unrealized = ZERO;
    let priced = true;
    for (const ct of copyTrades) {
      const u = unrealizedPnl(ct, price(ct.market.symbol));
      if (u === null) priced = false;
      else unrealized = unrealized.plus(u);
    }
    const inUse = copyTrades.reduce((a, ct) => a.plus(ct.notional), ZERO);
    return {
      ...s,
      trader: traderProfile(trader),
      openTrades: copyTrades.length,
      inUse,
      realizedPnl: s.pnl,
      unrealizedPnl: priced ? unrealized : null,
      totalPnl: priced ? s.pnl.plus(unrealized) : null,
    };
  });
}

/** Adds live price and unrealised P&L to copy-trade rows (which must include market.symbol). */
export async function withLivePnl(rows) {
  const price = await priceLookup();
  return rows.map((r) => {
    const last = r.status === "OPEN" ? price(r.market.symbol) : null;
    const u = unrealizedPnl(r, last);
    return { ...r, currentPrice: last, unrealizedPnl: u, unrealizedPct: u !== null && r.entryValue?.gt(0) ? Number(u.div(r.entryValue).mul(100)) : null };
  });
}
