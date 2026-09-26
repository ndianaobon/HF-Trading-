// Order ticket: buy/sell, market/limit/stop-limit, balance-aware sizing, fee
// estimate and a confirmation step (unless the user turned it off).

import { html, $, on, mount, cx } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api, ApiError, newIdempotencyKey } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { segmented, notice, toast, openModal } from "../core/ui.js";
import { formatNumber, formatPrice, toNum, trimNum as floorTo } from "../core/format.js";

const TYPES = [
  ["LIMIT", "Limit"],
  ["MARKET", "Market"],
  ["STOP_LIMIT", "Stop Limit"],
];
const cleanNum = (v) => v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");

const numField = (name, label, unit, { disabled, placeholder, value = "" } = {}) =>
  html`<label class="${cx("flex h-11 items-center rounded-[10px] border border-line-strong bg-base-2 px-3 transition-colors focus-within:border-accent/60", disabled && "opacity-70")}">
    <span class="w-16 shrink-0 text-xs text-dim">${label}</span>
    <input data-num="${name}" value="${value}" inputmode="decimal" autocomplete="off" aria-label="${label}" ${disabled ? html`disabled` : ""} ${placeholder ? html`placeholder="${placeholder}"` : ""} class="num min-w-0 flex-1 bg-transparent text-right text-sm text-white placeholder:text-dim focus:outline-none" />
    <span class="ml-2 w-12 shrink-0 text-right text-xs font-semibold text-muted">${unit}</span>
  </label>`;

