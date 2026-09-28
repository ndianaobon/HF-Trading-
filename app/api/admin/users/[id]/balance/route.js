import { z } from "zod";
import { route } from "@/lib/api/route";
import { actorOf } from "@/lib/api/admin";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { adjustBalance } from "@/lib/services/balance-adjustments";

const body = z.object({
  asset: z.string().trim().min(2).max(10),
  direction: z.enum(["CREDIT", "DEBIT"]),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, "Enter a valid amount")
    .refine((v) => Number(v) > 0, "Must be greater than zero"),
  reason: z.string().trim().min(3, "Give a reason (kept in the audit log)").max(500),
  note: z.string().trim().max(200).optional(),
});

/** Manual balance adjustment (credit / debit), recorded in the ledger and audit log. */
export const POST = route({ admin: "balances.adjust", body, rateLimit: RATE_LIMITS.money }, async ({ session, params, body, ip, userAgent }) =>
  adjustBalance(params.id, body, { ...actorOf(session, ip, userAgent), role: session.user.adminUser?.role }),
);
