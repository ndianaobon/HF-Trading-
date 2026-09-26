import { z } from "zod";
import { route } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { consumeToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db/prisma";
import { notify } from "@/lib/notifications/service";

export const POST = route({ auth: "none", body: z.object({ token: z.string().min(20).max(200) }), rateLimit: RATE_LIMITS.auth }, async ({ body }) => {
  const userId = await consumeToken(body.token, "EMAIL_VERIFICATION");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(), status: user.status === "PENDING_VERIFICATION" ? "ACTIVE" : user.status },
    });
    await notify({ userId, type: "SECURITY_ALERT", title: "Email address verified", body: "Your email address has been confirmed.", link: "/dashboard" });
  }
  return { verified: true };
});
