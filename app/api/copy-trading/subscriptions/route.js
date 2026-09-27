import { route } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { copySchema } from "@/lib/validation/schemas";
import { startCopying } from "@/lib/services/copy-trading";
import { userCopySummary } from "@/lib/services/copy-stats";

export const GET = route({ auth: "user" }, async ({ session }) => userCopySummary(session.user.id));

export const POST = route({ auth: "verified", body: copySchema, rateLimit: RATE_LIMITS.money }, async ({ session, body }) =>
  startCopying(session.user.id, body.traderId, { allocation: body.allocation, amountPerTrade: body.amountPerTrade, stopLossPct: body.stopLossPct }),
);
