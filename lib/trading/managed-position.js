import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, withTransaction } from "@/lib/db/prisma";
import { D, ZERO } from "@/lib/db/decimal";
import { AppError } from "@/lib/api/errors";
import { cancelOrder, placeOrder } from "./order-service";
import * as wallet from "./wallet-service";
import { publish } from "@/lib/realtime/bus";

/**
 * Managed positions: a position opened and closed on a user's behalf by an
 * automated module (copy trading, the automated trading bot) through the normal
 * order pipeline. The module's own table row (CopyTrade, AutoBotTrade) tracks it
 * with a shared set of columns: status, quantity, entry/exit order, prices,
 * values, fees, P&L, heldAmount and closingAt.
 *
 * While open, the bought asset (or, for sells, the proceeds) is reserved in the
 * wallet so it cannot be spent elsewhere, and released just before the close.
 * P&L always comes from the actual fills:
 *   gross = (exit − entry) × size;  net = exit proceeds − entry cost (fees included).
 */

const TABLES = { copyTrade: "CopyTrade", autoBotTrade: "AutoBotTrade" };
const CLOSE_CLAIM_MS = 2 * 60_000;

/** Totals from an order's fills: quote value, fees and base quantity. */
export async function fillTotals(orderId) {
  const agg = await prisma.trade.aggregate({ where: { orderId }, _sum: { quoteQuantity: true, fee: true, quantity: true } });
  return { quote: agg._sum.quoteQuantity ?? ZERO, fee: agg._sum.fee ?? ZERO, qty: agg._sum.quantity ?? ZERO };
}

const lockRow = (tx, model, id) => tx.$queryRaw`SELECT id FROM ${Prisma.raw(`"${TABLES[model]}"`)} WHERE id = ${id} FOR UPDATE`;

/**
 * Places the entry order for a PENDING row and marks it OPEN with the actual fill.
 * `clientOrderId` makes the entry idempotent across concurrent or repeated runs.
 * Returns { row } when opened, or { error, code } when no position was opened.
 */
export async function openPosition({ model, id, userId, market, side, quantity, clientOrderId, label = "Automated" }) {
  let order;
  try {
    order = await placeOrder(userId, { market: market.symbol, side, type: "MARKET", quantity: quantity.toString(), clientOrderId });
  } catch (err) {
    // Another run placed this entry at the same moment: continue with its order.
    const placed = err?.code === "P2002" ? await prisma.order.findUnique({ where: { userId_clientOrderId: { userId, clientOrderId } } }) : null;
    if (!placed) {
      if (!(err instanceof AppError)) console.error(`[${model}] entry order failed for ${id}`, err);
      return { error: err instanceof AppError ? err.message : "The order could not be placed.", code: err?.code ?? "INTERNAL_ERROR", critical: !(err instanceof AppError) };
    }
    order = placed;
  }

  if (order.status !== "FILLED") {
    // A market order that did not fill completely: cancel the rest and keep what filled.
    if (["ACCEPTED", "PARTIALLY_FILLED"].includes(order.status)) await cancelOrder(userId, order.id, `${label} entry not fully filled`).catch(() => {});
    order = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    if (order.filledQuantity.lte(0)) return { error: order.rejectReason ?? "The entry order was not filled.", code: "ORDER_REJECTED" };
  }

  const fills = await fillTotals(order.id);
  const qty = order.filledQuantity;
  const entryValue = side === "BUY" ? fills.quote.plus(fills.fee) : fills.quote.minus(fills.fee);
  const held = side === "BUY" ? qty : entryValue;
  const heldAsset = side === "BUY" ? market.baseAssetId : market.quoteAssetId;

  const row = await withTransaction(async (tx) => {
    let heldAmount = ZERO;
    try {
      await wallet.lock(tx, userId, heldAsset, held);
      heldAmount = held;
    } catch {
      /* funds already moved elsewhere — the position is still tracked */
    }
    return tx[model].update({
      where: { id },
      data: { status: "OPEN", quantity: qty, entryOrderId: order.id, entryPrice: order.avgFillPrice, entryValue, fees: fills.fee, heldAmount, openedAt: new Date() },
    });
  });
  publish(userId, { type: "wallet.updated", assets: [market.base?.symbol ?? market.baseAsset?.symbol, market.quote?.symbol ?? market.quoteAsset?.symbol].filter(Boolean) });
  return { row };
}

/**
 * Closes an OPEN row at market and books its P&L from the actual fills. Safe to
 * call repeatedly and concurrently: `closingAt` lets only one closer place the
 * exit order, and an exit that already filled (e.g. before a restart) is reused
 * instead of selling twice. `onClosed(tx, closedRow, result)` runs inside the
 * booking transaction and its return value is passed back as `extra`.
 * Returns { row, closed: boolean, extra }.
 */
