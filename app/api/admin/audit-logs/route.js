import { z } from "zod";
import { route, paginationSchema, paginate, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

const query = z.object({
  q: z.string().max(80).optional(),
  action: z.string().max(60).optional(),
  targetType: z.string().max(40).optional(),
  ...paginationSchema,
});

export const GET = route({ admin: "audit.read", query }, async ({ query }) => {
  const where = {
    ...(query.action ? { action: { startsWith: query.action } } : {}),
    ...(query.targetType ? { targetType: query.targetType } : {}),
    ...(query.q ? { OR: [{ actorEmail: { contains: query.q, mode: "insensitive" } }, { targetId: query.q }, { action: { contains: query.q } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, ...paginate(query.page, query.pageSize) }),
    prisma.auditLog.count({ where }),
  ]);
  return pageResult(items, total, query.page, query.pageSize);
});
