import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { cancelOrder } from "@/lib/trading/order-service";
import { prisma } from "@/lib/db/prisma";

export const GET = route({ auth: "user" }, async ({ session, params }) => {
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { market: { select: { symbol: true } }, events: { orderBy: { createdAt: "asc" } }, trades: { orderBy: { createdAt: "asc" } } },
  });
  if (!order || order.userId !== session.user.id) throw new AppError("NOT_FOUND");
  return order;
});

export const DELETE = route({ auth: "user", rateLimit: RATE_LIMITS.orders, apiKeyScope: "trade" }, async ({ session, params }) =>
  cancelOrder(session.user.id, params.id),
);
