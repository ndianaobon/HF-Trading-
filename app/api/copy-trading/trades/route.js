import { z } from "zod";
import { route, paginate, paginationSchema, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";
import { withLivePnl } from "@/lib/services/copy-stats";

const query = z.object({
  ...paginationSchema,
  status: z.enum(["PENDING", "OPEN", "CLOSED", "FAILED", "CANCELLED"]).optional(),
  subscriptionId: z.string().max(40).optional(),
});

/** The signed-in user's copy trades, newest first. */
export const GET = route({ auth: "user", query }, async ({ session, query }) => {
  const where = {
    userId: session.user.id,
    ...(query.status ? { status: query.status } : {}),
    ...(query.subscriptionId ? { subscriptionId: query.subscriptionId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.copyTrade.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...paginate(query.page, query.pageSize),
      include: { market: { select: { symbol: true, pricePrecision: true } }, trader: { select: { displayName: true, slug: true } }, signal: { select: { takeProfit: true, stopLoss: true, status: true } } },
    }),
    prisma.copyTrade.count({ where }),
  ]);
  return pageResult(await withLivePnl(rows), total, query.page, query.pageSize);
});
