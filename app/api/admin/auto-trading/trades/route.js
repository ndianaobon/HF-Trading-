import { z } from "zod";
import { route, paginate, paginationSchema, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";
import { withLive } from "@/lib/autobot/stats";

const query = z.object({
  ...paginationSchema,
  status: z.enum(["OPEN", "CLOSED", "FAILED", "REJECTED", "PROFIT", "LOSS"]).optional(),
  symbol: z.string().max(20).optional(),
  q: z.string().trim().max(100).optional(),
});

export const GET = route({ admin: "autobot.manage", query }, async ({ query }) => {
  const status =
    query.status === "PROFIT" ? { status: "CLOSED", netPnl: { gt: 0 } } : query.status === "LOSS" ? { status: "CLOSED", netPnl: { lt: 0 } } : query.status ? { status: query.status } : {};
  const where = {
    ...status,
    ...(query.symbol ? { market: { symbol: query.symbol } } : {}),
    ...(query.q ? { user: { email: { contains: query.q, mode: "insensitive" } } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.autoBotTrade.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...paginate(query.page, query.pageSize),
      include: { market: { select: { symbol: true, pricePrecision: true } }, user: { select: { id: true, email: true } }, signal: { select: { strategy: true, timeframes: true } } },
    }),
    prisma.autoBotTrade.count({ where }),
  ]);
  return pageResult(await withLive(rows), total, query.page, query.pageSize);
});
