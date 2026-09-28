import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { consumeCode, consumeToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db/prisma";
import { notify } from "@/lib/notifications/service";
import { emails, sendLater } from "@/lib/email/mailer";

const body = z.union([z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }), z.object({ token: z.string().min(20).max(200) })]);

/**
 * Verifies the signed-in user's email with the 6-digit code from the sign-up
 * email (or, for older emails, a link token). Five code attempts per 15 minutes.
 */
export const POST = route({ auth: "optional", body, rateLimit: RATE_LIMITS.auth }, async ({ body, session }) => {
  let userId;
  if ("code" in body) {
    if (!session) throw new AppError("UNAUTHENTICATED", "Log in to verify your email.");
    if (session.user.emailVerifiedAt) return { verified: true };
    await enforceRateLimit({ name: "verify-code", limit: 5, windowMs: 15 * 60_000 }, session.user.id);
    userId = await consumeCode(session.user.id, body.code, "EMAIL_VERIFICATION");
  } else {
    userId = await consumeToken(body.token, "EMAIL_VERIFICATION");
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: { select: { firstName: true } } } });
  if (!user.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(), status: user.status === "PENDING_VERIFICATION" ? "ACTIVE" : user.status },
    });
    await notify({ userId, type: "SECURITY_ALERT", title: "Email address verified", body: "Your email address has been confirmed. Welcome to HarborFinance Trading.", link: "/dashboard" });
    sendLater(emails.welcome(user.email, user.profile?.firstName ?? "there"));
  }
  return { verified: true };
});
