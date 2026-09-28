import "server-only";
import { prisma } from "@/lib/db/prisma";
import { getUsdtPrices } from "@/lib/market-data/service";

/**
 * Platform analytics. Values are converted to USDT at *current* prices where
 * assets differ (noted in the UI). Demo rows are included in dev and flagged.
 */
export async function platformSeries(days) {
  const since = new Date(Date.now() - days * 86_400_000);
  let prices = { USDT: 1 };
  try {
    prices = (await getUsdtPrices()).prices;
  } catch {
    /* values for non-USDT assets will be excluded */
  }
  const toUsdt = (rows) => {
    const map = new Map();
    for (const r of rows) {
      const key = r.d.toISOString().slice(0, 10);
      const price = r.symbol ? prices[r.symbol] : 1;
      if (price === undefined) continue;
      map.set(key, (map.get(key) ?? 0) + (r.v ?? 0) * price);
    }
    return map;
  };

  const [users, trades, deposits, withdrawals, wFees] = await Promise.all([
    prisma.$queryRaw`SELECT date_trunc('day', "createdAt") AS d, count(*)::float AS v FROM "User" WHERE "createdAt" >= ${since} GROUP BY 1`,
    prisma.$queryRaw`SELECT date_trunc('day', "createdAt") AS d, sum("quoteQuantity")::float AS v, sum("fee")::float AS f FROM "Trade" WHERE "createdAt" >= ${since} GROUP BY 1`,
    prisma.$queryRaw`SELECT date_trunc('day', d."createdAt") AS d, sum(d."amount")::float AS v, a."symbol" AS symbol FROM "Deposit" d JOIN "Asset" a ON a.id = d."assetId" WHERE d."status" = 'COMPLETED' AND d."createdAt" >= ${since} GROUP BY 1, a."symbol"`,
    prisma.$queryRaw`SELECT date_trunc('day', w."createdAt") AS d, sum(w."amount")::float AS v, a."symbol" AS symbol FROM "Withdrawal" w JOIN "Asset" a ON a.id = w."assetId" WHERE w."status" = 'COMPLETED' AND w."createdAt" >= ${since} GROUP BY 1, a."symbol"`,
    prisma.$queryRaw`SELECT date_trunc('day', w."createdAt") AS d, sum(w."fee")::float AS v, a."symbol" AS symbol FROM "Withdrawal" w JOIN "Asset" a ON a.id = w."assetId" WHERE w."status" = 'COMPLETED' AND w."createdAt" >= ${since} GROUP BY 1, a."symbol"`,
  ]);

  const userMap = toUsdt(users);
  const volMap = toUsdt(trades);
  const tradeFeeMap = toUsdt(trades.map((t) => ({ d: t.d, v: t.f })));
  const depMap = toUsdt(deposits);
  const wdrMap = toUsdt(withdrawals);
  const wFeeMap = toUsdt(wFees);

  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    series.push({
      date: key,
      signups: userMap.get(key) ?? 0,
      volume: volMap.get(key) ?? 0,
      deposits: depMap.get(key) ?? 0,
      withdrawals: wdrMap.get(key) ?? 0,
      revenue: (tradeFeeMap.get(key) ?? 0) + (wFeeMap.get(key) ?? 0),
    });
  }
  return series;
}

export async function overviewCards() {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [totalUsers, activeUsers, pendingKyc, pendingDeposits, pendingWithdrawals, demoUsers] = await Promise.all([
    prisma.user.count({ where: { adminUser: null } }),
    prisma.user.count({ where: { adminUser: null, status: "ACTIVE", lastLoginAt: { gte: since30 } } }),
    prisma.kycApplication.count({ where: { status: "PENDING" } }),
    prisma.deposit.count({ where: { status: { in: ["PENDING", "CONFIRMING"] } } }),
    prisma.withdrawal.count({ where: { status: { in: ["PENDING_REVIEW", "PROCESSING"] } } }),
    prisma.user.count({ where: { isDemo: true } }),
  ]);
  const series = await platformSeries(30);
  const extra = await overviewExtras();
  return {
    ...extra,
    totalUsers,
    activeUsers,
    pendingKyc,
    pendingDeposits,
    pendingWithdrawals,
    tradingVolume30d: series.reduce((s, d) => s + d.volume, 0),
    revenue30d: series.reduce((s, d) => s + d.revenue, 0),
    includesDemoData: demoUsers > 0,
    series,
  };
}

