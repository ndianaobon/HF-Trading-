import { z } from "zod";
import { route, paginationSchema, paginate, pageResult } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { withdrawalSchema } from "@/lib/validation/schemas";
import { requestWithdrawal } from "@/lib/payments/withdrawal-service";
import { prisma } from "@/lib/db/prisma";

const query = z.object({ ...paginationSchema });

export const GET = route({ auth: "user", query }, async ({ session, query }) => {
  const where = { userId: session.user.id };
  const [items, total] = await Promise.all([
    prisma.withdrawal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { asset: { select: { symbol: true, color: true } }, network: { select: { code: true, name: true } } },
      ...paginate(query.page, query.pageSize),
    }),
    prisma.withdrawal.count({ where }),
  ]);
  return pageResult(items, total, query.page, query.pageSize);
});

export const POST = route({ auth: "verified", body: withdrawalSchema, rateLimit: RATE_LIMITS.money }, async ({ session, body, ip }) => {
  const w = await requestWithdrawal(session.user.id, body, { ip, email: session.user.email });
  return { id: w.id, status: w.status, amount: w.amount.toString(), fee: w.fee.toString(), isDemo: w.isDemo };
});
