import "server-only";
import { prisma, withTransaction } from "@/lib/db/prisma";
import { D, ZERO } from "@/lib/db/decimal";
import { AppError } from "@/lib/api/errors";
import { getLastPrice, getMarket, getTickers, listMarkets } from "@/lib/market-data/service";
import { validateOrder } from "./risk-service";
import { feeRate } from "./fees";
import { getVenue } from "./venue";
import * as wallet from "./wallet-service";
import { recordTransaction } from "./transaction-service";
import { addToPosition, reducePosition } from "./positions";
import { announce, createNotification } from "@/lib/notifications/service";
import { publish } from "@/lib/realtime/bus";

/**
 * OrderService — order lifecycle:
 *   CREATED → VALIDATED → ACCEPTED → (PARTIALLY_FILLED →)* FILLED
 *                      ↘ REJECTED          ↘ CANCELLED
 * Funds are reserved (locked) on acceptance and settled per fill inside a
 * database transaction holding a row lock on the order.
 */

const OPEN = ["ACCEPTED", "PARTIALLY_FILLED"];
const MARKET_SLIPPAGE_BUFFER = D("0.005");
const QUOTE_DP = 8;

async function addEvent(tx, orderId, status, note) {
  await tx.orderEvent.create({ data: { orderId, status, note: note ?? null } });
}

export async function placeOrder(userId, input) {
  const venue = getVenue();
  const market = await getMarket(input.market);
  if (!market) throw new AppError("NOT_FOUND", "Unknown market.");

  if (input.clientOrderId) {
    const existing = await prisma.order.findUnique({ where: { userId_clientOrderId: { userId, clientOrderId: input.clientOrderId } } });
    if (existing) return existing; // idempotent retry
  }

  const last = await getLastPrice(market.symbol);
  const v = await validateOrder(userId, market, input, last);
  const [taker, maker] = await Promise.all([feeRate("TRADING_TAKER", { marketId: market.id }), feeRate("TRADING_MAKER", { marketId: market.id })]);
  const maxRate = taker.gt(maker) ? taker : maker;

  const reserveAsset = input.side === "BUY" ? market.quoteAssetId : market.baseAssetId;
  const reserve =
    input.side === "BUY"
      ? input.type === "MARKET"
        ? v.quantity.mul(last).mul(D(1).plus(MARKET_SLIPPAGE_BUFFER)).mul(D(1).plus(taker)).toDecimalPlaces(QUOTE_DP, 0)
        : v.quantity.mul(v.price).mul(D(1).plus(maxRate)).toDecimalPlaces(QUOTE_DP, 0)
      : v.quantity;

  let order;
  try {
    order = await withTransaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId,
          marketId: market.id,
          clientOrderId: input.clientOrderId ?? null,
          side: input.side,
          type: input.type,
          status: "CREATED",
          price: v.price,
          stopPrice: v.stopPrice,
          quantity: v.quantity,
          isDemo: venue.simulated,
        },
      });
      await addEvent(tx, created.id, "CREATED");
      await addEvent(tx, created.id, "VALIDATED", `Risk checks passed. Reference price ${D(last).toString()}.`);
      await wallet.lock(tx, userId, reserveAsset, reserve);
      await addEvent(tx, created.id, "ACCEPTED", `Reserved ${reserve.toString()} ${input.side === "BUY" ? market.quote.symbol : market.base.symbol}.`);
      return tx.order.update({ where: { id: created.id }, data: { status: "ACCEPTED", lockedAmount: reserve } });
    });
  } catch (err) {
    if (err instanceof AppError && err.code === "INSUFFICIENT_BALANCE") {
      await recordRejectedOrder(userId, market.id, input, v.quantity, venue.simulated, "Insufficient available balance");
    }
    throw err;
  }

  publish(userId, { type: "wallet.updated", assets: [input.side === "BUY" ? market.quote.symbol : market.base.symbol] });
  publish(userId, { type: "order.updated", orderId: order.id, status: order.status, market: market.symbol });

  // Immediate execution: market orders, and limit orders that are already marketable.
  if (input.type === "MARKET") {
    await settleFill(order.id, v.quantity, D(last), false);
  } else if (input.type === "LIMIT") {
    const marketable = input.side === "BUY" ? v.price.gte(last) : v.price.lte(last);
    if (marketable) await settleFill(order.id, v.quantity, D(last), false);
  }

  return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
}

