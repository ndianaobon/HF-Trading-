import "server-only";

/**
 * Public Yahoo Finance chart data (no API key) for forex, shares and indices.
 * This is an unofficial endpoint: quotes can be delayed and the format can change,
 * so callers must handle failures and label prices as possibly delayed.
 */
const BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";

export async function fetchYahooQuote(symbol) {
  const res = await fetch(`${BASE}${encodeURIComponent(symbol)}?range=1d&interval=15m`, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`Quote request failed: ${res.status}`);
  const body = await res.json();
  const r = body?.chart?.result?.[0];
  const m = r?.meta;
  if (!m || !Number.isFinite(m.regularMarketPrice)) throw new Error(`No quote for ${symbol}`);
  const prev = m.chartPreviousClose ?? m.previousClose ?? null;
  const change = prev ? m.regularMarketPrice - prev : null;
  const closes = (r.indicators?.quote?.[0]?.close ?? []).filter((v) => Number.isFinite(v));
  return {
    symbol,
    price: m.regularMarketPrice,
    previousClose: prev,
    change,
    changePercent: prev ? (change / prev) * 100 : null,
    high: m.regularMarketDayHigh ?? null,
    low: m.regularMarketDayLow ?? null,
    currency: m.currency ?? null,
    exchange: m.fullExchangeName ?? m.exchangeName ?? null,
    time: m.regularMarketTime ? m.regularMarketTime * 1000 : null,
    spark: closes,
  };
}
