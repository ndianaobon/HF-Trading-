import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { changePasswordSchema } from "@/lib/validation/schemas";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import { notify } from "@/lib/notifications/service";
import { emails } from "@/lib/email/mailer";

export const POST = route({ auth: "user", body: changePasswordSchema, rateLimit: RATE_LIMITS.auth }, async ({ session, body, ip }) => {
  if (!(await verifyPassword(session.user.passwordHash, body.currentPassword))) {
    throw new AppError("INVALID_CREDENTIALS", "Current password is incorrect.");
  }
  await prisma.user.update({ where: { id: session.user.id }, data: { passwordHash: await hashPassword(body.newPassword), passwordChangedAt: new Date() } });
  // Keep this session, sign out everywhere else.
  await revokeAllSessions(session.user.id, session.id);
  await notify({
    userId: session.user.id,
    type: "SECURITY_ALERT",
    title: "Password changed",
    body: `Your password was changed from IP ${ip}. Other sessions were signed out.`,
  });
  void emails.securityAlert(session.user.email, "Your password was changed", "If you did not make this change, reset your password and contact support.");
  return { changed: true };
});
