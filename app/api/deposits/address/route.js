import { z } from "zod";
import { route } from "@/lib/api/route";
import { getDepositInstructions } from "@/lib/payments/deposit-service";

const query = z.object({ asset: z.string().min(2).max(10), network: z.string().min(2).max(20) });

export const GET = route({ auth: "verified", query }, async ({ session, query }) => getDepositInstructions(session.user.id, query.asset, query.network));
