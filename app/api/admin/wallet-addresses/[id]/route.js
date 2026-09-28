import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/services/audit";

/** Toggle an address, or edit its address / memo / label / assignment. Empty memo, label or email clears it. */
const patch = z
  .object({
    isActive: z.boolean().optional(),
    address: z.string().trim().min(10).max(128).optional(),
    memo: z.string().trim().max(64).optional(),
    label: z.string().trim().max(80).optional(),
    userEmail: z.union([z.string().email(), z.literal("")]).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Nothing to update");

const FIELDS = ["isActive", "address", "memo", "label", "userId"];

export const PATCH = route({ admin: "settings.manage", body: patch }, async ({ session, params, body, ip }) => {
  const row = await prisma.walletAddress.findUnique({ where: { id: params.id }, include: { network: true } });
  if (!row) throw new AppError("NOT_FOUND");
  if (body.address && row.network.addressPattern && !new RegExp(row.network.addressPattern).test(body.address)) throw new AppError("INVALID_ADDRESS");

  const data = {};
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.address !== undefined) data.address = body.address;
  if (body.memo !== undefined) data.memo = body.memo || null;
  if (body.label !== undefined) data.label = body.label || null;
  if (body.userEmail !== undefined) {
    if (!body.userEmail) data.userId = null;
    else {
      const u = await prisma.user.findUnique({ where: { email: body.userEmail.toLowerCase() } });
      if (!u) throw new AppError("NOT_FOUND", "No user with that email.");
      data.userId = u.id;
    }
  }
  const changes = Object.fromEntries(FIELDS.filter((k) => k in data && data[k] !== row[k]).map((k) => [k, { from: row[k], to: data[k] }]));
  if (!Object.keys(changes).length) return { ok: true, changed: 0 };

  await prisma.walletAddress.update({ where: { id: row.id }, data });
  const onlyToggle = Object.keys(changes).length === 1 && "isActive" in changes;
  await audit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    ip,
    action: onlyToggle ? (data.isActive ? "wallet_address.enable" : "wallet_address.disable") : "wallet_address.update",
    targetType: "WalletAddress",
    targetId: row.id,
    metadata: onlyToggle ? undefined : { changes },
  });
  return { ok: true, changed: Object.keys(changes).length };
});
