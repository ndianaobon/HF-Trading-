import "server-only";
import { prisma } from "@/lib/db/prisma";
import { D, ZERO, floor } from "@/lib/db/decimal";
import { getPortfolio } from "@/lib/trading/portfolio-service";
import { feeRate } from "@/lib/trading/fees";

/**
 * Per-account risk engine for the automated trading bot. Every check must pass
 * before a position is sized; the first failure is returned as a user-safe reason.
 */

export const startOfUtcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Unrealised P&L of an open bot trade at `price` (before the closing fee). */
export function openPnl(t, price) {
  if (t.status !== "OPEN" || !price || !t.entryValue) return null;
  const value = t.quantity.mul(price);
  return t.side === "BUY" ? value.minus(t.entryValue) : t.entryValue.minus(value);
}

/** Realised + open P&L for a participant: today, all-time, and the drawdown of the cumulative curve. */
export async function accountPnl(participant, priceOf) {
  const trades = await prisma.autoBotTrade.findMany({
    where: { participantId: participant.id, status: { in: ["OPEN", "CLOSED"] } },
    include: { market: { select: { symbol: true } } },
    orderBy: { closedAt: "asc" },
  });
  const today = startOfUtcDay();
  let realized = ZERO;
  let realizedToday = ZERO;
  let open = ZERO;
  let peak = ZERO;
  let cum = ZERO;
  const closedToday = [];
  for (const t of trades) {
    if (t.status === "CLOSED") {
      realized = realized.plus(t.netPnl ?? ZERO);
      cum = cum.plus(t.netPnl ?? ZERO);
      if (cum.gt(peak)) peak = cum;
      if (t.closedAt >= today) {
        realizedToday = realizedToday.plus(t.netPnl ?? ZERO);
        closedToday.push(t);
      }
    } else {
      open = open.plus(openPnl(t, priceOf(t.market.symbol)) ?? ZERO);
    }
  }
  const current = cum.plus(open);
  const drawdown = peak.minus(current);
  // Losses in a row among today's closed trades, most recent first.
  let streak = 0;
  for (const t of [...closedToday].reverse()) {
    if ((t.netPnl ?? ZERO).lt(0)) streak++;
    else break;
  }
  return { realized, realizedToday, open, today: realizedToday.plus(open), drawdown: drawdown.gt(0) ? drawdown : ZERO, lossStreakToday: streak, openTrades: trades.filter((t) => t.status === "OPEN") };
}

/**
 * Sizes a position for one participant, or explains why it must not be opened.
 *   signal: { side, entryPrice, stopLoss, takeProfit, riskReward }
 * Returns { ok: true, quantity, notional, riskAmount, equity } or { ok: false, reason, pause? }.
 */
export async function sizePosition({ participant, market, signal, settings, priceOf }) {
  const r = settings.risk;
  const entry = D(signal.entryPrice);
  const sl = D(signal.stopLoss);
  const perUnit = signal.side === "BUY" ? entry.minus(sl) : sl.minus(entry);
  if (!signal.stopLoss || perUnit.lte(0)) return { ok: false, reason: "A valid stop loss is required." };
  if (signal.riskReward === null || signal.riskReward < r.minRiskReward) return { ok: false, reason: `Risk/reward is below the 1:${r.minRiskReward} minimum.` };
  // Risk/reward after trading fees: both legs pay the taker fee, which shrinks the
  // reward and enlarges the risk. Tight targets can lose money even when hit.
  const fee = await feeRate("TRADING_TAKER", { marketId: market.id });
  const roundTrip = entry.mul(fee).mul(2);
  const reward = (signal.side === "BUY" ? D(signal.takeProfit).minus(entry) : entry.minus(D(signal.takeProfit))).minus(roundTrip);
  const netRr = reward.div(perUnit.plus(roundTrip));
  if (netRr.lt(r.minRiskReward)) {
    return { ok: false, reason: `Risk/reward after fees is 1:${netRr.toDecimalPlaces(2)}, below the 1:${r.minRiskReward} minimum.` };
  }

  const portfolio = await getPortfolio(participant.userId);
  if (portfolio.totalValue === null) return { ok: false, reason: "Account value unavailable (no live prices)." };
  const equity = D(portfolio.totalValue.toFixed(8));
  if (equity.lte(0)) return { ok: false, reason: "No account balance." };

  const pnl = await accountPnl(participant, priceOf);
  if (pnl.openTrades.length >= r.maxOpenTrades) return { ok: false, reason: `Maximum of ${r.maxOpenTrades} open bot trades reached.` };
  if (pnl.today.lt(0) && pnl.today.neg().gte(equity.mul(r.maxDailyLossPct).div(100))) return { ok: false, reason: `Daily loss limit of ${r.maxDailyLossPct}% reached. Trading resumes at 00:00 UTC.` };
  const base = participant.startEquity.gt(0) ? participant.startEquity : equity;
  if (pnl.drawdown.gte(base.mul(r.maxDrawdownPct).div(100))) return { ok: false, reason: `Maximum drawdown of ${r.maxDrawdownPct}% reached. Participation paused.`, pause: true };
  if (pnl.lossStreakToday >= r.maxConsecutiveLosses) return { ok: false, reason: `${pnl.lossStreakToday} losing trades in a row today. Trading resumes at 00:00 UTC.` };
  if (signal.side === "SELL") return { ok: false, reason: "Short selling is not available on spot markets." };

  // Size from risk, then cap by exposure limits and available cash (spot: no leverage).
  let riskAmount = equity.mul(r.riskPerTradePct).div(100);
  let quantity = riskAmount.div(perUnit);
  let notional = quantity.mul(entry);
  const openNotional = (filter) => pnl.openTrades.filter(filter).reduce((a, t) => a.plus(t.notional), ZERO);
  const instPct = settings.instruments[market.symbol]?.maxExposurePct ?? r.maxExposurePerInstrumentPct;
  const caps = [
    [equity.mul(instPct).div(100).minus(openNotional((t) => t.marketId === market.id)), `the ${instPct}% exposure limit for ${market.symbol}`],
    [equity.mul(r.maxTotalExposurePct).div(100).minus(openNotional(() => true)), `the ${r.maxTotalExposurePct}% total exposure limit`],
    [D(portfolio.availableBalance.toFixed(8)).div(1.01), "your available USDT balance"],
  ];
  let cappedBy = null;
  for (const [cap, label] of caps) {
    if (notional.gt(cap)) {
      notional = cap.gt(0) ? cap : ZERO;
      cappedBy = label;
    }
  }
  quantity = floor(notional.div(entry), market.quantityPrecision);
  notional = quantity.mul(entry);
  riskAmount = quantity.mul(perUnit);
  if (notional.lt(market.minNotional) || quantity.lt(market.minQuantity)) {
    return { ok: false, reason: cappedBy ? `Position too small after applying ${cappedBy}.` : `Position is below the ${market.symbol} minimum order size.` };
  }
  return { ok: true, quantity, notional: notional.toDecimalPlaces(8), riskAmount: riskAmount.toDecimalPlaces(8), equity, cappedBy };
}
