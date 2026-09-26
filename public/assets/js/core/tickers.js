// Shared live market feed. One WebSocket to the public market-data stream for
// the whole page, falling back to polling /api/markets. Prices only ever come
// from the provider; the feed mode tells the UI whether data is live.

const WS_BASE = "wss://data-stream.binance.vision";

const state = { markets: [], tickers: {}, peg: null, mode: "connecting", provider: "", asOf: null };
const listeners = new Set();
let scheduled = false;

function emit() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    listeners.forEach((l) => l(state));
  }, 250);
}

const toLive = (t, prev) => ({
  symbol: t.symbol,
  lastPrice: t.lastPrice,
  changePercent: t.changePercent,
  priceChange: t.priceChange,
  high: t.high,
  low: t.low,
  volume: t.volume,
  quoteVolume: t.quoteVolume,
  updatedAt: t.closeTime ?? Date.now(),
  tick: prev ? (t.lastPrice > prev.lastPrice ? 1 : t.lastPrice < prev.lastPrice ? -1 : prev.tick) : 0,
});

async function pollOnce() {
  try {
    const res = await fetch("/api/markets", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const { data } = await res.json();
    state.markets = data.markets;
    if (data.tickers.length) {
      const next = {};
      for (const t of data.tickers) next[t.symbol] = toLive(t, state.tickers[t.symbol]);
      state.tickers = next;
    }
    if (data.peg) state.peg = toLive(data.peg, state.peg ?? undefined);
    state.provider = data.status?.provider ?? "";
    state.asOf = data.status?.asOf ?? null;
    state.mode = !data.tickers.length || !data.status ? "unavailable" : data.status.stale ? "delayed" : state.mode === "live" ? "live" : "polling";
    emit();
    return data.tickers.length > 0;
  } catch {
    state.mode = Object.keys(state.tickers).length ? "delayed" : "unavailable";
    emit();
    return false;
  }
}

let started = false;
let ws = null;
let pollTimer = null;
let retry = 0;

function startPolling(ms = 10000) {
  if (pollTimer) return;
  pollTimer = setInterval(() => document.visibilityState === "visible" && pollOnce(), ms);
}
function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

function connect() {
  if (!state.markets.length) return startPolling();
  const bySymbol = new Map(state.markets.map((m) => [m.providerSymbol, m.symbol]));
  const streams = [...state.markets.map((m) => m.providerSymbol), "USDCUSDT"].map((s) => `${s.toLowerCase()}@miniTicker`).join("/");
  try {
    ws = new WebSocket(`${WS_BASE}/stream?streams=${streams}`);
  } catch {
    return startPolling();
  }
  ws.onopen = () => {
    retry = 0;
    stopPolling();
    startPolling(60000); // low-frequency reconciliation with server feed status
    state.mode = "live";
    emit();
  };
  ws.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data).data;
      const last = Number(d.c);
      const open = Number(d.o);
      if (d.s === "USDCUSDT") {
        const inv = 1 / last;
        const invOpen = 1 / open;
        const prev = state.peg;
        state.peg = { symbol: "USDT-USDC", lastPrice: inv, priceChange: inv - invOpen, changePercent: ((inv - invOpen) / invOpen) * 100, high: 1 / Number(d.l), low: 1 / Number(d.h), volume: Number(d.q), quoteVolume: Number(d.v), updatedAt: d.E, tick: prev ? Math.sign(inv - prev.lastPrice) || prev.tick : 0 };
      } else {
        const symbol = bySymbol.get(d.s);
        if (!symbol) return;
        const prev = state.tickers[symbol];
        state.tickers = {
          ...state.tickers,
          [symbol]: { symbol, lastPrice: last, priceChange: last - open, changePercent: open ? ((last - open) / open) * 100 : 0, high: Number(d.h), low: Number(d.l), volume: Number(d.v), quoteVolume: Number(d.q), updatedAt: d.E, tick: prev ? Math.sign(last - prev.lastPrice) || prev.tick : 0 },
        };
      }
      state.asOf = d.E;
      state.mode = "live";
      emit();
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onclose = () => {
    ws = null;
    stopPolling();
    startPolling();
    state.mode = Object.keys(state.tickers).length ? "polling" : "connecting";
    emit();
    if (retry < 5) setTimeout(() => !ws && connect(), Math.min(30000, 1000 * 2 ** retry++));
  };
  ws.onerror = () => ws?.close();
}

async function start() {
  if (started) return;
  started = true;
  if (await pollOnce()) connect();
  else startPolling();
}

/** Subscribes to the market feed; the callback receives the full state. */
export function subscribeMarkets(cb) {
  listeners.add(cb);
  void start();
  if (state.markets.length) cb(state);
  return () => listeners.delete(cb);
}

export const marketState = () => state;
