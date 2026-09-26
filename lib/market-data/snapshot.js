import "server-only";
import { getTickers, listMarkets, pegTicker } from "./service";

/**
 * Markets + tickers payload used by /api/markets and server-rendered pages.
 * When the feed is unavailable, tickers is empty and status is null — callers
 * render an explicit "unavailable" state rather than placeholder prices.
 */
export async function marketsSnapshot() {
  const markets = await listMarkets();
  let tickers = [];
  let peg = null;
  let status = null;
  try {
    const res = await getTickers();
    tickers = markets.map((m) => res.tickers.get(m.symbol)).filter((t) => !!t);
    peg = pegTicker(res.tickers);
    status = res.status;
  } catch {
    /* feed unavailable */
  }
  return {
    markets: markets.map(({ baseAssetId: _b, quoteAssetId: _q, ...m }) => m),
    tickers,
    peg,
    status,
  };
}
