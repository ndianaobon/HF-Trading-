import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { beginTotpEnrollment } from "@/lib/auth/totp";

/** Starts TOTP enrollment. The secret stays inactive until confirmed with a valid code. */
export const POST = route({ auth: "user", rateLimit: RATE_LIMITS.auth }, async ({ session }) => {
  if (session.user.twoFactor?.enabled) throw new AppError("CONFLICT", "Two-factor authentication is already enabled.");
  const { secret, qrDataUrl } = await beginTotpEnrollment(session.user.id, session.user.email);
  return { secret, qrDataUrl };
});
