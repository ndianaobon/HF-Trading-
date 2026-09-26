import { z } from "zod";
import { route } from "@/lib/api/route";
import { getPerformance } from "@/lib/trading/portfolio-service";

const query = z.object({ range: z.enum(["7d", "30d", "90d"]).default("30d") });

export const GET = route({ auth: "user", query }, async ({ session, query }) => {
  const days = { "7d": 7, "30d": 30, "90d": 90 }[query.range];
  return getPerformance(session.user.id, days);
});
