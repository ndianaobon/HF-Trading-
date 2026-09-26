import { z } from "zod";
import { route, paginationSchema, paginate, pageResult } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { orderSchema } from "@/lib/validation/schemas";
import { placeOrder } from "@/lib/trading/order-service";
import { prisma } from "@/lib/db/prisma";

const query = z.object({
  status: z.enum(["open", "history", "all"]).default("all"),
  market: z.string().max(20).optional(),
  ...paginationSchema,
});

export const GET = route({ auth: "user", query }, async ({ session, query }) => {
  const where = {
    userId: session.user.id,
    ...(query.market ? { market: { symbol: query.market } } : {}),
    ...(query.status === "open"
      ? { status: { in: ["ACCEPTED", "PARTIALLY_FILLED"] } }
      : query.status === "history"
        ? { status: { in: ["FILLED", "CANCELLED", "REJECTED"] } }
        : {}),
  };
  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { market: { select: { symbol: true, pricePrecision: true, quantityPrecision: true } } },
      ...paginate(query.page, query.pageSize),
    }),
    prisma.order.count({ where }),
  ]);
  return pageResult(items, total, query.page, query.pageSize);
});

export const POST = route({ auth: "verified", body: orderSchema, rateLimit: RATE_LIMITS.orders, apiKeyScope: "trade" }, async ({ session, body, req }) => {
  const clientOrderId = body.clientOrderId ?? req.headers.get("idempotency-key") ?? undefined;
  const order = await placeOrder(session.user.id, { ...body, clientOrderId });
  return order;
});
