import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { traderDetail } from "@/lib/services/copy-stats";

export const GET = route({ auth: "optional" }, async ({ params, session }) => {
  const trader = await traderDetail(params.id, session?.user.id);
  if (!trader) throw new AppError("NOT_FOUND");
  return trader;
});
