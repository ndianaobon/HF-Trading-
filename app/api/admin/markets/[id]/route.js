import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/services/audit";
import { invalidateMarketCache } from "@/lib/market-data/service";

const patch = z.object({
  status: z.enum(["ACTIVE", "HALTED", "DELISTED"]).optional(),
  isFeatured: z.boolean().optional(),
  minNotional: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
});

export const PATCH = route({ admin: "markets.manage", body: patch }, async ({ session, params, body, ip }) => {
  const m = await prisma.market.findUnique({ where: { id: params.id } });
  if (!m) throw new AppError("NOT_FOUND");
  await prisma.market.update({ where: { id: params.id }, data: body });
  invalidateMarketCache();
  await audit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    ip,
    action: "market.update",
    targetType: "Market",
    targetId: m.id,
    metadata: { symbol: m.symbol, changes: body },
  });
  return { ok: true };
});
