import { z } from "zod";
import { route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

const query = z.object({
  risk: z.enum(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]).optional(),
  strategy: z.string().max(40).optional(),
  asset: z.string().max(10).optional(),
});

export const GET = route({ auth: "none", query }, async ({ query }) => {
  const where = {
    isActive: true,
    ...(query.risk ? { riskLevel: query.risk } : {}),
    ...(query.strategy ? { strategyTags: { has: query.strategy } } : {}),
    ...(query.asset ? { assets: { has: query.asset.toUpperCase() } } : {}),
  };
  const traders = await prisma.copyTrader.findMany({ where, orderBy: { followers: "desc" } });
  // Series is trimmed to ~60 points for card sparklines; full series on the profile.
  return traders.map(({ recentTrades: _r, performanceSeries, ...t }) => {
    const s = performanceSeries;
    const step = Math.max(1, Math.floor(s.length / 60));
    return { ...t, sparkline: s.filter((_, i) => i % step === 0).map((p) => p.v) };
  });
});
