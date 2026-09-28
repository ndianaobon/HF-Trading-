import { route } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { issueCode } from "@/lib/auth/tokens";
import { emails } from "@/lib/email/mailer";

export const POST = route({ auth: "user", rateLimit: RATE_LIMITS.emailSend }, async ({ session }) => {
  if (session.user.emailVerifiedAt) return { alreadyVerified: true };
  const code = await issueCode(session.user.id, "EMAIL_VERIFICATION");
  await emails.verifyCode(session.user.email, session.user.profile?.firstName ?? "there", code);
  return { sent: true };
});
