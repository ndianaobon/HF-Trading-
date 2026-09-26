import { route } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { transferSchema } from "@/lib/validation/schemas";
import { internalTransfer } from "@/lib/payments/withdrawal-service";

export const POST = route({ auth: "verified", body: transferSchema, rateLimit: RATE_LIMITS.money }, async ({ session, body }) => {
  const tx = await internalTransfer(session.user.id, body);
  return { reference: tx.reference, amount: tx.amount.toString(), isDemo: tx.isDemo };
});
