import { z } from "zod";
import { route, paginate, paginationSchema, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";
import { withLivePnl } from "@/lib/services/copy-stats";

const query = z.object({
  ...paginationSchema,
  traderId: z.string().max(40).optional(),
  signalId: z.string().max(40).optional(),
  status: z.enum(["PENDING", "OPEN", "CLOSED", "FAILED", "CANCELLED", "PROFIT", "LOSS"]).optional(),
  q: z.string().trim().max(100).optional(),
});

export const GET = route({ admin: "copytraders.manage", query }, async ({ query }) => {
  const status =
    query.status === "PROFIT"
      ? { status: "CLOSED", netPnl: { gt: 0 } }
      : query.status === "LOSS"
        ? { status: "CLOSED", netPnl: { lt: 0 } }
        : query.status
          ? { status: query.status }
          : {};
  const where = {
    ...status,
    ...(query.traderId ? { traderId: query.traderId } : {}),
    ...(query.signalId ? { signalId: query.signalId } : {}),
    ...(query.q ? { user: { email: { contains: query.q, mode: "insensitive" } } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.copyTrade.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...paginate(query.page, query.pageSize),
      include: { market: { select: { symbol: true, pricePrecision: true } }, trader: { select: { displayName: true } }, user: { select: { id: true, email: true } } },
    }),
    prisma.copyTrade.count({ where }),
  ]);
  return pageResult(await withLivePnl(rows), total, query.page, query.pageSize);
});