export async function closePosition({ model, id, include = {}, closeData = {}, onClosed, label = "Automated" }) {
  const t = await prisma[model].findUnique({ where: { id }, include: { ...include, market: { include: { baseAsset: true, quoteAsset: true } } } });
  if (!t || t.status !== "OPEN") return { row: t, closed: false };
  const { market } = t;
  const exitSide = t.side === "BUY" ? "SELL" : "BUY";
  const heldAsset = t.side === "BUY" ? market.baseAssetId : market.quoteAssetId;
  const prefix = `${model === "copyTrade" ? "copy" : "bot"}-${t.id}-out`;

  // Claim the close and release the reserved asset so the closing order can use it.
  const released = await withTransaction(async (tx) => {
    await lockRow(tx, model, id);
    const cur = await tx[model].findUniqueOrThrow({ where: { id } });
    if (cur.status !== "OPEN") return null;
    if (cur.closingAt && Date.now() - cur.closingAt.getTime() < CLOSE_CLAIM_MS) return null;
    if (cur.heldAmount.gt(0)) await wallet.unlock(tx, cur.userId, heldAsset, cur.heldAmount);
    await tx[model].update({ where: { id }, data: { heldAmount: ZERO, closingAt: new Date() } });
    return cur;
  });
  if (!released) return { row: await prisma[model].findUnique({ where: { id } }), closed: false };

  let order = await prisma.order.findFirst({ where: { userId: t.userId, clientOrderId: { startsWith: prefix }, filledQuantity: { gt: 0 } }, orderBy: { createdAt: "desc" } });
  try {
    if (!order) {
      order = await placeOrder(t.userId, { market: market.symbol, side: exitSide, type: "MARKET", quantity: t.quantity.toString(), clientOrderId: `${prefix}-${Date.now().toString(36)}` });
      if (order.status !== "FILLED") {
        if (["ACCEPTED", "PARTIALLY_FILLED"].includes(order.status)) await cancelOrder(t.userId, order.id, `${label} exit not fully filled`).catch(() => {});
        order = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
        if (order.filledQuantity.lte(0)) throw new AppError("ORDER_REJECTED", order.rejectReason ?? "The closing order was not filled.");
      }
    }
  } catch (err) {
    const msg = err instanceof AppError ? err.message : "The closing order could not be placed.";
    if (!(err instanceof AppError)) console.error(`[${model}] exit order failed for ${id}`, err);
    // Re-reserve what was released so the position stays protected until the next attempt.
    await withTransaction(async (tx) => {
      let heldAmount = ZERO;
      if (released.heldAmount.gt(0)) {
        try {
          await wallet.lock(tx, t.userId, heldAsset, released.heldAmount);
          heldAmount = released.heldAmount;
        } catch {
          /* not available any more */
        }
      }
      await tx[model].update({ where: { id }, data: { heldAmount, closingAt: null, lastError: msg.slice(0, 300) } });
    }).catch(() => {});
    return { row: await prisma[model].findUnique({ where: { id } }), closed: false, error: msg };
  }

  const fills = await fillTotals(order.id);
  const exitValue = exitSide === "SELL" ? fills.quote.minus(fills.fee) : fills.quote.plus(fills.fee);
  const exitPrice = order.avgFillPrice;
  const qty = order.filledQuantity;
  const move = t.side === "BUY" ? exitPrice.minus(t.entryPrice) : t.entryPrice.minus(exitPrice);
  const grossPnl = move.mul(qty).toDecimalPlaces(8);
  // If the exit filled only partly, compare against the matching share of the entry.
  const share = t.quantity.gt(0) ? qty.div(t.quantity) : D(1);
  const entryPart = t.entryValue.mul(share);
  const netPnl = (t.side === "BUY" ? exitValue.minus(entryPart) : entryPart.minus(exitValue)).toDecimalPlaces(8);
  const result = { order, exitPrice, exitValue, grossPnl, netPnl, exitFee: fills.fee };

  const res = await withTransaction(async (tx) => {
    await lockRow(tx, model, id);
    const cur = await tx[model].findUniqueOrThrow({ where: { id } });
    if (cur.status !== "OPEN") return null;
    const closed = await tx[model].update({
      where: { id },
      data: { status: "CLOSED", exitOrderId: order.id, exitPrice, exitValue, fees: cur.fees.plus(fills.fee), grossPnl, netPnl, lastError: null, closingAt: null, closedAt: new Date(), ...closeData },
    });
    const extra = onClosed ? await onClosed(tx, { ...t, ...closed }, result) : null;
    return { closed, extra };
  });
  if (!res) return { row: await prisma[model].findUnique({ where: { id } }), closed: false };
  publish(t.userId, { type: "wallet.updated", assets: [market.baseAsset.symbol, market.quoteAsset.symbol] });
  return { row: res.closed, closed: true, extra: res.extra, result };
}
