import "server-only";
import { prisma } from "@/lib/db/prisma";
import { D, ZERO } from "@/lib/db/decimal";
import { getTickers, getUsdtPrices } from "@/lib/market-data/service";
import { getWallets } from "./wallet-service";

/**
 * PortfolioService — values holdings in USDT using live provider prices.
 * If prices are unavailable, values are returned as null (never guessed).
 */
export async function getPortfolio(userId) {
  const [wallets, positions, investments, copies, user, deposits, withdrawals] = await Promise.all([
    getWallets(userId),
    prisma.position.findMany({ where: { userId }, include: { asset: true } }),
    prisma.investmentSubscription.aggregate({ where: { userId, status: { in: ["PENDING", "ACTIVE"] } }, _sum: { amount: true } }),
    // Copy positions are held in the wallet itself; only funds escrowed by the previous copy model sit outside it.
    prisma.copySubscription.aggregate({ where: { userId, status: { not: "STOPPED" } }, _sum: { escrowed: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { isDemo: true } }),
    prisma.transaction.aggregate({ where: { userId, type: "DEPOSIT", status: "COMPLETED" }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { userId, type: "WITHDRAWAL", status: "COMPLETED" }, _sum: { amount: true } }),
  ]);

  let prices = null;
  let changes = {};
  let priceStatus = null;
  try {
    const p = await getUsdtPrices();
    prices = p.prices;
    priceStatus = p.status;
    const { tickers } = await getTickers();
    changes = Object.fromEntries([...tickers.values()].filter((t) => t.symbol.endsWith("-USDT")).map((t) => [t.symbol.split("-")[0], t.changePercent]));
  } catch {
    prices = null;
  }

  const posBySymbol = new Map(positions.map((p) => [p.asset.symbol, p]));
  const invested = D(investments._sum.amount ?? 0)
    .plus(copies._sum.escrowed ?? 0)
    .toNumber();
  const usdt = wallets.find((w) => w.symbol === "USDT");
  const availableBalance = usdt ? usdt.available.toNumber() : 0;

  let holdingsValue = prices ? 0 : null;
  let unrealized = prices ? 0 : null;
  let todayPnl = prices ? 0 : null;

  const raw = wallets
    .filter((w) => w.total.gt(0) || posBySymbol.get(w.symbol)?.quantity.gt(0))
    .map((w) => {
      const pos = posBySymbol.get(w.symbol);
      const qty = w.total.toNumber();
      const price = prices ? (prices[w.symbol] ?? null) : null;
      const value = price !== null ? qty * price : null;
      const change = w.symbol === "USDT" ? 0 : (changes[w.symbol] ?? null);
      const avg = pos && pos.quantity.gt(0) ? pos.avgCost : null;
      let pnl = null;
      let pnlPct = null;
      if (avg && price !== null) {
        const trackedQty = Math.min(pos.quantity.toNumber(), qty);
        pnl = (price - avg.toNumber()) * trackedQty;
        pnlPct = avg.gt(0) ? ((price - avg.toNumber()) / avg.toNumber()) * 100 : null;
      }
      if (value !== null && holdingsValue !== null) holdingsValue += value;
      else holdingsValue = null;
      if (pnl !== null && unrealized !== null) unrealized += pnl;
      if (value !== null && change !== null && todayPnl !== null) {
        todayPnl += value - value / (1 + change / 100);
      }
      return { w, pos, qty, price, value, change, avg, pnl, pnlPct };
    });

  const totalValue = holdingsValue !== null ? holdingsValue + invested : null;
  const holdings = raw
    .map(({ w, price, value, change, avg, pnl, pnlPct }) => ({
      symbol: w.symbol,
      name: w.name,
      color: w.color,
      type: w.type,
      available: w.available.toString(),
      locked: w.locked.toString(),
      quantity: w.total.toString(),
      avgPrice: avg ? avg.toString() : null,
      price,
      value,
      change24h: change,
      pnl,
      pnlPct,
      allocationPct: totalValue && value ? (value / totalValue) * 100 : 0,
    }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const realizedPnl = positions.reduce((s, p) => s.plus(p.realizedPnl), ZERO).toNumber();
  const netDeposits = D(deposits._sum.amount ?? 0)
    .minus(withdrawals._sum.amount ?? 0)
    .toNumber();
  const baseForRoi = netDeposits > 0 ? netDeposits : null;
  const change24hPct = totalValue && todayPnl !== null && totalValue - todayPnl > 0 ? (todayPnl / (totalValue - todayPnl)) * 100 : null;

  return {
    currency: "USDT",
    totalValue,
    availableBalance,
    investedBalance: invested,
    holdingsValue,
    unrealizedPnl: unrealized,
    realizedPnl,
    todayPnl,
    change24hPct,
    roiPct: totalValue !== null && baseForRoi ? ((totalValue - baseForRoi) / baseForRoi) * 100 : null,
    netDeposits,
    holdings,
    priceStatus,
    isDemo: user?.isDemo ?? false,
  };
}

/** Records a valuation snapshot for the performance chart. */
export async function snapshotPortfolio(userId, isDemo) {
  const p = await getPortfolio(userId);
  if (p.totalValue === null) return;
  const portfolio = await prisma.portfolio.upsert({ where: { userId }, create: { userId }, update: {} });
  await prisma.portfolioSnapshot.create({
    data: { portfolioId: portfolio.id, totalValue: D(p.totalValue.toFixed(8)), invested: D(p.investedBalance.toFixed(8)), isDemo },
  });
}

export async function getPerformance(userId, days) {
  const portfolio = await prisma.portfolio.findUnique({ where: { userId } });
  if (!portfolio) return { points: [], containsDemo: false };
  const since = new Date(Date.now() - days * 86_400_000);
  const snaps = await prisma.portfolioSnapshot.findMany({
    where: { portfolioId: portfolio.id, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, totalValue: true, isDemo: true },
  });
  // Downsample to at most ~120 points for charting.
  const step = Math.max(1, Math.ceil(snaps.length / 120));
  const points = snaps.filter((_, i) => i % step === 0 || i === snaps.length - 1).map((s) => ({ t: s.createdAt.toISOString(), v: s.totalValue.toNumber() }));
  return { points, containsDemo: snaps.some((s) => s.isDemo) };
}
