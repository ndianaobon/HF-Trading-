import { z } from "zod";
import { route, paginationSchema, paginate, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

const query = z.object({
  view: z.enum(["trades", "orders"]).default("trades"),
  market: z.string().trim().max(20).transform((s) => s.toUpperCase()).optional(),
  status: z.enum(["CREATED", "VALIDATED", "ACCEPTED", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED"]).optional(),
  q: z.string().max(80).optional(),
  ...paginationSchema,
});

export const GET = route({ admin: "trades.read", query }, async ({ query }) => {
  const userFilter = query.q ? { user: { email: { contains: query.q, mode: "insensitive" } } } : {};
  const marketFilter = query.market ? { market: { symbol: query.market } } : {};
  if (query.view === "orders") {
    const where = { ...userFilter, ...marketFilter, ...(query.status ? { status: query.status } : {}) };
    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { email: true } }, market: { select: { symbol: true } } },
        ...paginate(query.page, query.pageSize),
      }),
      prisma.order.count({ where }),
    ]);
    return pageResult(items, total, query.page, query.pageSize);
  }
  const where = { ...userFilter, ...marketFilter };
  const [items, total] = await Promise.all([
    prisma.trade.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { email: true } }, market: { select: { symbol: true } } },
      ...paginate(query.page, query.pageSize),
    }),
    prisma.trade.count({ where }),
  ]);
  return pageResult(items, total, query.page, query.pageSize);
});
