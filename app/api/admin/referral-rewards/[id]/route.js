import { z } from "zod";
import { route } from "@/lib/api/route";
import { settleReward } from "@/lib/services/referrals";
import { actorOf } from "@/lib/api/admin";

const body = z.object({ decision: z.enum(["COMPLETED", "CANCELLED"]) });

export const POST = route({ admin: "referrals.manage", body }, async ({ session, params, body, ip, userAgent }) =>
  settleReward(params.id, body.decision, actorOf(session, ip, userAgent)),
);
