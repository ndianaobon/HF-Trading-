import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { loginSchema } from "@/lib/validation/schemas";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { prisma } from "@/lib/db/prisma";
import { dummyVerify, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { notify } from "@/lib/notifications/service";
import { emails } from "@/lib/email/mailer";
import { describeUserAgent } from "@/lib/security/request";

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

export const POST = route({ auth: "none", body: loginSchema, rateLimit: RATE_LIMITS.auth }, async ({ body, ip, userAgent }) => {
  await enforceRateLimit(RATE_LIMITS.auth, `email:${body.email}`);
  const user = await prisma.user.findUnique({ where: { email: body.email }, include: { twoFactor: true } });
  if (!user) {
    await dummyVerify(body.password);
    throw new AppError("INVALID_CREDENTIALS");
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new AppError("ACCOUNT_LOCKED");

  const ok = await verifyPassword(user.passwordHash, body.password);
  if (!ok) {
    const failures = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: failures >= MAX_FAILURES ? 0 : failures, lockedUntil: failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MS) : null },
    });
    await prisma.loginHistory.create({ data: { userId: user.id, ip, userAgent, success: false, reason: "bad_password" } });
    if (failures >= MAX_FAILURES) {
      await notify({
        userId: user.id,
        type: "SECURITY_ALERT",
        title: "Account temporarily locked",
        body: "Several failed sign-in attempts were detected. Sign-in is paused for 15 minutes.",
      });
    }
    throw new AppError("INVALID_CREDENTIALS");
  }
  if (user.status === "SUSPENDED" || user.status === "CLOSED") {
    await prisma.loginHistory.create({ data: { userId: user.id, ip, userAgent, success: false, reason: "suspended" } });
    throw new AppError("ACCOUNT_SUSPENDED");
  }

  const mfaRequired = !!user.twoFactor?.enabled;
  const knownIp = await prisma.loginHistory.findFirst({ where: { userId: user.id, ip, success: true }, select: { id: true } });
  await createSession({ userId: user.id, remember: body.remember, mfaVerified: !mfaRequired, ip, userAgent });
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ip } }),
    prisma.loginHistory.create({ data: { userId: user.id, ip, userAgent, success: true, reason: mfaRequired ? "password_ok_mfa_pending" : "password" } }),
  ]);

  if (!knownIp) {
    const device = describeUserAgent(userAgent);
    await notify({
      userId: user.id,
      type: "SECURITY_ALERT",
      title: "New sign-in detected",
      body: `${device} from IP ${ip}. If this wasn't you, change your password and end other sessions.`,
      link: "/dashboard/settings?tab=sessions",
    });
    void emails.securityAlert(
      user.email,
      "New sign-in to your account",
      `A sign-in from ${device} (IP ${ip}) was detected. If this wasn't you, reset your password immediately.`,
    );
  }

  return { mfaRequired, emailVerified: !!user.emailVerifiedAt };
});
