import "server-only";
import { prisma } from "@/lib/db/prisma";
import { D } from "@/lib/db/decimal";

const DEFAULT_RATES = {
  TRADING_MAKER: "0.001",
  TRADING_TAKER: "0.001",
};

let cache = null;

const load = () => prisma.feeConfiguration.findMany({ where: { isActive: true } });

export function invalidateFeeCache() {
  cache = null;
}

/** Most specific active fee rule wins: market > asset > global. */
export async function feeRate(type, scope = {}) {
  if (!cache || Date.now() - cache.at > 60_000) cache = { at: Date.now(), rows: await load() };
  const rows = cache.rows.filter((r) => r.type === type);
  const match =
    rows.find((r) => scope.marketId && r.marketId === scope.marketId) ??
    rows.find((r) => scope.assetId && r.assetId === scope.assetId && !r.marketId) ??
    rows.find((r) => !r.marketId && !r.assetId);
  return match ? match.rate : D(DEFAULT_RATES[type] ?? 0);
}
