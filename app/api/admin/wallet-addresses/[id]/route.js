import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/services/audit";

const patch = z.object({ isActive: z.boolean() });

export const PATCH = route({ admin: "settings.manage", body: patch }, async ({ session, params, body, ip }) => {
  const { count } = await prisma.walletAddress.updateMany({ where: { id: params.id }, data: { isActive: body.isActive } });
  if (!count) throw new AppError("NOT_FOUND");
  await audit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    ip,
    action: body.isActive ? "wallet_address.enable" : "wallet_address.disable",
    targetType: "WalletAddress",
    targetId: params.id,
  });
  return { ok: true };
});
