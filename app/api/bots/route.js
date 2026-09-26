import { route } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { botSchema } from "@/lib/validation/schemas";
import { createBot, listBots } from "@/lib/services/bots";

export const GET = route({ auth: "user" }, async ({ session }) => listBots(session.user.id));

export const POST = route({ auth: "verified", body: botSchema, rateLimit: RATE_LIMITS.orders }, async ({ session, body }) => createBot(session.user.id, body));
