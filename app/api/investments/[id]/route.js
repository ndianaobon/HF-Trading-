import { route } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { cancelByUser } from "@/lib/services/investments";

export const DELETE = route({ auth: "user", rateLimit: RATE_LIMITS.money }, async ({ session, params }) => cancelByUser(session.user.id, params.id));
