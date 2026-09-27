import { z } from "zod";
import { route, paginate, paginationSchema, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

const query = z.object({
  ...paginationSchema,
  status: z.enum(["WATCHING", "EXECUTED", "REJECTED", "EXPIRED"]).optional(),
  symbol: z.string().max(20).optional(),
});

/** The signal log: every setup the strategy engine detected and the decision taken. */
export const GET = route({ admin: "autobot.manage", query }, async ({ query }) => {
  const where = { ...(query.status ? { status: query.status } : {}), ...(query.symbol ? { symbol: query.symbol } : {}) };
  const [rows, total] = await Promise.all([
    prisma.autoBotSignal.findMany({ where, orderBy: { updatedAt: "desc" }, ...paginate(query.page, query.pageSize), include: { market: { select: { pricePrecision: true } } } }),
    prisma.autoBotSignal.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  const trades = ids.length ? await prisma.autoBotTrade.groupBy({ by: ["signalId", "status"], where: { signalId: { in: ids } }, _count: { _all: true }, _sum: { netPnl: true } }) : [];
  const items = rows.map((s) => {
    const mine = trades.filter((t) => t.signalId === s.id);
    const count = (st) => mine.filter((t) => t.status === st).reduce((a, t) => a + t._count._all, 0);
    return {
      ...s,
      trades: { open: count("OPEN"), closed: count("CLOSED"), failed: count("FAILED"), rejected: count("REJECTED") },
      realizedPnl: mine.filter((t) => t.status === "CLOSED").reduce((a, t) => a + Number(t._sum.netPnl ?? 0), 0),
    };
  });
  return pageResult(items, total, query.page, query.pageSize);
});
