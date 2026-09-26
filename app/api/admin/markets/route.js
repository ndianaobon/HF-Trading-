import { route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

export const GET = route({ admin: "trades.read" }, async () => {
  const [markets, fees, volumes] = await Promise.all([
    prisma.market.findMany({ orderBy: { sortOrder: "asc" }, include: { baseAsset: { select: { symbol: true, name: true, color: true } } } }),
    prisma.feeConfiguration.findMany({ where: { type: { in: ["TRADING_MAKER", "TRADING_TAKER"] } }, orderBy: { createdAt: "asc" } }),
    prisma.trade.groupBy({
      by: ["marketId"],
      _sum: { quoteQuantity: true },
      _count: { _all: true },
      where: { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    }),
  ]);
  const vol = new Map(volumes.map((v) => [v.marketId, v]));
  return {
    markets: markets.map((m) => ({
      id: m.id,
      symbol: m.symbol,
      name: m.baseAsset.name,
      color: m.baseAsset.color,
      status: m.status,
      isFeatured: m.isFeatured,
      minNotional: m.minNotional.toString(),
      minQuantity: m.minQuantity.toString(),
      categories: m.categories,
      volume30d: vol.get(m.id)?._sum.quoteQuantity?.toString() ?? "0",
      trades30d: vol.get(m.id)?._count._all ?? 0,
    })),
    fees: fees.map((f) => ({ id: f.id, type: f.type, rate: f.rate.toString(), marketId: f.marketId, assetId: f.assetId, isActive: f.isActive, note: f.note })),
  };
});
