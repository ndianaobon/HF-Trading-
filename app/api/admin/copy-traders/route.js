import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { D } from "@/lib/db/decimal";
import { audit } from "@/lib/services/audit";
import { traderProfile, traderStats } from "@/lib/services/copy-stats";
import { traderSchema } from "@/lib/validation/admin";

export const GET = route({ admin: "copytraders.manage" }, async () => {
  const traders = await prisma.copyTrader.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } });
  const stats = await traderStats(traders.map((t) => t.id));
  return traders.map((t) => ({ ...traderProfile(t), stats: stats.get(t.id) }));
});

/** Creates a lead trader. Performance is never entered: it is calculated from signals. */
export const POST = route({ admin: "copytraders.manage", body: traderSchema }, async ({ session, body, ip }) => {
  if (body.maxAllocation && D(body.maxAllocation).lt(body.minAllocation)) throw new AppError("VALIDATION_ERROR", "Maximum copy amount must be at least the minimum.");
  if (await prisma.copyTrader.findUnique({ where: { slug: body.slug } })) throw new AppError("CONFLICT", "That profile address (slug) is already in use.");
  const t = await prisma.copyTrader.create({ data: { ...body, maxAllocation: body.maxAllocation || null } });
  await audit({ actorId: session.user.id, actorEmail: session.user.email, ip, action: "copytrader.create", targetType: "CopyTrader", targetId: t.id, metadata: { displayName: t.displayName } });
  return traderProfile(t);
});
