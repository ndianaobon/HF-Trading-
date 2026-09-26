import { route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";
import { isDemoMode } from "@/lib/config";
import { audit } from "@/lib/services/audit";
import { traderSchema } from "@/lib/validation/admin";

export const GET = route({ admin: "copytraders.manage" }, async () => {
  const [traders, subs] = await Promise.all([
    prisma.copyTrader.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.copySubscription.groupBy({ by: ["traderId", "status"], _sum: { allocation: true }, _count: { _all: true } }),
  ]);
  return traders.map(({ performanceSeries: _p, recentTrades: _r, ...t }) => {
    const s = subs.filter((x) => x.traderId === t.id && x.status !== "STOPPED");
    return { ...t, copiers: s.reduce((a, x) => a + x._count._all, 0), copiedAllocation: s.reduce((a, x) => a + (x._sum.allocation?.toNumber() ?? 0), 0) };
  });
});

/**
 * Creates a trader profile. Performance statistics start empty and must be
 * populated from verified trading records — never entered as marketing copy.
 */
export const POST = route({ admin: "copytraders.manage", body: traderSchema }, async ({ session, body, ip }) => {
  const t = await prisma.copyTrader.create({
    data: {
      ...body,
      aum: 0,
      followers: 0,
      maxDrawdownPct: 0,
      winRatePct: 0,
      tradesPerWeek: 0,
      returns: {},
      performanceSeries: [],
      recentTrades: [],
      isDemo: isDemoMode(),
      isActive: false,
    },
  });
  await audit({ actorId: session.user.id, actorEmail: session.user.email, ip, action: "copytrader.create", targetType: "CopyTrader", targetId: t.id });
  return t;
});
