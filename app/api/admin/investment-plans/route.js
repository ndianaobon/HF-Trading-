import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/services/audit";
import { planSchema, assertNoGuarantees } from "@/lib/validation/admin";

export const GET = route({ admin: "plans.manage" }, async () => {
  const [plans, stats] = await Promise.all([
    prisma.investmentPlan.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.investmentSubscription.groupBy({ by: ["planId", "status"], _sum: { amount: true }, _count: { _all: true } }),
  ]);
  return plans.map((p) => {
    const s = stats.filter((x) => x.planId === p.id);
    return {
      ...p,
      activeCount: s.filter((x) => x.status === "ACTIVE").reduce((a, x) => a + x._count._all, 0),
      pendingCount: s.filter((x) => x.status === "PENDING").reduce((a, x) => a + x._count._all, 0),
      allocated: s.filter((x) => x.status === "ACTIVE" || x.status === "PENDING").reduce((a, x) => a + (x._sum.amount?.toNumber() ?? 0), 0),
    };
  });
});

export const POST = route({ admin: "plans.manage", body: planSchema }, async ({ session, body, ip }) => {
  assertNoGuarantees([body.name, body.tagline, body.description, body.strategy]);
  if (Number(body.maxAllocation) < Number(body.minAllocation)) throw new AppError("VALIDATION_ERROR", "Maximum must be at least the minimum allocation.");
  const usdt = await prisma.asset.findUniqueOrThrow({ where: { symbol: "USDT" } });
  const plan = await prisma.investmentPlan.create({ data: { ...body, assetId: usdt.id } });
  await audit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    ip,
    action: "plan.create",
    targetType: "InvestmentPlan",
    targetId: plan.id,
    metadata: { name: plan.name },
  });
  return plan;
});
