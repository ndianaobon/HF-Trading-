import { z } from "zod";
import { route } from "@/lib/api/route";
import { adminFollowerAction } from "@/lib/services/copy-trading";

const body = z.object({ action: z.enum(["suspend", "reinstate", "stop"]), reason: z.string().trim().max(500).optional() });

export const PATCH = route({ admin: "copytraders.manage", body }, async ({ session, params, body, ip }) =>
  adminFollowerAction(params.id, body.action, { id: session.user.id, email: session.user.email, ip }, body.reason),
);
