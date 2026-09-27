import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { isProduction } from "@/lib/config";
import { getLastPrice, getMarket } from "@/lib/market-data/service";
import { venueStatus } from "@/lib/trading/venue";
import { getBotConfig } from "@/lib/autobot/config";
import { handleSetup, newsBlock, sessionState } from "@/lib/autobot/engine";

const body = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{2,10}-[A-Z]{3,5}$/),
  side: z.enum(["BUY", "SELL"]).default("BUY"),
  stopPct: z.number().positive().max(20).default(1),
  targetPct: z.number().positive().max(50).default(3),
});

/**
 * DEVELOPMENT ONLY — injects a synthetic READY setup at the live price so the
 * gates, risk engine, execution and exits can be tested without waiting for a
 * real SMC setup. The signal is labelled as a developer test. 404 in production.
 */
export const POST = route({ admin: "autobot.manage", body }, async ({ body }) => {
  if (isProduction()) throw new AppError("NOT_FOUND");
  const market = await getMarket(body.symbol);
  if (!market) throw new AppError("NOT_FOUND", "Unknown market.");
  const last = await getLastPrice(market.symbol);
  const buy = body.side === "BUY";
  const stopLoss = last * (1 - (buy ? 1 : -1) * (body.stopPct / 100));
  const takeProfit = last * (1 + (buy ? 1 : -1) * (body.targetPct / 100));
  const s = {
    side: body.side,
    key: `${body.side}:devtest:${Date.now()}`,
    status: "READY",
    reason: null,
    conditions: [{ key: "devTest", label: "Developer test injection", required: true, passed: true, detail: "Synthetic setup — development only, not available in production" }],
    htfBias: [{ tf: "test", trend: buy ? "BULLISH" : "BEARISH" }],
    zone: { low: last * 0.999, high: last * 1.001 },
    stopLoss,
    takeProfit,
    riskReward: body.targetPct / body.stopPct,
    entryPrice: last,
  };
  const cfg = await getBotConfig();
  await handleSetup(cfg, market, s, { session: sessionState(cfg.settings, market.symbol), news: newsBlock(cfg.settings, market.symbol), venue: venueStatus() });
  return { setupKey: `${market.symbol}:${s.key}`, entry: last, stopLoss, takeProfit };
});
