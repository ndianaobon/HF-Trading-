import "server-only";
import { prisma } from "@/lib/db/prisma";
import { D } from "@/lib/db/decimal";
import { AppError } from "@/lib/api/errors";
import { getLastPrice, getMarket } from "@/lib/market-data/service";
import { placeOrder } from "@/lib/trading/order-service";
import { venueStatus } from "@/lib/trading/venue";
import { notify } from "@/lib/notifications/service";
import { publish } from "@/lib/realtime/bus";

/**
 * Trading bots — user-defined automation on top of the normal order pipeline.
 *   DCA:           a market order for `quoteAmount` every `intervalMinutes`, optionally up to `maxRuns`.
 *   PRICE_TRIGGER: one market order for `quoteAmount` when the last price crosses `triggerPrice`.
 * Every run goes through placeOrder(), so risk checks, balances, fees and order history
 * behave exactly like a manual order. A failed run pauses the bot and notifies the user.
 */

const MAX_BOTS_PER_USER = 20;
export const BOT_INTERVALS = [60, 240, 1440, 10080]; // hourly, 4-hourly, daily, weekly

const include = {
  market: { select: { symbol: true, pricePrecision: true } },
  runs: { orderBy: { createdAt: "desc" }, take: 5 },
};

export function listBots(userId) {
  return prisma.tradingBot.findMany({ where: { userId, status: { not: "STOPPED" } }, orderBy: { createdAt: "desc" }, include });
}

export async function createBot(userId, input) {
  const market = await getMarket(input.market);
  if (!market || market.status !== "ACTIVE") throw new AppError("NOT_FOUND", "Unknown or inactive market.");
  const amount = D(input.amount);
  if (amount.lt(market.minNotional)) throw new AppError("VALIDATION_ERROR", `Each order must be at least ${D(market.minNotional).toString()} ${market.quote.symbol}.`);

  const count = await prisma.tradingBot.count({ where: { userId, status: { in: ["ACTIVE", "PAUSED"] } } });
  if (count >= MAX_BOTS_PER_USER) throw new AppError("CONFLICT", `You can run up to ${MAX_BOTS_PER_USER} bots at a time.`);

  const dca = input.strategy === "DCA";
  if (!dca) {
    const last = D(await getLastPrice(market.symbol));
    const target = D(input.triggerPrice);
    if (input.triggerDirection === "ABOVE" ? target.lte(last) : target.gte(last)) {
      throw new AppError("VALIDATION_ERROR", `Trigger price must be ${input.triggerDirection === "ABOVE" ? "above" : "below"} the current price (${last.toString()}).`);
    }
  }

  const bot = await prisma.tradingBot.create({
    data: {
      userId,
      marketId: market.id,
      name: input.name?.trim() || defaultName(input, market),
      strategy: input.strategy,
      side: input.side,
      quoteAmount: amount,
      intervalMinutes: dca ? input.intervalMinutes : null,
      triggerPrice: dca ? null : D(input.triggerPrice),
      triggerDirection: dca ? null : input.triggerDirection,
      maxRuns: dca ? (input.maxRuns ?? null) : 1,
      nextRunAt: dca ? new Date() : null,
      isDemo: venueStatus().simulated,
    },
    include,
  });
  return bot;
}

function defaultName(input, market) {
  const verb = input.side === "BUY" ? "Buy" : "Sell";
  if (input.strategy === "DCA") return `${verb} ${market.base.symbol} ${intervalLabel(input.intervalMinutes).toLowerCase()}`;
  return `${verb} ${market.base.symbol} ${input.triggerDirection === "ABOVE" ? "above" : "below"} ${input.triggerPrice}`;
}

function intervalLabel(m) {
  return { 60: "Hourly", 240: "Every 4 hours", 1440: "Daily", 10080: "Weekly" }[m] ?? `Every ${m} min`;
}

async function ownBot(userId, id) {
  const bot = await prisma.tradingBot.findUnique({ where: { id } });
  if (!bot || bot.userId !== userId || bot.status === "STOPPED") throw new AppError("NOT_FOUND");
  return bot;
}

