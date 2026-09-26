import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { registerSchema } from "@/lib/validation/schemas";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { issueToken } from "@/lib/auth/tokens";
import { emails } from "@/lib/email/mailer";
import { getSetting } from "@/lib/services/settings";
import { generateReferralCode } from "@/lib/services/users";
import { linkReferral } from "@/lib/services/referrals";
import { isDemoMode } from "@/lib/config";

export const POST = route({ auth: "none", body: registerSchema, rateLimit: RATE_LIMITS.register }, async ({ body, ip, userAgent }) => {
  const open = await getSetting("platform.registrationOpen");
  if (!open.enabled) throw new AppError("FEATURE_DISABLED", "New registrations are temporarily paused.");

  const existing = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
  if (existing) throw new AppError("EMAIL_IN_USE", undefined);

  const user = await prisma.user.create({
    data: {
      email: body.email,
      passwordHash: await hashPassword(body.password),
      status: "PENDING_VERIFICATION",
      referralCode: await generateReferralCode(),
      isDemo: isDemoMode(),
      profile: {
        create: {
          firstName: body.firstName,
          lastName: body.lastName,
          phone: body.phone || null,
          country: body.country,
          preferences: { defaultMarket: "BTC-USDT", confirmOrders: true },
        },
      },
      portfolio: { create: {} },
      notifications: {
        create: {
          type: "SYSTEM_ANNOUNCEMENT",
          title: "Welcome to HarborFinance",
          body: isDemoMode()
            ? "You're using the demo environment. Balances and transactions are simulated. Verify your email to get started."
            : "Verify your email address to start using your account.",
        },
      },
    },
  });
  await linkReferral(user.id, body.referralCode);

  const token = await issueToken(user.id, "EMAIL_VERIFICATION");
  await emails.verifyEmail(user.email, body.firstName, token);
  await createSession({ userId: user.id, remember: false, mfaVerified: true, ip, userAgent });
  await prisma.loginHistory.create({ data: { userId: user.id, ip, userAgent, success: true, reason: "registration" } });

  return { next: "/verify-email", emailVerified: false };
});
