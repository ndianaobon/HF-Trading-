import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { totpSchema } from "@/lib/validation/schemas";
import { verifySecondFactor } from "@/lib/auth/totp";
import { prisma } from "@/lib/db/prisma";
import { notify } from "@/lib/notifications/service";
import { emails } from "@/lib/email/mailer";
import { audit } from "@/lib/services/audit";

export const POST = route({ auth: "user", body: totpSchema, rateLimit: RATE_LIMITS.auth }, async ({ session, body, ip }) => {
  if (!session.user.twoFactor?.enabled) throw new AppError("CONFLICT", "Two-factor authentication is not enabled.");
  if (!(await verifySecondFactor(session.user.id, body.code))) throw new AppError("INVALID_2FA_CODE");
  await prisma.twoFactorAuth.delete({ where: { userId: session.user.id } });
  await audit({ actorId: session.user.id, actorEmail: session.user.email, action: "security.2fa.disable", targetType: "User", targetId: session.user.id, ip });
  await notify({
    userId: session.user.id,
    type: "SECURITY_ALERT",
    title: "Two-factor authentication disabled",
    body: `2FA was turned off from IP ${ip}. We strongly recommend keeping it enabled.`,
  });
  void emails.securityAlert(session.user.email, "Two-factor authentication was disabled", "If you did not make this change, secure your account immediately.");
  return { enabled: false };
});
