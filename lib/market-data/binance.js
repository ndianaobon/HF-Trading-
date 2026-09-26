import "server-only";

/** Public Binance market data (no API key). data-api.binance.vision serves market data only. */
export class BinanceMarketData {
  baseUrl;
  name = "Binance";
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async get(path) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Market data request failed: ${res.status}`);
    return await res.json();
  }

  async fetchTickers(providerSymbols) {
    const encoded = encodeURIComponent(JSON.stringify(providerSymbols));
    const rows = await this.get(`/api/v3/ticker/24hr?symbols=${encoded}`);
    return rows.map((r) => ({
      providerSymbol: r.symbol,
      lastPrice: Number(r.lastPrice),
      priceChange: Number(r.priceChange),
      changePercent: Number(r.priceChangePercent),
      high: Number(r.highPrice),
      low: Number(r.lowPrice),
      volume: Number(r.volume),
      quoteVolume: Number(r.quoteVolume),
      bid: r.bidPrice ? Number(r.bidPrice) : null,
      ask: r.askPrice ? Number(r.askPrice) : null,
      closeTime: r.closeTime,
    }));
  }

  async fetchCandles(providerSymbol, interval, limit) {
    const rows = await this.get(`/api/v3/klines?symbol=${providerSymbol}&interval=${interval}&limit=${limit}`);
    return rows.map((k) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }));
  }

  async fetchOrderBook(providerSymbol, depth) {
    const raw = await this.get(`/api/v3/depth?symbol=${providerSymbol}&limit=${depth}`);
    return {
      bids: raw.bids.map(([p, q]) => [Number(p), Number(q)]),
      asks: raw.asks.map(([p, q]) => [Number(p), Number(q)]),
      asOf: Date.now(),
    };
  }
}
