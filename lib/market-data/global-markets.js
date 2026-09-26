import "server-only";
import { fetchYahooQuote } from "./yahoo";

/** Instruments shown on the Forex, Shares and Indices pages (market data only — not tradable). */
export const GLOBAL_MARKETS = {
  forex: [
    ["EURUSD=X", "EUR/USD", "Euro / US Dollar"],
    ["GBPUSD=X", "GBP/USD", "British Pound / US Dollar"],
    ["USDJPY=X", "USD/JPY", "US Dollar / Japanese Yen"],
    ["USDCHF=X", "USD/CHF", "US Dollar / Swiss Franc"],
    ["AUDUSD=X", "AUD/USD", "Australian Dollar / US Dollar"],
    ["USDCAD=X", "USD/CAD", "US Dollar / Canadian Dollar"],
    ["NZDUSD=X", "NZD/USD", "New Zealand Dollar / US Dollar"],
    ["EURGBP=X", "EUR/GBP", "Euro / British Pound"],
    ["EURJPY=X", "EUR/JPY", "Euro / Japanese Yen"],
    ["USDNGN=X", "USD/NGN", "US Dollar / Nigerian Naira"],
  ],
  shares: [
    ["AAPL", "AAPL", "Apple"],
    ["MSFT", "MSFT", "Microsoft"],
    ["NVDA", "NVDA", "NVIDIA"],
    ["AMZN", "AMZN", "Amazon"],
    ["GOOGL", "GOOGL", "Alphabet"],
    ["META", "META", "Meta Platforms"],
    ["TSLA", "TSLA", "Tesla"],
    ["JPM", "JPM", "JPMorgan Chase"],
    ["V", "V", "Visa"],
    ["NFLX", "NFLX", "Netflix"],
  ],
  indices: [
    ["^GSPC", "S&P 500", "United States"],
    ["^DJI", "Dow Jones", "United States"],
    ["^IXIC", "Nasdaq Composite", "United States"],
    ["^RUT", "Russell 2000", "United States"],
    ["^FTSE", "FTSE 100", "United Kingdom"],
    ["^GDAXI", "DAX", "Germany"],
    ["^FCHI", "CAC 40", "France"],
    ["^N225", "Nikkei 225", "Japan"],
    ["^HSI", "Hang Seng", "Hong Kong"],
  ],
};

const TTL = 30_000;
const cache = new Map();

/** Quotes for one asset class, cached for 30s. Instruments that fail to load are returned with price null. */
export async function globalMarketQuotes(assetClass) {
  const list = GLOBAL_MARKETS[assetClass];
  if (!list) return null;
  const hit = cache.get(assetClass);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const results = await Promise.allSettled(list.map(([symbol]) => fetchYahooQuote(symbol)));
  const rows = list.map(([symbol, label, name], i) => {
    const r = results[i];
    return r.status === "fulfilled" ? { ...r.value, label, name } : { symbol, label, name, price: null };
  });
  // Keep serving the last good snapshot if the provider is down entirely.
  if (rows.every((r) => r.price === null) && hit) return { ...hit.data, stale: true };
  const data = { assetClass, provider: "Yahoo Finance", updatedAt: Date.now(), stale: false, rows };
  cache.set(assetClass, { at: Date.now(), data });
  return data;
}
