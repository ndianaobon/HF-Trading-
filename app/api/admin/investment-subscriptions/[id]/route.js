import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { activateSubscription, settleSubscription } from "@/lib/services/investments";
import { actorOf } from "@/lib/api/admin";

const body = z.object({
  action: z.enum(["activate", "settle", "cancel"]),
  /** Realised P&L reported by the strategy manager (may be negative). */
  realizedPnl: z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .optional(),
});

export const POST = route({ admin: "plans.manage", body }, async ({ session, params, body, ip, userAgent }) => {
  const actor = actorOf(session, ip, userAgent);
  if (body.action === "activate") {
    const r = await activateSubscription(params.id, actor);
    if (!r) throw new AppError("CONFLICT", "Only pending subscriptions can be activated.");
    return r;
  }
  if (body.action === "settle") {
    if (body.realizedPnl === undefined) throw new AppError("VALIDATION_ERROR", "Enter the realised P&L reported for this subscription.");
    return settleSubscription(params.id, body.realizedPnl, actor, "COMPLETED");
  }
  return settleSubscription(params.id, body.realizedPnl ?? "0", actor, "CANCELLED");
});
