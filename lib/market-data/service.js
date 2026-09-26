import "server-only";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/config";
import { AppError } from "@/lib/api/errors";
import { BinanceMarketData } from "./binance";

/**
 * MarketDataService — the single source of prices for the platform.
 *
 * Guarantees:
 *  - Prices only ever come from the configured provider. There is no
 *    synthetic fallback; if the feed is down callers receive
 *    MARKET_DATA_UNAVAILABLE (or clearly-flagged stale data up to 2 minutes).
 *  - Responses are cached briefly and concurrent requests are de-duplicated.
 */
const TICKER_TTL = 4_000;
const STALE_LIMIT = 120_000;
/** Used to express USDT against USDC for the ticker strip (inverted). */
const PEG_SYMBOL = "USDCUSDT";

const g = globalThis;
const state = (g.__hfMarket ??= {
  provider: null,
  tickers: null,
  inflight: null,
  candles: new Map(),
  books: new Map(),
  markets: null,
  lastError: null,
});

function provider() {
  if (env().MARKET_DATA_PROVIDER === "disabled") return null;
  state.provider ??= new BinanceMarketData(env().MARKET_DATA_BASE_URL);
  return state.provider;
}

export async function listMarkets(opts = {}) {
  if (!opts.includeInactive && state.markets && Date.now() - state.markets.at < 60_000) return state.markets.value;
  const rows = await prisma.market.findMany({
    where: opts.includeInactive ? {} : { status: { not: "DELISTED" } },
    orderBy: [{ sortOrder: "asc" }, { symbol: "asc" }],
    include: { baseAsset: true, quoteAsset: true },
  });
  const mapped = rows.map((m) => ({
    id: m.id,
    symbol: m.symbol,
    providerSymbol: m.providerSymbol,
    status: m.status,
    pricePrecision: m.pricePrecision,
    quantityPrecision: m.quantityPrecision,
    minQuantity: m.minQuantity.toString(),
    minNotional: m.minNotional.toString(),
    categories: m.categories,
    isFeatured: m.isFeatured,
    baseAssetId: m.baseAssetId,
    quoteAssetId: m.quoteAssetId,
    base: { symbol: m.baseAsset.symbol, name: m.baseAsset.name, color: m.baseAsset.color },
    quote: { symbol: m.quoteAsset.symbol },
  }));
  if (!opts.includeInactive) state.markets = { value: mapped, at: Date.now() };
  return mapped;
}

export function invalidateMarketCache() {
  state.markets = null;
}

export async function getMarket(symbol) {
  const markets = await listMarkets();
  return markets.find((m) => m.symbol === symbol.toUpperCase()) ?? null;
}

async function refreshTickers() {
  const p = provider();
  if (!p) throw new AppError("MARKET_DATA_UNAVAILABLE", "Market data provider is not configured.");
  const markets = await listMarkets();
  const bySymbol = new Map(markets.map((m) => [m.providerSymbol, m.symbol]));
  const symbols = [...new Set([...markets.map((m) => m.providerSymbol), PEG_SYMBOL])];
  const rows = await p.fetchTickers(symbols);
  const map = new Map();
  for (const r of rows) {
    const symbol = bySymbol.get(r.providerSymbol) ?? r.providerSymbol;
    map.set(symbol, { ...r, symbol });
  }
  return map;
}

/** Returns tickers keyed by platform symbol plus feed status. */
export async function getTickers() {
  const now = Date.now();
  const cached = state.tickers;
  if (cached && now - cached.at < TICKER_TTL) {
    return { tickers: cached.value, status: { provider: provider()?.name ?? "none", live: true, stale: false, asOf: cached.at } };
  }
  try {
    state.inflight ??= refreshTickers().finally(() => {
      state.inflight = null;
    });
    const value = await state.inflight;
    state.tickers = { value, at: Date.now() };
    state.lastError = null;
    return { tickers: value, status: { provider: provider()?.name ?? "none", live: true, stale: false, asOf: state.tickers.at } };
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    if (cached && now - cached.at < STALE_LIMIT) {
      return { tickers: cached.value, status: { provider: provider()?.name ?? "none", live: false, stale: true, asOf: cached.at } };
    }
    if (err instanceof AppError) throw err;
    throw new AppError("MARKET_DATA_UNAVAILABLE");
  }
}