/** Mounts the ticket. Returns { setLastPrice(p), pickPrice(p) }. */
export function mountOrderPanel(el, { market, user }) {
  const base = market.base.symbol;
  const quote = market.quote.symbol;
  const pdp = market.pricePrecision;
  const qdp = market.quantityPrecision;
  const s = { side: "BUY", type: "LIMIT", price: "", stop: "", amount: "", total: "", lastPrice: null, info: null, wallets: [], confirmPref: true, busy: false };

  const availQuote = () => toNum(s.wallets.find((w) => w.symbol === quote)?.available);
  const availBase = () => toNum(s.wallets.find((w) => w.symbol === base)?.available);
  const refPrice = () => (s.type === "MARKET" ? (s.lastPrice ?? 0) : toNum(s.price));
  const rate = () => toNum(s.type === "MARKET" ? s.info?.takerRate : s.info?.makerRate) || 0.001;
  const calc = () => {
    const notional = toNum(s.amount) * refPrice();
    const fee = notional * rate();
    return { notional, fee, total: s.side === "BUY" ? notional + fee : notional - fee };
  };

  const validation = () => {
    const q = toNum(s.amount);
    const { notional, total } = calc();
    if (!q) return "Enter an amount.";
    if (s.type !== "MARKET" && !toNum(s.price)) return "Enter a limit price.";
    if (s.type === "STOP_LIMIT" && !toNum(s.stop)) return "Enter a stop price.";
    if (s.info && q < toNum(s.info.minQuantity)) return `Minimum amount is ${s.info.minQuantity} ${base}.`;
    if (s.info && notional < toNum(s.info.minNotional)) return `Minimum order value is ${s.info.minNotional} ${quote}.`;
    if (s.info && notional > s.info.maxNotional) return `Maximum order value is ${Number(s.info.maxNotional).toLocaleString()} ${quote}.`;
    if (s.side === "BUY" && total > availQuote()) return `Insufficient ${quote} balance.`;
    if (s.side === "SELL" && q > availBase()) return `Insufficient ${base} balance.`;
    return null;
  };

  const blocked = () => {
    const i = s.info;
    if (i?.maintenance) return i.maintenance;
    if (i && !i.venue.available) return "Order execution is not available.";
    if (i && i.status !== "ACTIVE") return "This market is currently halted.";
    if (s.lastPrice === null) return "Live prices are unavailable — trading is paused.";
    return null;
  };

  function render() {
    mount(
      el,
      html`<div class="flex h-full flex-col p-3">
        ${segmented(
          [
            { value: "BUY", label: "Buy", cls: "seg-buy" },
            { value: "SELL", label: "Sell", cls: "seg-sell" },
          ],
          s.side,
          { name: "side", cls: "w-full" },
        )}
        <div class="mt-3 flex gap-1 text-xs font-semibold">${TYPES.map(([t, label]) => html`<button type="button" data-type="${t}" class="${cx("rounded-md px-2.5 py-1.5", s.type === t ? "bg-panel-3 text-white" : "text-dim hover:text-fg")}" aria-pressed="${s.type === t}">${label}</button>`)}</div>
        <div class="mt-3 flex items-center justify-between text-xs"><span class="text-dim">Available</span><span class="num text-fg" data-avail>—</span></div>
        <div class="mt-2 space-y-2">
          ${s.type === "STOP_LIMIT" ? numField("stop", "Stop", quote, { value: s.stop }) : ""}
          ${s.type === "MARKET" ? numField("mkt", "Price", quote, { disabled: true, placeholder: "Market" }) : numField("price", "Price", quote, { value: s.price })}
          ${numField("amount", "Amount", base, { value: s.amount })}
          <div class="grid grid-cols-4 gap-1.5">${[0.25, 0.5, 0.75, 1].map((p) => html`<button type="button" data-pct="${p}" ${user ? "" : html`disabled`} class="rounded-md border border-line py-1 text-[11px] font-semibold text-muted hover:border-line-strong hover:text-white disabled:opacity-40">${p * 100}%</button>`)}</div>
          ${numField("total", "Total", quote, { value: s.total })}
        </div>
        <dl class="mt-3 space-y-1.5 text-xs">
          <div class="flex justify-between"><dt class="text-dim" data-fee-label></dt><dd class="num text-fg" data-fee>—</dd></div>
          <div class="flex justify-between"><dt class="text-dim">Estimated ${s.side === "BUY" ? "cost" : "proceeds"}</dt><dd class="num font-semibold text-white" data-est>—</dd></div>
        </dl>
        <div class="mt-auto pt-4">
          <p class="mb-2 text-xs text-down" role="alert" data-err hidden></p>
          <div data-action></div>
          <p class="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-warn" data-sim hidden>${icon("flask-conical", "h-3 w-3")} Demo: filled by simulator at live prices</p>
        </div>
      </div>`,
    );
    update();
  }

  function update() {
    const { fee, total } = calc();
    const avail = $("[data-avail]", el);
    if (!avail) return;
    avail.textContent = user ? `${formatNumber(s.side === "BUY" ? availQuote() : availBase(), s.side === "BUY" ? 2 : 8)} ${s.side === "BUY" ? quote : base}` : "—";
    $("[data-fee-label]", el).textContent = `Fee (${(rate() * 100).toFixed(2)}% ${s.type === "MARKET" ? "taker" : "maker"})`;
    $("[data-fee]", el).textContent = fee ? `${formatNumber(fee, 4)} ${quote}` : "—";
    $("[data-est]", el).textContent = total > 0 ? `${formatNumber(total, 2)} ${quote}` : "—";
    const mkt = $('[data-num="mkt"]', el);
    if (mkt) mkt.placeholder = s.lastPrice ? `≈ ${formatPrice(s.lastPrice, pdp)} (market)` : "Market";
    $("[data-sim]", el).hidden = !s.info?.venue.simulated;
    const action = $("[data-action]", el);
    const reason = user && user.emailVerified ? blocked() : null;
    const key = !user ? "anon" : !user.emailVerified ? "unverified" : reason ? `blocked:${reason}` : `ok:${s.side}:${s.busy}`;
    if (action.dataset.key === key) return;
    action.dataset.key = key;
    mount(
      action,
      !user
        ? html`<div class="grid gap-2"><a href="/login?next=${encodeURIComponent(`/trade/${market.symbol}`)}" class="btn btn-primary w-full">Log in to trade</a><a href="/register" class="btn btn-secondary w-full">Create account</a></div>`
        : !user.emailVerified
          ? notice("warn", { body: html`<a href="/verify-email" class="underline">Verify your email</a> to start trading.` })
          : reason
            ? notice("warn", { body: reason })
            : html`<button type="button" data-place class="btn ${s.side === "BUY" ? "btn-buy" : "btn-sell"} btn-lg w-full" ${s.busy ? html`disabled` : ""}>${s.busy ? html`<span class="spinner" aria-hidden="true"></span>` : ""}${s.side === "BUY" ? "Buy" : "Sell"} ${base}</button>`,
    );
  }

  const setError = (msg) => {
    const e = $("[data-err]", el);
    e.textContent = msg ?? "";
    e.hidden = !msg;
  };
  const setInput = (name, v) => {
    const i = $(`[data-num="${name}"]`, el);
    if (i && i !== document.activeElement) i.value = v;
  };
  const setAmount = (v) => {
    s.amount = v;
    s.total = v && refPrice() ? (toNum(v) * refPrice()).toFixed(2) : "";
    setInput("amount", s.amount);
    setInput("total", s.total);
  };

  on(el, "click", "[data-side]", (_e, b) => {
    s.side = b.dataset.side;
    setError(null);
    render();
  });
  on(el, "click", "[data-type]", (_e, b) => {
    s.type = b.dataset.type;
    setError(null);
    render();
  });
  on(el, "input", "[data-num]", (e, i) => {
    const v = cleanNum(i.value);
    if (v !== i.value) i.value = v;
    const name = i.dataset.num;
    if (name === "amount") {
      s.amount = v;
      s.total = v && refPrice() ? (toNum(v) * refPrice()).toFixed(2) : "";
      setInput("total", s.total);
    } else if (name === "total") {
      s.total = v;
      s.amount = v && refPrice() ? floorTo(toNum(v) / refPrice(), qdp) : "";
      setInput("amount", s.amount);
    } else if (name === "price") {
      s.price = v;
      if (s.amount) setAmount(s.amount);
    } else if (name === "stop") s.stop = v;
    setError(null);
    update();
  });
  on(el, "click", "[data-pct]", (_e, b) => {
    const p = Number(b.dataset.pct);
    const ref = refPrice();
    if (!ref) return;
    setAmount(s.side === "BUY" ? floorTo((availQuote() * p) / (1 + rate()) / ref, qdp) : floorTo(availBase() * p, qdp));
    update();
  });
  on(el, "click", "[data-place]", () => {
    const v = validation();
    if (v) return setError(v);
    setError(null);
    if (s.confirmPref) confirmOrder();
    else submit();
  });

  async function submit(modal) {
    s.busy = true;
    update();
    try {
      const order = await api("/api/orders", {
        body: {
          market: market.symbol,
          side: s.side,
          type: s.type,
          quantity: floorTo(toNum(s.amount), qdp),
          ...(s.type !== "MARKET" ? { price: s.price } : {}),
          ...(s.type === "STOP_LIMIT" ? { stopPrice: s.stop } : {}),
          clientOrderId: newIdempotencyKey(),
        },
      });
      modal?.close();
      setAmount("");
      if (order.status === "FILLED") toast.success(`${s.side === "BUY" ? "Bought" : "Sold"} ${formatNumber(order.filledQuantity, qdp)} ${base}`, `Filled at ${formatPrice(order.avgFillPrice, pdp)} ${quote}`);
      else toast.info("Order placed", `${s.type.replace("_", "-").toLowerCase()} order is open.`);
      ["/api/orders", "/api/trades", "/api/wallets", "/api/portfolio", "/api/transactions"].forEach(invalidate);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Order failed.";
      if (modal) mount($("[data-modal-err]", modal.el), html`<p class="mt-2 text-xs text-down">${msg}</p>`);
      else setError(msg);
      invalidate("/api/orders");
    } finally {
      s.busy = false;
      update();
    }
  }

  function confirmOrder() {
    const { fee, total } = calc();
    const buy = s.side === "BUY";
    const rows = [
      ["Market", market.symbol.replace("-", "/")],
      ["Type", s.type === "STOP_LIMIT" ? "Stop limit" : s.type === "LIMIT" ? "Limit" : "Market"],
      ...(s.type === "STOP_LIMIT" ? [["Stop price", `${s.stop} ${quote}`]] : []),
      ["Price", s.type === "MARKET" ? `Market (≈ ${formatPrice(s.lastPrice, pdp)})` : `${s.price} ${quote}`],
      ["Amount", `${floorTo(toNum(s.amount), qdp)} ${base}`],
      ["Estimated fee", `${formatNumber(fee, 4)} ${quote}`],
      [buy ? "Estimated cost" : "Estimated proceeds", `${formatNumber(total, 2)} ${quote}`],
    ];
    const m = openModal({
      title: `Confirm ${buy ? "buy" : "sell"} order`,
      size: "sm",
      body: html`<dl class="space-y-2 text-sm">${rows.map(([k, v]) => html`<div class="flex justify-between gap-4 border-b border-line/60 pb-2"><dt class="text-dim">${k}</dt><dd class="num text-right text-white">${v}</dd></div>`)}</dl>
        <p class="mt-3 flex gap-2 text-xs text-dim">${icon("info", "h-3.5 w-3.5 shrink-0")}${s.type === "MARKET" ? "Market orders execute immediately; the final price may differ slightly from the estimate." : "Limit orders rest until the market reaches your price, and may fill in parts."}</p>
        <div data-modal-err></div>`,
      footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn ${buy ? "btn-buy" : "btn-sell"}" data-confirm>Confirm ${buy ? "buy" : "sell"}</button>`,
    });
    on(m.el, "click", "[data-confirm]", async (_e, b) => {
      b.disabled = true;
      await submit(m);
      b.disabled = false;
    });
  }

  watch(`/api/trading/info?market=${market.symbol}`, ({ data }) => {
    if (!data) return;
    s.info = data;
    update();
  });
  if (user) {
    watch("/api/wallets", ({ data }) => {
      if (!data) return;
      s.wallets = data;
      update();
    });
    watch("/api/users/me", ({ data }) => data && (s.confirmPref = data.profile?.preferences?.confirmOrders !== false));
  }
  render();

  return {
    setLastPrice(p) {
      s.lastPrice = p;
      if (!s.price && p) {
        s.price = p.toFixed(pdp);
        setInput("price", s.price);
      }
      if (s.type === "MARKET" && s.amount) {
        s.total = (toNum(s.amount) * p).toFixed(2);
        setInput("total", s.total);
      }
      update();
    },
    pickPrice(p) {
      s.price = p.toFixed(pdp);
      if (s.type === "MARKET") {
        s.type = "LIMIT";
        render();
      } else setInput("price", s.price);
      if (s.amount) setAmount(s.amount);
      update();
    },
  };
}
