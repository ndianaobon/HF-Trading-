import { z } from "zod";
import { route } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { stopCopying, updateCopy } from "@/lib/services/copy-trading";
const patch = z.object({
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
  maxAllocation: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  stopLossPct: z.coerce.number().min(5).max(90).optional(),
});

export const PATCH = route({ auth: "user", body: patch }, async ({ session, params, body }) => updateCopy(session.user.id, params.id, body));

export const DELETE = route({ auth: "user", rateLimit: RATE_LIMITS.money }, async ({ session, params }) => stopCopying(session.user.id, params.id));
