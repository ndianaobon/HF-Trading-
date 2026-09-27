import "server-only";
import { prisma } from "@/lib/db/prisma";
import { D, ZERO } from "@/lib/db/decimal";
import { getTickers } from "@/lib/market-data/service";
import { openPnl, startOfUtcDay } from "./risk";

/**
 * Bot performance, calculated only from executed positions (actual fills). It is
 * never entered or adjusted by hand. Pass `userId` for one account, or nothing
 * for the whole platform.
 */

export async function livePrices() {
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

const n = (d) => (d === null || d === undefined ? null : Number(d));

export async function botPerformance({ userId } = {}) {
  const where = userId ? { userId } : {};
  const [trades, statusCounts, participants] = await Promise.all([
    prisma.autoBotTrade.findMany({ where: { ...where, status: { in: ["OPEN", "CLOSED"] } }, include: { market: { select: { symbol: true } } }, orderBy: { closedAt: "asc" } }),
    prisma.autoBotTrade.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.autoBotParticipant.findMany({ where: userId ? { userId } : { status: { not: "STOPPED" } }, select: { startEquity: true } }),
  ]);
  const priceOf = await livePrices();
  const today = startOfUtcDay();
  let realized = ZERO;
  let unrealized = ZERO;
  let unpriced = false;
  let fees = ZERO;
  let volume = ZERO;
  let exposure = ZERO;
  let wins = 0;
  let losses = 0;
  let todayRealized = ZERO;
  let todayWins = 0;
  let todayLosses = 0;
  let todayOpened = 0;
  let cum = ZERO;
  let peak = ZERO;
  let maxDd = ZERO;
  const curve = [];
  for (const t of trades) {
    fees = fees.plus(t.fees);
    volume = volume.plus(t.entryValue ?? ZERO).plus(t.exitValue ?? ZERO);
    if (t.openedAt && t.openedAt >= today) todayOpened++;
    if (t.status === "CLOSED") {
      const pnl = t.netPnl ?? ZERO;
      realized = realized.plus(pnl);
      if (pnl.gt(0)) wins++;
      else if (pnl.lt(0)) losses++;
      if (t.closedAt >= today) {
        todayRealized = todayRealized.plus(pnl);
        if (pnl.gt(0)) todayWins++;
        else if (pnl.lt(0)) todayLosses++;
      }
      cum = cum.plus(pnl);
      if (cum.gt(peak)) peak = cum;
      if (peak.minus(cum).gt(maxDd)) maxDd = peak.minus(cum);
      curve.push({ t: t.closedAt.toISOString(), v: Number(cum.toFixed(8)) });
    } else {
      const price = priceOf(t.market.symbol);
      const u = openPnl(t, price);
      if (u === null) unpriced = true;
      else {
        unrealized = unrealized.plus(u);
        exposure = exposure.plus(t.quantity.mul(price));
      }
    }
  }
  const base = participants.reduce((a, p) => a.plus(p.startEquity), ZERO);
  const todayPnl = todayRealized.plus(unrealized);
  const counts = Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all]));
  return {
    realizedPnl: n(realized),
    unrealizedPnl: unpriced ? null : n(unrealized),
    totalPnl: unpriced ? null : n(realized.plus(unrealized)),
    wins,
    losses,
    winRatePct: wins + losses ? (wins / (wins + losses)) * 100 : null,
    fees: n(fees),
    volume: n(volume),
    exposure: n(exposure),
    openTrades: trades.filter((t) => t.status === "OPEN").length,
    closedTrades: wins + losses + trades.filter((t) => t.status === "CLOSED" && (t.netPnl ?? ZERO).eq(0)).length,
    failedTrades: counts.FAILED ?? 0,
    rejectedTrades: counts.REJECTED ?? 0,
    maxDrawdown: n(maxDd),
    maxDrawdownPct: base.gt(0) ? n(maxDd.div(base).mul(100)) : null,
    returnPct: base.gt(0) && !unpriced ? n(realized.plus(unrealized).div(base).mul(100)) : null,
    capitalBase: n(base),
    today: {
      opened: todayOpened,
      wins: todayWins,
      losses: todayLosses,
      realizedPnl: n(todayRealized),
      pnl: unpriced ? null : n(todayPnl),
      drawdownPct: base.gt(0) && todayPnl.lt(0) ? n(todayPnl.neg().div(base).mul(100)) : 0,
    },
    curve: curve.slice(-300),
  };
}

/** Adds live price and unrealised P&L to bot trade rows (which must include market.symbol). */
export async function withLive(rows) {
  const priceOf = await livePrices();
  return rows.map((r) => {
    const price = r.status === "OPEN" ? priceOf(r.market.symbol) : null;
    const u = openPnl(r, price);
    return { ...r, currentPrice: price, unrealizedPnl: u, unrealizedPct: u !== null && r.entryValue?.gt(0) ? Number(u.div(r.entryValue).mul(100)) : null };
  });
}
