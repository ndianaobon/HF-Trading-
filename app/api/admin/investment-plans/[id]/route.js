import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/services/audit";
import { planSchema, assertNoGuarantees } from "@/lib/validation/admin";

const patch = planSchema.partial();

export const PATCH = route({ admin: "plans.manage", body: patch }, async ({ session, params, body, ip }) => {
  const plan = await prisma.investmentPlan.findUnique({ where: { id: params.id } });
  if (!plan) throw new AppError("NOT_FOUND");
  assertNoGuarantees([body.name ?? "", body.tagline ?? "", body.description ?? "", body.strategy ?? ""]);
  const min = Number(body.minAllocation ?? plan.minAllocation);
  const max = Number(body.maxAllocation ?? plan.maxAllocation);
  if (max < min) throw new AppError("VALIDATION_ERROR", "Maximum must be at least the minimum allocation.");
  const updated = await prisma.investmentPlan.update({ where: { id: params.id }, data: body });
  await audit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    ip,
    action: body.status === "DISABLED" ? "plan.disable" : "plan.update",
    targetType: "InvestmentPlan",
    targetId: plan.id,
    metadata: { changes: body },
  });
  return updated;
});
