import { z } from "zod";
import { route, paginate, paginationSchema, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";
import { withLive } from "@/lib/autobot/stats";

const query = z.object({ ...paginationSchema, status: z.enum(["OPEN", "CLOSED", "FAILED", "REJECTED"]).optional() });

/** The signed-in user's automated trades, newest first. */
export const GET = route({ auth: "user", query }, async ({ session, query }) => {
  const where = { userId: session.user.id, ...(query.status ? { status: query.status } : {}) };
  const [rows, total] = await Promise.all([
    prisma.autoBotTrade.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...paginate(query.page, query.pageSize),
      include: { market: { select: { symbol: true, pricePrecision: true } }, signal: { select: { strategy: true, timeframes: true, conditions: true, riskReward: true } } },
    }),
    prisma.autoBotTrade.count({ where }),
  ]);
  return pageResult(await withLive(rows), total, query.page, query.pageSize);
});
