import { z } from "zod";
import { route, paginate, paginationSchema, pageResult } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { ZERO } from "@/lib/db/decimal";
import { joinBot } from "@/lib/autobot/engine";

const query = z.object({ ...paginationSchema, status: z.enum(["ACTIVE", "PAUSED", "STOPPED"]).optional(), q: z.string().trim().max(100).optional() });

export const GET = route({ admin: "autobot.manage", query }, async ({ query }) => {
  const where = { ...(query.status ? { status: query.status } : {}), ...(query.q ? { user: { email: { contains: query.q, mode: "insensitive" } } } : {}) };
  const [rows, total] = await Promise.all([
    prisma.autoBotParticipant.findMany({
      where,
      orderBy: { joinedAt: "desc" },
      ...paginate(query.page, query.pageSize),
      include: { user: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } } },
    }),
    prisma.autoBotParticipant.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  const trades = ids.length ? await prisma.autoBotTrade.groupBy({ by: ["participantId", "status"], where: { participantId: { in: ids } }, _count: { _all: true }, _sum: { netPnl: true } }) : [];
  const items = rows.map((p) => {
    const mine = trades.filter((t) => t.participantId === p.id);
    const count = (st) => mine.filter((t) => t.status === st).reduce((a, t) => a + t._count._all, 0);
    return { ...p, openTrades: count("OPEN"), closedTrades: count("CLOSED"), realizedPnl: Number(mine.find((t) => t.status === "CLOSED")?._sum.netPnl ?? ZERO) };
  });
  return pageResult(items, total, query.page, query.pageSize);
});

/** Enrol a user by email. */
export const POST = route({ admin: "autobot.manage", body: z.object({ email: z.string().trim().email() }) }, async ({ session, body, ip }) => {
  const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (!user) throw new AppError("NOT_FOUND", "No account with that email.");
  if (user.status !== "ACTIVE") throw new AppError("CONFLICT", "Only active accounts can be enrolled.");
  return joinBot(user.id, { byAdmin: { id: session.user.id, email: session.user.email, ip } });
});
