import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/services/audit";

const dec = z.string().regex(/^\d+(\.\d+)?$/);
const schema = z.object({
  asset: z.string().trim().min(2).max(10),
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_-]{2,20}$/, "Use 2–20 capital letters or digits, e.g. POL or TRC20."),
  name: z.string().trim().min(2).max(60),
  minDeposit: dec,
  minWithdrawal: dec,
  withdrawalFee: dec,
  confirmations: z.number().int().min(1).max(1000),
  processingTime: z.string().trim().max(80).optional(),
  addressPattern: z.string().trim().max(200).optional(),
  memoRequired: z.boolean().optional(),
});

/** Adds a funding network to an asset (e.g. USDT on Polygon) so addresses can be registered for it. */
export const POST = route({ admin: "settings.manage", body: schema }, async ({ session, body, ip }) => {
  const asset = await prisma.asset.findUnique({ where: { symbol: body.asset.toUpperCase() } });
  if (!asset) throw new AppError("NOT_FOUND", "Unknown asset.");
  if (body.addressPattern) {
    try {
      new RegExp(body.addressPattern);
    } catch {
      throw new AppError("VALIDATION_ERROR", "Address pattern is not a valid regular expression.");
    }
  }
  if (await prisma.network.findUnique({ where: { assetId_code: { assetId: asset.id, code: body.code } } }))
    throw new AppError("CONFLICT", `${asset.symbol} already has a ${body.code} network.`);
  const row = await prisma.network.create({
    data: {
      assetId: asset.id,
      code: body.code,
      name: body.name,
      minDeposit: body.minDeposit,
      minWithdrawal: body.minWithdrawal,
      withdrawalFee: body.withdrawalFee,
      confirmations: body.confirmations,
      processingTime: body.processingTime || null,
      addressPattern: body.addressPattern || null,
      memoRequired: body.memoRequired ?? false,
    },
  });
  await audit({ actorId: session.user.id, actorEmail: session.user.email, ip, action: "network.create", targetType: "Network", targetId: row.id, metadata: body });
  return { id: row.id };
});
