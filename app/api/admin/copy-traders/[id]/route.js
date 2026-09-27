import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { D } from "@/lib/db/decimal";
import { audit } from "@/lib/services/audit";
import { removeTrader } from "@/lib/services/copy-trading";
import { traderProfile } from "@/lib/services/copy-stats";
import { traderSchema } from "@/lib/validation/admin";

const patch = traderSchema.partial();

/** Edit profile, parameters, status (active / inactive / suspended) and whether new users can copy. */
export const PATCH = route({ admin: "copytraders.manage", body: patch }, async ({ session, params, body, ip }) => {
  const t = await prisma.copyTrader.findUnique({ where: { id: params.id } });
  if (!t || t.deletedAt) throw new AppError("NOT_FOUND");
  const min = body.minAllocation ?? t.minAllocation;
  const max = body.maxAllocation !== undefined ? body.maxAllocation || null : t.maxAllocation;
  if (max && D(max).lt(min)) throw new AppError("VALIDATION_ERROR", "Maximum copy amount must be at least the minimum.");
  if (body.slug && body.slug !== t.slug && (await prisma.copyTrader.findUnique({ where: { slug: body.slug } }))) {
    throw new AppError("CONFLICT", "That profile address (slug) is already in use.");
  }
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.copyTrader.update({ where: { id: t.id }, data: { ...body, ...(body.maxAllocation !== undefined ? { maxAllocation: max } : {}) } });
    const action = body.status && body.status !== t.status ? `copytrader.${body.status.toLowerCase()}` : "copytrader.update";
    await audit({ actorId: session.user.id, actorEmail: session.user.email, ip, action, targetType: "CopyTrader", targetId: t.id, metadata: { changes: body } }, tx);
    return u;
  });
  return traderProfile(updated);
});

/** Removes the trader: history is kept, followers are stopped and their positions closed. */
export const DELETE = route({ admin: "copytraders.manage" }, async ({ session, params, ip }) => removeTrader(params.id, { id: session.user.id, email: session.user.email, ip }));