export async function setBotStatus(userId, id, status) {
  const bot = await ownBot(userId, id);
  if (bot.status === "COMPLETED") throw new AppError("CONFLICT", "This bot has finished. Create a new one instead.");
  const now = new Date();
  return prisma.tradingBot.update({
    where: { id },
    data: {
      status,
      lastError: status === "ACTIVE" ? null : bot.lastError,
      // Resuming a DCA bot never back-fills missed runs.
      nextRunAt: status === "ACTIVE" && bot.strategy === "DCA" && (!bot.nextRunAt || bot.nextRunAt < now) ? now : bot.nextRunAt,
    },
    include,
  });
}

export async function stopBot(userId, id) {
  await ownBot(userId, id);
  await prisma.tradingBot.update({ where: { id }, data: { status: "STOPPED", nextRunAt: null } });
  return { ok: true };
}

/** Scheduler job: run due DCA bots and fire crossed price triggers. */
export async function processBots() {
  if (!venueStatus().available) return;
  const now = new Date();
  const [due, triggers] = await Promise.all([
    prisma.tradingBot.findMany({ where: { status: "ACTIVE", strategy: "DCA", nextRunAt: { lte: now } }, include: { market: true }, take: 100 }),
    prisma.tradingBot.findMany({ where: { status: "ACTIVE", strategy: "PRICE_TRIGGER" }, include: { market: true }, take: 1000 }),
  ]);
  for (const bot of due) await runBot(bot);
  for (const bot of triggers) {
    const last = await getLastPrice(bot.market.symbol).catch(() => null);
    if (last === null) continue;
    const crossed = bot.triggerDirection === "ABOVE" ? D(last).gte(bot.triggerPrice) : D(last).lte(bot.triggerPrice);
    if (crossed) await runBot(bot);
  }
}

async function runBot(bot) {
  const runNo = bot.runCount + 1;
  try {
    const last = D(await getLastPrice(bot.market.symbol));
    const quantity = bot.quoteAmount.div(last);
    const order = await placeOrder(bot.userId, { market: bot.market.symbol, side: bot.side, type: "MARKET", quantity: quantity.toString(), clientOrderId: `bot-${bot.id}-${runNo}` });
    if (order.status === "REJECTED") throw new AppError("ORDER_REJECTED", order.rejectReason ?? "Order rejected.");
    const done = bot.maxRuns !== null && runNo >= bot.maxRuns;
    await prisma.$transaction([
      prisma.tradingBotRun.create({ data: { botId: bot.id, orderId: order.id, success: true, price: order.avgFillPrice ?? last, quantity: order.filledQuantity } }),
      prisma.tradingBot.update({
        where: { id: bot.id },
        data: {
          runCount: runNo,
          lastRunAt: new Date(),
          lastError: null,
          status: done ? "COMPLETED" : "ACTIVE",
          nextRunAt: done || bot.strategy !== "DCA" ? null : new Date(Math.max(Date.now(), bot.nextRunAt.getTime() + bot.intervalMinutes * 60_000)),
        },
      }),
    ]);
    await notify({
      userId: bot.userId,
      type: "TRADE_EXECUTED",
      title: `Bot "${bot.name}" ${bot.side === "BUY" ? "bought" : "sold"} ${bot.market.symbol.split("-")[0]}`,
      body: `Run ${runNo}${bot.maxRuns ? ` of ${bot.maxRuns}` : ""}: ${bot.side.toLowerCase()} order for ${bot.quoteAmount.toString()} USDT at about ${last.toString()}.${done ? " The bot has finished." : ""}`,
      link: "/dashboard/bots",
    }).catch(() => {});
  } catch (err) {
    const message = err instanceof AppError ? err.message : "The order could not be placed.";
    await prisma.$transaction([
      prisma.tradingBotRun.create({ data: { botId: bot.id, success: false, message } }),
      prisma.tradingBot.update({ where: { id: bot.id }, data: { status: "PAUSED", lastError: message } }),
    ]);
    await notify({ userId: bot.userId, type: "TRADE_EXECUTED", title: `Bot "${bot.name}" paused`, body: `The last run failed: ${message} Fix the issue and resume the bot.`, link: "/dashboard/bots" }).catch(() => {});
  }
  publish(bot.userId, { type: "bot.updated", id: bot.id });
}
