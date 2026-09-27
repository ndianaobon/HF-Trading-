import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { storeUpload } from "@/lib/storage";
import { audit } from "@/lib/services/audit";
import { traderProfile } from "@/lib/services/copy-stats";

const MAX_BYTES = 2 * 1024 * 1024;

async function trader(id) {
  const t = await prisma.copyTrader.findUnique({ where: { id } });
  if (!t || t.deletedAt) throw new AppError("NOT_FOUND");
  return t;
}

/** Upload a profile image (JPG, PNG or WEBP, up to 2 MB). */
export const POST = route({ admin: "copytraders.manage" }, async ({ session, params, req, ip }) => {
  const t = await trader(params.id);
  let form;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Upload an image file.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") throw new AppError("VALIDATION_ERROR", "Upload an image file.");
  if (!file.type.startsWith("image/")) throw new AppError("VALIDATION_ERROR", "Only JPG, PNG or WEBP images are accepted.");
  if (file.size > MAX_BYTES) throw new AppError("VALIDATION_ERROR", "Images must be 2 MB or smaller.");
  const stored = await storeUpload(`traders/${t.id}`, file);
  const updated = await prisma.copyTrader.update({ where: { id: t.id }, data: { avatarKey: stored.key } });
  await audit({ actorId: session.user.id, actorEmail: session.user.email, ip, action: "copytrader.avatar", targetType: "CopyTrader", targetId: t.id });
  return traderProfile(updated);
});

export const DELETE = route({ admin: "copytraders.manage" }, async ({ session, params, ip }) => {
  const t = await trader(params.id);
  const updated = await prisma.copyTrader.update({ where: { id: t.id }, data: { avatarKey: null } });
  await audit({ actorId: session.user.id, actorEmail: session.user.email, ip, action: "copytrader.avatar.remove", targetType: "CopyTrader", targetId: t.id });
  return traderProfile(updated);
});
