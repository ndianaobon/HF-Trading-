import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/services/audit";
import { traderSchema } from "@/lib/validation/admin";

const patch = traderSchema.partial().extend({ isActive: z.boolean().optional() });

export const PATCH = route({ admin: "copytraders.manage", body: patch }, async ({ session, params, body, ip }) => {
  const t = await prisma.copyTrader.findUnique({ where: { id: params.id } });
  if (!t) throw new AppError("NOT_FOUND");
  await prisma.copyTrader.update({ where: { id: params.id }, data: body });
  await audit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    ip,
    action: body.isActive === false ? "copytrader.disable" : "copytrader.update",
    targetType: "CopyTrader",
    targetId: t.id,
    metadata: { changes: body },
  });
  return { ok: true };
});
