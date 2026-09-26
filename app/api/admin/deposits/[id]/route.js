import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { completeDeposit, failDeposit } from "@/lib/payments/deposit-service";
import { actorOf } from "@/lib/api/admin";

const body = z.object({ action: z.enum(["approve", "reject", "fail"]), reason: z.string().trim().max(500).optional() });

/**
 * Manual review of reported deposits. Approval must only follow independent
 * verification of the transaction on-chain (or via the custodian); the
 * platform never fabricates confirmations.
 */
export const POST = route({ admin: "deposits.review", body }, async ({ session, params, body, ip, userAgent }) => {
  const actor = actorOf(session, ip, userAgent);
  if (body.action === "approve") return completeDeposit(params.id, actor);
  if (!body.reason) throw new AppError("VALIDATION_ERROR", "A reason is required.");
  return failDeposit(params.id, "FAILED", body.reason, actor);
});
