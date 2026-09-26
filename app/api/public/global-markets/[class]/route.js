import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { globalMarketQuotes } from "@/lib/market-data/global-markets";

export const dynamic = "force-dynamic";

/** Forex, share and index quotes (market data only). */
export const GET = route({ auth: "none" }, async ({ params }) => {
  const data = await globalMarketQuotes(params.class);
  if (!data) throw new AppError("NOT_FOUND");
  return data;
});
