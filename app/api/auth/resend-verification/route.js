import { route } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { issueToken } from "@/lib/auth/tokens";
import { emails } from "@/lib/email/mailer";

export const POST = route({ auth: "user", rateLimit: RATE_LIMITS.emailSend }, async ({ session }) => {
  if (session.user.emailVerifiedAt) return { alreadyVerified: true };
  const token = await issueToken(session.user.id, "EMAIL_VERIFICATION");
  await emails.verifyEmail(session.user.email, session.user.profile?.firstName ?? "there", token);
  return { sent: true };
});
