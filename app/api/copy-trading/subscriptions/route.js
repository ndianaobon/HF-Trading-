import { route } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { copySchema } from "@/lib/validation/schemas";
import { startCopying } from "@/lib/services/copy-trading";
import { prisma } from "@/lib/db/prisma";

export const GET = route({ auth: "user" }, async ({ session }) =>
  prisma.copySubscription.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { trader: { select: { id: true, slug: true, displayName: true, avatarColor: true, riskLevel: true, strategy: true, isDemo: true } } },
  }),
);

export const POST = route({ auth: "verified", body: copySchema, rateLimit: RATE_LIMITS.money }, async ({ session, body }) =>
  startCopying(session.user.id, body.traderId, { allocation: body.allocation, maxAllocation: body.maxAllocation, stopLossPct: body.stopLossPct }),
);
