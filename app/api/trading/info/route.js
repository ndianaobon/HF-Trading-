import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { getMarket } from "@/lib/market-data/service";
import { feeRate } from "@/lib/trading/fees";
import { venueStatus } from "@/lib/trading/venue";
import { getSetting } from "@/lib/services/settings";

const query = z.object({ market: z.string().regex(/^[A-Z0-9]{2,10}-[A-Z]{3,5}$/) });

/** Trading parameters for the order ticket: fees, limits and execution venue status. */
export const GET = route({ auth: "none", query }, async ({ query }) => {
  const market = await getMarket(query.market);
  if (!market) throw new AppError("NOT_FOUND", "Unknown market.");
  const [maker, taker, limits, maintenance] = await Promise.all([
    feeRate("TRADING_MAKER", { marketId: market.id }),
    feeRate("TRADING_TAKER", { marketId: market.id }),
    getSetting("trading.limits"),
    getSetting("platform.maintenance"),
  ]);
  return {
    market: market.symbol,
    status: market.status,
    makerRate: maker.toString(),
    takerRate: taker.toString(),
    minQuantity: market.minQuantity,
    minNotional: market.minNotional,
    maxNotional: limits.maxOrderNotional,
    venue: venueStatus(),
    maintenance: maintenance.enabled ? maintenance.message || "Trading is paused for maintenance." : null,
  };
});
