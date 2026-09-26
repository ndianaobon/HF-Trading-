import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { totpSchema } from "@/lib/validation/schemas";
import { generateBackupCodes, verifySecondFactor } from "@/lib/auth/totp";
import { prisma } from "@/lib/db/prisma";
import { notify } from "@/lib/notifications/service";
import { audit } from "@/lib/services/audit";

export const POST = route({ auth: "user", body: totpSchema, rateLimit: RATE_LIMITS.auth }, async ({ session, body, ip }) => {
  const record = await prisma.twoFactorAuth.findUnique({ where: { userId: session.user.id } });
  if (!record) throw new AppError("CONFLICT", "Start setup first.");
  if (record.enabled) throw new AppError("CONFLICT", "Two-factor authentication is already enabled.");
  if (!(await verifySecondFactor(session.user.id, body.code, { allowDisabled: true }))) throw new AppError("INVALID_2FA_CODE");

  const { plain, hashed } = await generateBackupCodes();
  await prisma.$transaction([
    prisma.twoFactorAuth.update({ where: { userId: session.user.id }, data: { enabled: true, enabledAt: new Date(), backupCodes: hashed } }),
    prisma.session.updateMany({ where: { id: session.id }, data: { mfaVerified: true } }),
  ]);
  await audit({ actorId: session.user.id, actorEmail: session.user.email, action: "security.2fa.enable", targetType: "User", targetId: session.user.id, ip });
  await notify({
    userId: session.user.id,
    type: "SECURITY_ALERT",
    title: "Two-factor authentication enabled",
    body: "Your account now requires an authenticator code to sign in.",
  });
  return { enabled: true, backupCodes: plain };
});
