// Per-market live stream for the trading page: current kline, top-20 order book
// and recent trades from the public WebSocket, with REST fallback for the book.

const WS_BASE = "wss://data-stream.binance.vision";

export function openMarketStream(market, providerSymbol, interval, cb) {
  const state = { kline: null, book: null, trades: [], connected: false };
  let ws = null;
  let poll = null;
  let closed = false;
  let retries = 0;
  let pending = false;

  const emit = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (!closed) cb(state);
    });
  };

  const pollBook = async () => {
    try {
      const res = await fetch(`/api/markets/${market}/orderbook`, { cache: "no-store" });
      if (res.ok) {
        state.book = (await res.json()).data;
        emit();
      }
    } catch {
      /* keep last book */
    }
  };
  const startPolling = () => {
    if (poll) return;
    void pollBook();
    poll = setInterval(() => document.visibilityState === "visible" && pollBook(), 3000);
  };
  const stopPolling = () => {
    clearInterval(poll);
    poll = null;
  };

  const connect = () => {
    if (closed) return;
    const s = providerSymbol.toLowerCase();
    ws = new WebSocket(`${WS_BASE}/stream?streams=${s}@kline_${interval}/${s}@depth20@1000ms/${s}@aggTrade`);
    ws.onopen = () => {
      retries = 0;
      state.connected = true;
      stopPolling();
      emit();
    };
    ws.onmessage = (ev) => {
      try {
        const { stream, data } = JSON.parse(ev.data);
        if (stream.endsWith(`@kline_${interval}`)) {
          const k = data.k;
          state.kline = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
        } else if (stream.includes("@depth")) {
          state.book = { bids: data.bids.map((b) => [+b[0], +b[1]]), asks: data.asks.map((a) => [+a[0], +a[1]]), asOf: Date.now() };
        } else if (stream.endsWith("@aggTrade")) {
          state.trades = [{ id: data.a, price: +data.p, qty: +data.q, sell: data.m, time: data.T }, ...state.trades].slice(0, 40);
        }
        emit();
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      state.connected = false;
      ws = null;
      if (closed) return;
      startPolling();
      emit();
      if (retries < 5) setTimeout(connect, Math.min(20000, 1000 * 2 ** retries++));
    };
    ws.onerror = () => ws?.close();
  };

  connect();
  const fallback = setTimeout(() => (!ws || ws.readyState !== WebSocket.OPEN) && startPolling(), 4000);

  return () => {
    closed = true;
    clearTimeout(fallback);
    stopPolling();
    ws?.close();
  };
}
