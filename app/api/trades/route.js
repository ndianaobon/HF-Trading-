import { z } from "zod";
import { route, paginationSchema, paginate, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

const query = z.object({ market: z.string().max(20).optional(), ...paginationSchema });

export const GET = route({ auth: "user", query }, async ({ session, query }) => {
  const where = { userId: session.user.id, ...(query.market ? { market: { symbol: query.market } } : {}) };
  const [items, total] = await Promise.all([
    prisma.trade.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { market: { select: { symbol: true, pricePrecision: true } } },
      ...paginate(query.page, query.pageSize),
    }),
    prisma.trade.count({ where }),
  ]);
  return pageResult(items, total, query.page, query.pageSize);
});
