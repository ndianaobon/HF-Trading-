import { z } from "zod";
import { route, paginationSchema, paginate, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

const query = z.object({
  status: z.enum(["PENDING_REVIEW", "PROCESSING", "COMPLETED", "REJECTED", "FAILED", "CANCELLED"]).optional(),
  q: z.string().max(128).optional(),
  ...paginationSchema,
});

export const GET = route({ admin: "withdrawals.read", query }, async ({ query }) => {
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { address: { contains: query.q } },
            { id: query.q },
            { txHash: { contains: query.q } },
            { user: { email: { contains: query.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.withdrawal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, email: true } },
        asset: { select: { symbol: true, color: true } },
        network: { select: { code: true, name: true } },
        reviewedBy: { select: { email: true } },
      },
      ...paginate(query.page, query.pageSize),
    }),
    prisma.withdrawal.count({ where }),
  ]);
  return pageResult(items, total, query.page, query.pageSize);
});
