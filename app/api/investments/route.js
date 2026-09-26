import { route } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { investSchema } from "@/lib/validation/schemas";
import { subscribeToPlan } from "@/lib/services/investments";
import { prisma } from "@/lib/db/prisma";

export const GET = route({ auth: "user" }, async ({ session }) =>
  prisma.investmentSubscription.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      plan: {
        select: {
          id: true,
          name: true,
          slug: true,
          riskLevel: true,
          durationDays: true,
          earlyExitAllowed: true,
          earlyExitFeePct: true,
          managementFeePct: true,
          performanceFeePct: true,
        },
      },
    },
  }),
);

export const POST = route({ auth: "verified", body: investSchema, rateLimit: RATE_LIMITS.money }, async ({ session, body }) =>
  subscribeToPlan(session.user.id, body),
);
