// Realtime user events over Server-Sent Events (/api/realtime). Events
// invalidate cached API data; after repeated failures we fall back to polling.

import { invalidate } from "./store.js";
import { toast } from "./ui.js";

const INVALIDATIONS = {
  "wallet.updated": ["/api/wallets", "/api/portfolio"],
  "order.updated": ["/api/orders"],
  "trade.executed": ["/api/orders", "/api/trades", "/api/transactions", "/api/portfolio"],
  "notification.created": ["/api/notifications"],
  "deposit.updated": ["/api/deposits", "/api/transactions", "/api/wallets", "/api/portfolio"],
  "withdrawal.updated": ["/api/withdrawals", "/api/transactions", "/api/wallets"],
  "support.message": ["/api/support"],
  "bot.updated": ["/api/bots"],
};
const POLL_KEYS = ["/api/notifications", "/api/wallets", "/api/orders", "/api/deposits", "/api/withdrawals", "/api/support", "/api/bots"];

let started = false;

export function startRealtime() {
  if (started || typeof EventSource === "undefined") return;
  started = true;
  let es = null;
  let failures = 0;
  let poll = null;

  const startPolling = () => {
    if (poll) return;
    poll = setInterval(() => document.visibilityState === "visible" && POLL_KEYS.forEach(invalidate), 15000);
  };

  const connect = () => {
    es = new EventSource("/api/realtime");
    es.addEventListener("ready", () => {
      failures = 0;
      clearInterval(poll);
      poll = null;
    });
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data);
        (INVALIDATIONS[event.type] ?? []).forEach(invalidate);
        if (event.type === "trade.executed") {
          toast.success(`Order filled · ${event.market}`, `${event.side === "BUY" ? "Bought" : "Sold"} ${event.quantity} at ${Number(event.price).toLocaleString()}`);
        }
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      if (++failures >= 3) {
        es.close();
        startPolling();
        setTimeout(() => {
          failures = 0;
          connect();
        }, 60000);
      }
    };
  };
  connect();
}
