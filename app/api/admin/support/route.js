import { z } from "zod";
import { route, paginationSchema, paginate, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

const query = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"]).optional(),
  category: z.string().max(20).optional(),
  q: z.string().max(80).optional(),
  ...paginationSchema,
});

export const GET = route({ admin: "support.read", query }, async ({ query }) => {
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.q ? { OR: [{ subject: { contains: query.q, mode: "insensitive" } }, { user: { email: { contains: query.q, mode: "insensitive" } } }] } : {}),
  };
  const [items, total, counts] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      include: { user: { select: { email: true } }, assignedTo: { select: { email: true } }, _count: { select: { messages: true } } },
      ...paginate(query.page, query.pageSize),
    }),
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return { ...pageResult(items, total, query.page, query.pageSize), counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
});
