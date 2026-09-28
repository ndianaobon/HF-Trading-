import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { totpSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/security/rate-limit";
import { getRawSession, revokeSession, clearSessionCookie } from "@/lib/auth/session";
import { verifySecondFactor } from "@/lib/auth/totp";
import { prisma } from "@/lib/db/prisma";

/** Second step of sign-in when 2FA is enabled. */
export const POST = route({ auth: "none", body: totpSchema, rateLimit: RATE_LIMITS.auth }, async ({ body, ip, userAgent }) => {
  const session = await getRawSession();
  if (!session) throw new AppError("SESSION_EXPIRED");
  if (session.mfaVerified) return { ok: true };
  // Per session, and per user so signing in again doesn't grant fresh guesses.
  const limited = async (e) => {
    await revokeSession(session.id);
    await clearSessionCookie();
    throw e;
  };
  await enforceRateLimit({ name: "mfa", limit: 5, windowMs: 10 * 60_000 }, session.id).catch(limited);
  await enforceRateLimit({ name: "mfa-user", limit: 10, windowMs: 15 * 60_000 }, session.userId).catch(limited);

  const ok = await verifySecondFactor(session.userId, body.code);
  await prisma.loginHistory.create({ data: { userId: session.userId, ip, userAgent, success: ok, reason: ok ? "mfa_ok" : "mfa_failed" } });
  if (!ok) throw new AppError("INVALID_2FA_CODE");
  await prisma.session.update({ where: { id: session.id }, data: { mfaVerified: true } });
  return { ok: true, emailVerified: !!session.user.emailVerifiedAt };
});
