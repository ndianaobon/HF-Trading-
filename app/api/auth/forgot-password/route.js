import { route } from "@/lib/api/route";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/security/rate-limit";
import { forgotPasswordSchema } from "@/lib/validation/schemas";
import { prisma } from "@/lib/db/prisma";
import { issueToken } from "@/lib/auth/tokens";
import { emails } from "@/lib/email/mailer";

/** Always responds identically so account existence is not disclosed. */
export const POST = route({ auth: "none", body: forgotPasswordSchema, rateLimit: RATE_LIMITS.auth }, async ({ body }) => {
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (user && user.status !== "CLOSED" && user.status !== "BANNED") {
    try {
      await enforceRateLimit(RATE_LIMITS.emailSend, `reset:${user.id}`);
      const token = await issueToken(user.id, "PASSWORD_RESET");
      await emails.passwordReset(user.email, token);
    } catch {
      /* swallow to keep responses uniform */
    }
  }
  return { sent: true };
});