async function recordRejectedOrder(userId, marketId, input, quantity, isDemo, reason) {
  await prisma.order.create({
    data: {
      userId,
      marketId,
      side: input.side,
      type: input.type,
      status: "REJECTED",
      quantity,
      price: input.price ? D(input.price) : null,
      stopPrice: input.stopPrice ? D(input.stopPrice) : null,
      isDemo,
      rejectReason: reason,
      closedAt: new Date(),
      events: { create: [{ status: "CREATED" }, { status: "REJECTED", note: reason }] },
    },
  });
}

/**
 * Settles one fill. Venue-agnostic: the simulator calls it in demo mode; a
 * live venue integration should call it from its execution reports.
 */
export async function settleFill(orderId, fillQty, fillPrice, isMaker) {
  const result = await withTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { market: { include: { baseAsset: true, quoteAsset: true } } },
    });
    if (!order || !OPEN.includes(order.status)) return null;

    const remaining = order.quantity.minus(order.filledQuantity);
    const q = fillQty.gt(remaining) ? remaining : fillQty;
    if (q.lte(0)) return null;

    const rate = await feeRate(isMaker ? "TRADING_MAKER" : "TRADING_TAKER", { marketId: order.marketId });
    const { market } = order;
    const cost = q.mul(fillPrice).toDecimalPlaces(QUOTE_DP);
    const fee = cost.mul(rate).toDecimalPlaces(QUOTE_DP, 0);
    let lockedLeft = order.lockedAmount;
    const meta = { orderId: order.id, market: market.symbol, price: fillPrice.toString(), quantity: q.toString() };

    if (order.side === "BUY") {
      const spend = cost.plus(fee);
      if (spend.gt(lockedLeft)) {
        // Price moved beyond the reservation — top up from available or fail safely.
        await wallet.lock(tx, order.userId, market.quoteAssetId, spend.minus(lockedLeft));
        lockedLeft = spend;
      }
      await wallet.consumeLocked(tx, order.userId, market.quoteAssetId, spend);
      lockedLeft = lockedLeft.minus(spend);
      await wallet.credit(tx, order.userId, market.baseAssetId, q);
      await recordTransaction(tx, {
        userId: order.userId,
        type: "TRADE",
        direction: "DEBIT",
        assetId: market.quoteAssetId,
        amount: cost,
        fee,
        isDemo: order.isDemo,
        orderId: order.id,
        description: `Buy ${q} ${market.baseAsset.symbol}`,
        metadata: meta,
      });
      await recordTransaction(tx, {
        userId: order.userId,
        type: "TRADE",
        direction: "CREDIT",
        assetId: market.baseAssetId,
        amount: q,
        isDemo: order.isDemo,
        orderId: order.id,
        description: `Buy ${q} ${market.baseAsset.symbol}`,
        metadata: meta,
      });
      await addToPosition(tx, order.userId, market.baseAssetId, q, spend);
    } else {
      await wallet.consumeLocked(tx, order.userId, market.baseAssetId, q);
      lockedLeft = lockedLeft.minus(q);
      const net = cost.minus(fee);
      if (net.gt(0)) await wallet.credit(tx, order.userId, market.quoteAssetId, net);
      await recordTransaction(tx, {
        userId: order.userId,
        type: "TRADE",
        direction: "DEBIT",
        assetId: market.baseAssetId,
        amount: q,
        isDemo: order.isDemo,
        orderId: order.id,
        description: `Sell ${q} ${market.baseAsset.symbol}`,
        metadata: meta,
      });
      await recordTransaction(tx, {
        userId: order.userId,
        type: "TRADE",
        direction: "CREDIT",
        assetId: market.quoteAssetId,
        amount: net,
        fee,
        isDemo: order.isDemo,
        orderId: order.id,
        description: `Sell ${q} ${market.baseAsset.symbol}`,
        metadata: meta,
      });
      await reducePosition(tx, order.userId, market.baseAssetId, q, net);
    }

    const filled = order.filledQuantity.plus(q);
    const full = filled.gte(order.quantity);
    const avg = order.filledQuantity
      .mul(order.avgFillPrice ?? ZERO)
      .plus(q.mul(fillPrice))
      .div(filled)
      .toDecimalPlaces(18);
    if (full && lockedLeft.gt(0)) {
      await wallet.unlock(tx, order.userId, order.side === "BUY" ? market.quoteAssetId : market.baseAssetId, lockedLeft);
      lockedLeft = ZERO;
    }
    const status = full ? "FILLED" : "PARTIALLY_FILLED";
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status,
        filledQuantity: filled,
        avgFillPrice: avg,
        feeTotal: order.feeTotal.plus(fee),
        lockedAmount: lockedLeft,
        closedAt: full ? new Date() : null,
      },
    });
    const trade = await tx.trade.create({
      data: {
        orderId: order.id,
        userId: order.userId,
        marketId: order.marketId,
        side: order.side,
        price: fillPrice,
        quantity: q,
        quoteQuantity: cost,
        fee,
        feeAsset: market.quoteAsset.symbol,
        isMaker,
        isDemo: order.isDemo,
      },
    });
    await addEvent(tx, order.id, status, `Filled ${q} @ ${fillPrice}${isMaker ? " (maker)" : ""}`);
    const notification = await createNotification(
      {
        userId: order.userId,
        type: "TRADE_EXECUTED",
        title: `${order.side === "BUY" ? "Bought" : "Sold"} ${q.toString()} ${market.baseAsset.symbol}${order.isDemo ? " (demo)" : ""}`,
        body: `${full ? "Order filled" : "Order partially filled"} on ${market.symbol} at ${fillPrice.toString()} ${market.quoteAsset.symbol}.`,
        link: "/dashboard/transactions?type=TRADE",
      },
      tx,
    );
    return { order: updated, trade, market, notification };
  });

  if (result) {
    const { order, trade, market, notification } = result;
    publish(order.userId, {
      type: "trade.executed",
      orderId: order.id,
      market: market.symbol,
      side: order.side,
      quantity: trade.quantity.toString(),
      price: trade.price.toString(),
    });
    publish(order.userId, { type: "order.updated", orderId: order.id, status: order.status, market: market.symbol });
    publish(order.userId, { type: "wallet.updated", assets: [market.baseAsset.symbol, market.quoteAsset.symbol] });
    announce(notification);
  }
  return result?.order ?? null;
}

