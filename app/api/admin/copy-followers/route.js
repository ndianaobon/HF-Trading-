import { z } from "zod";
import { route, paginate, paginationSchema, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

const query = z.object({
  ...paginationSchema,
  traderId: z.string().max(40).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "SUSPENDED", "STOPPED"]).optional(),
  q: z.string().trim().max(100).optional(),
});

export const GET = route({ admin: "copytraders.manage", query }, async ({ query }) => {
  const where = {
    ...(query.traderId ? { traderId: query.traderId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.q ? { user: { email: { contains: query.q, mode: "insensitive" } } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.copySubscription.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...paginate(query.page, query.pageSize),
      include: {
        user: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
        trader: { select: { displayName: true, avatarColor: true } },
      },
    }),
    prisma.copySubscription.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  const trades = ids.length ? await prisma.copyTrade.groupBy({ by: ["subscriptionId", "status"], where: { subscriptionId: { in: ids } }, _count: { _all: true } }) : [];
  const items = rows.map((s) => {
    const n = (st) => trades.filter((t) => t.subscriptionId === s.id && t.status === st).reduce((a, t) => a + t._count._all, 0);
    return { ...s, openTrades: n("OPEN"), closedTrades: n("CLOSED"), failedTrades: n("FAILED") };
  });
  return pageResult(items, total, query.page, query.pageSize);
});
