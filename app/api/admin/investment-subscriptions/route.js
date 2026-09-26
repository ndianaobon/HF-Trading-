import { z } from "zod";
import { route, paginationSchema, paginate, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

const query = z.object({ status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "CANCELLED"]).optional(), planId: z.string().optional(), ...paginationSchema });

export const GET = route({ admin: "plans.manage", query }, async ({ query }) => {
  const where = { ...(query.status ? { status: query.status } : {}), ...(query.planId ? { planId: query.planId } : {}) };
  const [items, total] = await Promise.all([
    prisma.investmentSubscription.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { email: true } }, plan: { select: { name: true, durationDays: true } } },
      ...paginate(query.page, query.pageSize),
    }),
    prisma.investmentSubscription.count({ where }),
  ]);
  return pageResult(items, total, query.page, query.pageSize);
});
