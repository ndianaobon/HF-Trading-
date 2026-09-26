import { route } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { resetPasswordSchema } from "@/lib/validation/schemas";
import { prisma } from "@/lib/db/prisma";
import { consumeToken } from "@/lib/auth/tokens";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import { notify } from "@/lib/notifications/service";
import { emails } from "@/lib/email/mailer";

export const POST = route({ auth: "none", body: resetPasswordSchema, rateLimit: RATE_LIMITS.auth }, async ({ body, ip }) => {
  const userId = await consumeToken(body.token, "PASSWORD_RESET");
  const user = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(body.password), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
  });
  await revokeAllSessions(userId);
  await notify({ userId, type: "SECURITY_ALERT", title: "Password changed", body: `Your password was reset from IP ${ip}. All sessions were signed out.` });
  void emails.securityAlert(
    user.email,
    "Your password was changed",
    "Your HarborFinance password was reset and all sessions were signed out. If this wasn't you, contact support immediately.",
  );
  return { reset: true };
});
