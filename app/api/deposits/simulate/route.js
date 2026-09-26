import { route } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { simulateDepositSchema } from "@/lib/validation/schemas";
import { simulateDeposit } from "@/lib/payments/deposit-service";

/** Demo mode only — creates a clearly-labelled simulated deposit. */
export const POST = route({ auth: "verified", body: simulateDepositSchema, rateLimit: RATE_LIMITS.money }, async ({ session, body }) =>
  simulateDeposit(session.user.id, body),
);
