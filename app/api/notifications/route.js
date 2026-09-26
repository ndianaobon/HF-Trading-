import { z } from "zod";
import { route, paginationSchema, paginate, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

const query = z.object({ filter: z.enum(["all", "unread"]).default("all"), ...paginationSchema });

export const GET = route({ auth: "user", query }, async ({ session, query }) => {
  const where = { userId: session.user.id, ...(query.filter === "unread" ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, ...paginate(query.page, query.pageSize) }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: session.user.id, readAt: null } }),
  ]);
  return { ...pageResult(items, total, query.page, query.pageSize), unread };
});

const markSchema = z.object({ ids: z.array(z.string().max(40)).max(200).optional(), all: z.boolean().optional() });

export const POST = route({ auth: "user", body: markSchema }, async ({ session, body }) => {
  const { count } = await prisma.notification.updateMany({
    where: { userId: session.user.id, readAt: null, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) },
    data: { readAt: new Date() },
  });
  return { marked: count };
});
