import { route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

/** Copy-trading totals for the admin dashboard, from recorded signals and trades. */
export const GET = route({ admin: "copytraders.manage" }, async () => {
  const [traders, signals, subs, trades, profitable, losing] = await Promise.all([
    prisma.copyTrader.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.copySignal.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.copySubscription.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.copyTrade.groupBy({ by: ["status"], _count: { _all: true }, _sum: { netPnl: true } }),
    prisma.copyTrade.count({ where: { status: "CLOSED", netPnl: { gt: 0 } } }),
    prisma.copyTrade.count({ where: { status: "CLOSED", netPnl: { lt: 0 } } }),
  ]);
  const by = (rows) => Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  return {
    traders: by(traders),
    signals: by(signals),
    followers: by(subs),
    trades: { ...by(trades), PROFIT: profitable, LOSS: losing },
    realizedPnl: Number(trades.find((t) => t.status === "CLOSED")?._sum.netPnl ?? 0),
  };
});