/** Last traded price for a market, or throws if no trustworthy price exists. */
export async function getLastPrice(marketSymbol) {
  const { tickers, status } = await getTickers();
  const t = tickers.get(marketSymbol);
  if (!t || !Number.isFinite(t.lastPrice) || t.lastPrice <= 0) throw new AppError("MARKET_DATA_UNAVAILABLE");
  if (status.stale) throw new AppError("MARKET_DATA_UNAVAILABLE", "Live prices are temporarily unavailable. Please try again shortly.");
  return t.lastPrice;
}

/**
 * Asset → price in USDT. Stablecoins without a market are valued via their
 * USDT pair when available; USDT itself is the unit of account (1).
 */
export async function getUsdtPrices() {
  const { tickers, status } = await getTickers();
  const prices = { USDT: 1 };
  for (const t of tickers.values()) {
    const [base, quote] = t.symbol.split("-");
    if (quote === "USDT" && base) prices[base] = t.lastPrice;
  }
  const peg = tickers.get(PEG_SYMBOL);
  if (peg && !prices.USDC) prices.USDC = peg.lastPrice;
  return { prices, status };
}

export async function getCandles(marketSymbol, interval, limit = 500) {
  const market = await getMarket(marketSymbol);
  if (!market) throw new AppError("NOT_FOUND", "Unknown market.");
  const p = provider();
  if (!p) throw new AppError("MARKET_DATA_UNAVAILABLE");
  const key = `${market.providerSymbol}:${interval}:${limit}`;
  const cached = state.candles.get(key);
  const ttl = interval === "1m" ? 5_000 : 15_000;
  if (cached && Date.now() - cached.at < ttl) return cached.value;
  try {
    const value = await p.fetchCandles(market.providerSymbol, interval, limit);
    state.candles.set(key, { value, at: Date.now() });
    if (state.candles.size > 400) state.candles.delete(state.candles.keys().next().value);
    return value;
  } catch {
    if (cached) return cached.value;
    throw new AppError("MARKET_DATA_UNAVAILABLE");
  }
}

export async function getOrderBook(marketSymbol, depth = 20) {
  const market = await getMarket(marketSymbol);
  if (!market) throw new AppError("NOT_FOUND", "Unknown market.");
  const p = provider();
  if (!p) throw new AppError("MARKET_DATA_UNAVAILABLE");
  const cached = state.books.get(market.providerSymbol);
  if (cached && Date.now() - cached.at < 2_000) return cached.value;
  try {
    const value = await p.fetchOrderBook(market.providerSymbol, depth);
    state.books.set(market.providerSymbol, { value, at: Date.now() });
    return value;
  } catch {
    throw new AppError("MARKET_DATA_UNAVAILABLE");
  }
}

export function pegTicker(tickers) {
  const peg = tickers.get(PEG_SYMBOL);
  if (!peg || !peg.lastPrice) return null;
  // Express USDT in USDC terms.
  const last = 1 / peg.lastPrice;
  const open = 1 / (peg.lastPrice - peg.priceChange || peg.lastPrice);
  return {
    ...peg,
    symbol: "USDT-USDC",
    lastPrice: last,
    priceChange: last - open,
    changePercent: ((last - open) / open) * 100,
    high: 1 / peg.low,
    low: 1 / peg.high,
    volume: peg.quoteVolume,
    quoteVolume: peg.volume,
    bid: null,
    ask: null,
  };
}

export function feedError() {
  return state.lastError;
}
