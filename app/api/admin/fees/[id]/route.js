import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/services/audit";
import { invalidateFeeCache } from "@/lib/trading/fees";

const patch = z.object({ rate: z.string().regex(/^0(\.\d{1,8})?$/, "Rate must be a fraction between 0 and 1, e.g. 0.001") });

export const PATCH = route({ admin: "markets.manage", body: patch }, async ({ session, params, body, ip }) => {
  const fee = await prisma.feeConfiguration.findUnique({ where: { id: params.id } });
  if (!fee) throw new AppError("NOT_FOUND");
  if (Number(body.rate) > 0.02) throw new AppError("VALIDATION_ERROR", "Trading fees above 2% are not allowed.");
  await prisma.feeConfiguration.update({ where: { id: params.id }, data: { rate: body.rate } });
  invalidateFeeCache();
  await audit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    ip,
    action: "fee.update",
    targetType: "FeeConfiguration",
    targetId: fee.id,
    metadata: { type: fee.type, from: fee.rate.toString(), to: body.rate },
  });
  return { ok: true };
});
