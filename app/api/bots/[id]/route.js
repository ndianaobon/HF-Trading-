import { route } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { botStatusSchema } from "@/lib/validation/schemas";
import { setBotStatus, stopBot } from "@/lib/services/bots";

/** Pause or resume a bot. */
export const PATCH = route({ auth: "verified", body: botStatusSchema, rateLimit: RATE_LIMITS.orders }, async ({ session, params, body }) =>
  setBotStatus(session.user.id, params.id, body.status),
);

/** Stop a bot permanently. Its orders and run history are kept. */
export const DELETE = route({ auth: "verified", rateLimit: RATE_LIMITS.orders }, async ({ session, params }) => stopBot(session.user.id, params.id));
