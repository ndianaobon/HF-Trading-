import { z } from "zod";
import { route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";
import { traderProfile, traderStats } from "@/lib/services/copy-stats";

const query = z.object({
  risk: z.enum(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]).optional(),
  strategy: z.string().max(40).optional(),
  asset: z.string().max(10).optional(),
});

/** Lead traders open to the public. Statistics are calculated from recorded signals. */
export const GET = route({ auth: "none", query }, async ({ query }) => {
  const where = {
    status: "ACTIVE",
    deletedAt: null,
    ...(query.risk ? { riskLevel: query.risk } : {}),
    ...(query.strategy ? { strategyTags: { has: query.strategy } } : {}),
    ...(query.asset ? { assets: { has: query.asset.toUpperCase() } } : {}),
  };
  const traders = await prisma.copyTrader.findMany({ where, orderBy: { createdAt: "asc" } });
  const stats = await traderStats(traders.map((t) => t.id));
  return traders.map((t) => ({ ...traderProfile(t), stats: stats.get(t.id) }));
});
