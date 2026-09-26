import "server-only";
import { prisma } from "@/lib/db/prisma";
import { D, floor } from "@/lib/db/decimal";
import { AppError } from "@/lib/api/errors";
import { getSetting } from "@/lib/services/settings";

/** Fat-finger protection: limit prices must be within ±50% of the last price. */
const PRICE_BAND = 0.5;

/**
 * RiskService — pre-trade validation. Throws AppError(ORDER_REJECTED …) with a
 * specific, user-safe reason.
 */
export async function validateOrder(userId, market, intent, lastPrice) {
  const [maintenance, limits] = await Promise.all([getSetting("platform.maintenance"), getSetting("trading.limits")]);
  if (maintenance.enabled) throw new AppError("MARKET_UNAVAILABLE", "Trading is paused for scheduled maintenance.");
  if (market.status !== "ACTIVE") throw new AppError("MARKET_UNAVAILABLE");

  const quantity = floor(intent.quantity, market.quantityPrecision);
  if (quantity.lte(0)) throw new AppError("ORDER_REJECTED", "Order quantity is too small for this market's precision.");
  if (quantity.lt(market.minQuantity)) {
    throw new AppError("ORDER_REJECTED", `Minimum order quantity is ${D(market.minQuantity).toString()} ${market.base.symbol}.`);
  }

  const last = D(lastPrice);
  let price = null;
  let stopPrice = null;

  if (intent.type !== "MARKET") {
    if (!intent.price) throw new AppError("ORDER_REJECTED", "A limit price is required.");
    price = D(intent.price).toDecimalPlaces(market.pricePrecision);
    if (price.lte(0)) throw new AppError("ORDER_REJECTED", "Limit price must be positive.");
    if (price.lt(last.mul(1 - PRICE_BAND)) || price.gt(last.mul(1 + PRICE_BAND))) {
      throw new AppError("ORDER_REJECTED", "Limit price is too far from the current market price.");
    }
  }
  if (intent.type === "STOP_LIMIT") {
    if (!intent.stopPrice) throw new AppError("ORDER_REJECTED", "A stop price is required.");
    stopPrice = D(intent.stopPrice).toDecimalPlaces(market.pricePrecision);
    if (stopPrice.lte(0)) throw new AppError("ORDER_REJECTED", "Stop price must be positive.");
    if (intent.side === "BUY" && stopPrice.lte(last)) {
      throw new AppError("ORDER_REJECTED", "Buy stop price must be above the current price.");
    }
    if (intent.side === "SELL" && stopPrice.gte(last)) {
      throw new AppError("ORDER_REJECTED", "Sell stop price must be below the current price.");
    }
  }

  const referencePrice = price ?? last;
  const notional = quantity.mul(referencePrice);
  if (notional.lt(market.minNotional)) {
    throw new AppError("ORDER_REJECTED", `Minimum order value is ${D(market.minNotional).toString()} ${market.quote.symbol}.`);
  }
  if (notional.gt(limits.maxOrderNotional)) {
    throw new AppError("ORDER_REJECTED", `Maximum order value is ${limits.maxOrderNotional.toLocaleString()} ${market.quote.symbol}.`);
  }

  if (intent.type !== "MARKET") {
    const open = await prisma.order.count({ where: { userId, status: { in: ["ACCEPTED", "PARTIALLY_FILLED"] } } });
    if (open >= limits.maxOpenOrders) throw new AppError("ORDER_REJECTED", `You can have at most ${limits.maxOpenOrders} open orders.`);
  }

  return { quantity, price, stopPrice, referencePrice, notional };
}