export async function cancelOrder(userId, orderId, reason = "Cancelled by user") {
  const result = await withTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { market: { include: { baseAsset: true, quoteAsset: true } } } });
    if (!order || order.userId !== userId) throw new AppError("NOT_FOUND", "Order not found.");
    if (!OPEN.includes(order.status)) throw new AppError("CONFLICT", "Only open orders can be cancelled.");
    const asset = order.side === "BUY" ? order.market.quoteAssetId : order.market.baseAssetId;
    await wallet.unlock(tx, userId, asset, order.lockedAmount);
    await addEvent(tx, order.id, "CANCELLED", reason);
    const updated = await tx.order.update({ where: { id: order.id }, data: { status: "CANCELLED", lockedAmount: ZERO, closedAt: new Date() } });
    return { updated, market: order.market };
  });
  publish(userId, { type: "order.updated", orderId, status: "CANCELLED", market: result.market.symbol });
  publish(userId, { type: "wallet.updated", assets: [result.market.baseAsset.symbol, result.market.quoteAsset.symbol] });
  return result.updated;
}

/**
 * Simulated matching cycle (demo mode). Triggers stop-limit orders and fills
 * resting limit orders when the live reference price crosses their limit.
 * Large orders fill partially per cycle to model finite liquidity.
 */
export async function runMatchingCycle() {
  let venue;
  try {
    venue = getVenue();
  } catch {
    return;
  }
  const open = await prisma.order.findMany({
    where: { status: { in: OPEN }, type: { in: ["LIMIT", "STOP_LIMIT"] } },
    include: { market: true },
    take: 500,
    orderBy: { createdAt: "asc" },
  });
  if (open.length === 0) return;

  const { tickers, status } = await getTickers();
  if (status.stale) return; // never fill against stale prices
  await listMarkets();

  for (const o of open) {
    const t = tickers.get(o.market.symbol);
    if (!t) continue;
    const last = D(t.lastPrice);

    if (o.type === "STOP_LIMIT" && !o.triggered) {
      const hit = o.side === "BUY" ? last.gte(o.stopPrice) : last.lte(o.stopPrice);
      if (!hit) continue;
      await prisma.$transaction([
        prisma.order.update({ where: { id: o.id }, data: { triggered: true } }),
        prisma.orderEvent.create({ data: { orderId: o.id, status: o.status, note: `Stop price ${o.stopPrice} reached; limit order working.` } }),
      ]);
      publish(o.userId, { type: "order.updated", orderId: o.id, status: o.status, market: o.market.symbol });
    }

    const price = o.price;
    const crosses = o.side === "BUY" ? last.lte(price) : last.gte(price);
    if (!crosses) continue;
    const remaining = o.quantity.minus(o.filledQuantity);
    const cap = D(venue.maxFillNotionalPerCycle).div(price).toDecimalPlaces(o.market.quantityPrecision, 1);
    const qty = remaining.gt(cap) && cap.gt(0) ? cap : remaining;
    try {
      await settleFill(o.id, qty, price, true);
    } catch (err) {
      console.error(`[matcher] fill failed for order ${o.id}`, err);
    }
  }
}
