import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { approveWithdrawal, completeWithdrawal, rejectWithdrawal } from "@/lib/payments/withdrawal-service";
import { actorOf } from "@/lib/api/admin";

const body = z.object({
  action: z.enum(["approve", "reject", "fail", "complete"]),
  reason: z.string().trim().max(500).optional(),
  note: z.string().trim().max(500).optional(),
  txHash: z
    .string()
    .trim()
    .max(128)
    .regex(/^[A-Za-z0-9-]*$/)
    .optional(),
});

export const POST = route({ admin: "withdrawals.review", body }, async ({ session, params, body, ip, userAgent }) => {
  const actor = actorOf(session, ip, userAgent);
  switch (body.action) {
    case "approve":
      return approveWithdrawal(params.id, actor, body.note);
    case "complete":
      return completeWithdrawal(params.id, actor, body.txHash);
    case "reject":
    case "fail":
      if (!body.reason) throw new AppError("VALIDATION_ERROR", "A reason is required.");
      return rejectWithdrawal(params.id, actor, body.reason, body.action === "reject" ? "REJECTED" : "FAILED");
  }
});
