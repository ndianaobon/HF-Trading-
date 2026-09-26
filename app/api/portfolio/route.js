import { route } from "@/lib/api/route";
import { getPortfolio } from "@/lib/trading/portfolio-service";

export const GET = route({ auth: "user" }, async ({ session }) => getPortfolio(session.user.id));