/** Extra dashboard figures: user growth, money waiting for review, customer balances, products. */
async function overviewExtras() {
  const now = Date.now();
  const startToday = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const customer = { adminUser: null };
  let prices = { USDT: 1 };
  try {
    prices = (await getUsdtPrices()).prices;
  } catch {
    /* non-USDT values excluded */
  }
  const [newToday, new7d, verified, restricted, pendingDep, pendingWdr, balances, awaiting, leadTraders, followers, openCopy, bot, botParticipants, openBot] = await Promise.all([
    prisma.user.count({ where: { ...customer, createdAt: { gte: startToday } } }),
    prisma.user.count({ where: { ...customer, createdAt: { gte: new Date(now - 7 * 86_400_000) } } }),
    prisma.user.count({ where: { ...customer, emailVerifiedAt: { not: null } } }),
    prisma.user.count({ where: { ...customer, status: { in: ["SUSPENDED", "BANNED"] } } }),
    prisma.$queryRaw`SELECT sum(d."amount")::float AS v, a."symbol" AS symbol FROM "Deposit" d JOIN "Asset" a ON a.id = d."assetId" WHERE d."status" IN ('PENDING','CONFIRMING') GROUP BY a."symbol"`,
    prisma.$queryRaw`SELECT sum(w."amount")::float AS v, a."symbol" AS symbol FROM "Withdrawal" w JOIN "Asset" a ON a.id = w."assetId" WHERE w."status" IN ('PENDING_REVIEW','PROCESSING') GROUP BY a."symbol"`,
    prisma.$queryRaw`SELECT sum(w."available" + w."locked")::float AS v, a."symbol" AS symbol FROM "Wallet" w JOIN "Asset" a ON a.id = w."assetId" JOIN "User" u ON u.id = w."userId" LEFT JOIN "AdminUser" s ON s."userId" = u.id WHERE s.id IS NULL GROUP BY a."symbol"`,
    prisma.supportTicket.groupBy({ by: ["category"], where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, _count: { _all: true } }),
    prisma.copyTrader.count({ where: { status: "ACTIVE", deletedAt: null } }),
    prisma.copySubscription.count({ where: { status: { in: ["ACTIVE", "PAUSED"] } } }),
    prisma.copyTrade.count({ where: { status: "OPEN" } }),
    prisma.autoBotConfig.findUnique({ where: { id: "default" }, select: { status: true } }),
    prisma.autoBotParticipant.count({ where: { status: "ACTIVE" } }),
    prisma.autoBotTrade.count({ where: { status: "OPEN" } }),
  ]);
  const usdt = (rows) => rows.reduce((sum, r) => sum + (prices[r.symbol] !== undefined ? (r.v ?? 0) * prices[r.symbol] : 0), 0);
  const chats = awaiting.filter((r) => r.category === "LIVE_CHAT").reduce((a, r) => a + r._count._all, 0);
  const tickets = awaiting.reduce((a, r) => a + r._count._all, 0) - chats;
  return {
    newUsersToday: newToday,
    newUsers7d: new7d,
    verifiedUsers: verified,
    restrictedUsers: restricted,
    pendingDepositsValue: usdt(pendingDep),
    pendingWithdrawalsValue: usdt(pendingWdr),
    customerBalances: usdt(balances),
    supportAwaiting: { liveChat: chats, tickets },
    products: {
      copyTrading: { leadTraders, followers, openTrades: openCopy },
      automatedTrading: { status: bot?.status ?? "STOPPED", participants: botParticipants, openTrades: openBot },
    },
  };
}

/** Latest activity for the dashboard, limited to what the staff role may see. */
export async function recentActivity(can) {
  const take = 6;
  const [users, deposits, withdrawals, support] = await Promise.all([
    can("users.read")
      ? prisma.user.findMany({ where: { adminUser: null }, orderBy: { createdAt: "desc" }, take, select: { id: true, email: true, status: true, createdAt: true, emailVerifiedAt: true, profile: { select: { firstName: true, lastName: true, country: true } } } })
      : null,
    can("deposits.read")
      ? prisma.deposit.findMany({ orderBy: [{ createdAt: "desc" }], take, include: { user: { select: { email: true } }, asset: { select: { symbol: true } }, network: { select: { code: true } } } })
      : null,
    can("withdrawals.read")
      ? prisma.withdrawal.findMany({ orderBy: [{ createdAt: "desc" }], take, include: { user: { select: { email: true } }, asset: { select: { symbol: true } }, network: { select: { code: true } } } })
      : null,
    can("support.read")
      ? prisma.supportTicket.findMany({ orderBy: { lastMessageAt: "desc" }, take, select: { id: true, number: true, subject: true, category: true, status: true, lastMessageAt: true, user: { select: { email: true } } } })
      : null,
  ]);
  return { users, deposits, withdrawals, support };
}
