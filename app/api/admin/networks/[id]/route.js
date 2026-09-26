import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/services/audit";

const dec = z.string().regex(/^\d+(\.\d+)?$/);
const patch = z.object({
  minDeposit: dec.optional(),
  minWithdrawal: dec.optional(),
  withdrawalFee: dec.optional(),
  confirmations: z.number().int().min(1).max(1000).optional(),
  processingTime: z.string().trim().max(80).nullable().optional(),
  depositEnabled: z.boolean().optional(),
  withdrawEnabled: z.boolean().optional(),
});

export const PATCH = route({ admin: "settings.manage", body: patch }, async ({ session, params, body, ip }) => {
  const before = await prisma.network.findUnique({ where: { id: params.id } });
  if (!before) throw new AppError("NOT_FOUND");
  const updated = await prisma.network.update({
    where: { id: params.id },
    data: { ...body, processingTime: body.processingTime === "" ? null : body.processingTime },
  });
  await audit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    ip,
    action: "network.update",
    targetType: "Network",
    targetId: params.id,
    metadata: { changes: body },
  });
  return { id: updated.id };
});
