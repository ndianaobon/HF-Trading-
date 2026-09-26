import { z } from "zod";
import { route, paginationSchema, paginate, pageResult } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { depositReportSchema } from "@/lib/validation/schemas";
import { reportDeposit } from "@/lib/payments/deposit-service";
import { prisma } from "@/lib/db/prisma";

const query = z.object({ ...paginationSchema });

export const GET = route({ auth: "user", query }, async ({ session, query }) => {
  const where = { userId: session.user.id };
  const [items, total] = await Promise.all([
    prisma.deposit.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { asset: { select: { symbol: true, color: true } }, network: { select: { code: true, name: true } } },
      ...paginate(query.page, query.pageSize),
    }),
    prisma.deposit.count({ where }),
  ]);
  return pageResult(items, total, query.page, query.pageSize);
});

/** Report an on-chain deposit to a configured address (live/manual mode). */
export const POST = route({ auth: "verified", body: depositReportSchema, rateLimit: RATE_LIMITS.money }, async ({ session, body }) =>
  reportDeposit(session.user.id, body),
);
