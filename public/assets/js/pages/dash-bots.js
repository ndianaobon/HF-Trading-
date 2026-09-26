import { html, $, on, mount } from "../core/dom.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { card, notice, emptyState, pageHeader, smallDemo, statusBadge, toast, openModal, confirmDialog, DataTable, segmented } from "../core/ui.js";
import { field, selectField } from "../core/forms.js";
import { formatDate, formatNumber, formatPrice, toNum } from "../core/format.js";
import { icon } from "../core/icons.js";
import { subscribeMarkets } from "../core/tickers.js";

const user = await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

const INTERVALS = [
  [60, "Every hour"],
  [240, "Every 4 hours"],
  [1440, "Every day"],
  [10080, "Every week"],
];
const intervalLabel = (m) => INTERVALS.find(([v]) => v === m)?.[1] ?? `Every ${m} min`;

let markets = [];
let tickers = {};
let bots = [];
subscribeMarkets((s) => {
  markets = s.markets;
  tickers = s.tickers;
});

mount(
  view,
  html`${pageHeader({
    title: "Trading Bots",
    description: "Automate recurring buys and sells, or place an order when a price is reached.",
    actions: html`<button type="button" class="btn btn-primary" data-new ${user.emailVerified ? "" : html`disabled`}>${icon("plus", "h-4 w-4")} New bot</button>`,
  })}
    ${user.emailVerified ? "" : notice("info", { cls: "mb-6", title: "Verify your email to create bots", body: "Bots place orders from your wallet, so they need a verified account." })}
    <div class="mb-6 grid gap-4 md:grid-cols-2">
      <div class="rounded-2xl border border-line bg-panel p-5"><div class="flex items-center gap-3"><span class="icon-tile">${icon("repeat", "h-5 w-5")}</span><div><p class="font-bold text-white">Recurring (DCA)</p><p class="text-sm text-muted">Buy or sell a fixed USDT amount on a schedule.</p></div></div></div>
      <div class="rounded-2xl border border-line bg-panel p-5"><div class="flex items-center gap-3"><span class="icon-tile">${icon("crosshair", "h-5 w-5")}</span><div><p class="font-bold text-white">Price trigger</p><p class="text-sm text-muted">Place one order when a coin rises above or falls below your price.</p></div></div></div>
    </div>
    ${card({ title: "My bots", description: html`<span data-bots-desc>Loading…</span>`, body: html`<div class="border-t border-line" data-bots></div>` })}`,
);

function rule(b) {
  const verb = b.side === "BUY" ? "Buy" : "Sell";
  const amt = `${formatNumber(b.quoteAmount, 2)} USDT`;
  if (b.strategy === "DCA") return `${verb} ${amt} · ${intervalLabel(b.intervalMinutes).toLowerCase()}${b.maxRuns ? ` · ${b.maxRuns} runs` : ""}`;
  return `${verb} ${amt} when price ${b.triggerDirection === "ABOVE" ? "≥" : "≤"} ${formatPrice(b.triggerPrice)}`;
}

function nextLabel(b) {
  if (b.status === "PAUSED") return b.lastError ? html`<span class="text-down">${b.lastError}</span>` : "Paused";
  if (b.status === "COMPLETED") return b.lastRunAt ? `Finished ${formatDate(b.lastRunAt)}` : "Finished";
  if (b.strategy === "PRICE_TRIGGER") {
    const last = tickers[b.market.symbol]?.lastPrice;
    return last ? `Waiting · now ${formatPrice(last)}` : "Waiting for price";
  }
  return b.nextRunAt ? `Next ${formatDate(b.nextRunAt)}` : "—";
}

const table = new DataTable($("[data-bots]", view), {
  empty: emptyState({ title: "No bots yet", description: "Create a bot to automate your first strategy." }),
  columns: [
    { key: "name", header: "Bot", cell: (b) => html`<div><p class="flex items-center gap-2 font-semibold text-white">${b.name} ${b.isDemo ? smallDemo() : ""}</p><p class="text-xs text-dim">${b.market.symbol.replace("-", "/")}</p></div>` },
    { key: "rule", header: "Rule", hideOnMobile: true, cell: (b) => html`<span class="text-sm text-muted">${rule(b)}</span>` },
    { key: "runs", header: "Runs", align: "right", cell: (b) => html`<span class="num">${b.runCount}${b.maxRuns ? ` / ${b.maxRuns}` : ""}</span>` },
    { key: "next", header: "Status detail", hideOnMobile: true, cell: (b) => html`<span class="text-xs text-muted">${nextLabel(b)}</span>` },
    { key: "status", header: "Status", cell: (b) => statusBadge(b.status) },
    {
      key: "act",
      header: html`<span class="sr-only">Actions</span>`,
      align: "right",
      cell: (b) =>
        html`<div class="flex justify-end gap-1">
          ${b.status === "ACTIVE" ? html`<button type="button" class="btn btn-ghost btn-sm" data-status="PAUSED" data-id="${b.id}">Pause</button>` : ""}
          ${b.status === "PAUSED" ? html`<button type="button" class="btn btn-ghost btn-sm" data-status="ACTIVE" data-id="${b.id}">Resume</button>` : ""}
          <button type="button" class="btn btn-ghost btn-sm text-down" data-stop="${b.id}">${b.status === "COMPLETED" ? "Remove" : "Stop"}</button>
        </div>`,
    },
  ],
});
table.set(undefined, { loading: true });

watch("/api/bots", ({ data, error }) => {
  if (!data) return error && table.set(undefined, { error });
  bots = data;
  const active = data.filter((b) => b.status === "ACTIVE").length;
  $("[data-bots-desc]", view).textContent = `${active} running · ${data.length - active} paused or finished`;
  table.set(data);
});

on(view, "click", "[data-status]", async (_e, b) => {
  b.disabled = true;
  try {
    await api(`/api/bots/${b.dataset.id}`, { method: "PATCH", body: { status: b.dataset.status } });
    toast.success(b.dataset.status === "ACTIVE" ? "Bot resumed" : "Bot paused");
    invalidate("/api/bots");
  } catch (err) {
    b.disabled = false;
    toast.error("Could not update bot", err.message);
  }
});

on(view, "click", "[data-stop]", async (_e, b) => {
  const bot = bots.find((x) => x.id === b.dataset.stop);
  if (!bot) return;
  const ok = await confirmDialog({
    title: bot.status === "COMPLETED" ? "Remove bot?" : "Stop bot?",
    message: `"${bot.name}" will stop and be removed from this list. Orders it already placed stay in your order history.`,
    confirmLabel: bot.status === "COMPLETED" ? "Remove" : "Stop bot",
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/bots/${bot.id}`, { method: "DELETE" });
    toast.success("Bot stopped");
    invalidate("/api/bots");
  } catch (err) {
    toast.error("Could not stop bot", err.message);
  }
});

on(view, "click", "[data-new]", () => createBot());

function createBot() {
  let strategy = "DCA";
  const m = openModal({ title: "New trading bot", description: "Each run places a market order at the current price, just like a manual trade.", size: "md" });
  const setError = (msg) => mount($("[data-err]", m.el), msg ? notice("down", { body: msg }) : "");
  const options = markets.map((x) => [x.symbol, x.symbol.replace("-", "/")]);
  const initial = options.find(([s]) => s === "BTC-USDT")?.[0] ?? options[0]?.[0] ?? "";

  const render = () => {
    const keep = Object.fromEntries(new FormData($("form", m.el) ?? document.createElement("form")));
    const market = keep.market ?? initial;
    m.setBody(html`<form class="space-y-4" novalidate data-bot-form>
      ${segmented(
        [
          { value: "DCA", label: "Recurring (DCA)" },
          { value: "PRICE_TRIGGER", label: "Price trigger" },
        ],
        strategy,
        { name: "strategy", cls: "w-full" },
      )}
      <div class="grid gap-4 sm:grid-cols-2">
        ${selectField({ name: "market", label: "Market", options, value: market })}
        ${selectField({ name: "side", label: "Action", options: [["BUY", "Buy"], ["SELL", "Sell"]], value: keep.side ?? "BUY" })}
      </div>
      <p class="text-xs text-dim" data-price>${priceLine(market)}</p>
      ${field({ name: "amount", label: "Amount per order", inputmode: "decimal", value: keep.amount ?? "50", suffix: "USDT" })}
      ${strategy === "DCA"
        ? html`<div class="grid gap-4 sm:grid-cols-2">
            ${selectField({ name: "intervalMinutes", label: "Schedule", options: INTERVALS, value: keep.intervalMinutes ?? 1440 })}
            ${field({ name: "maxRuns", label: "Number of runs", inputmode: "numeric", value: keep.maxRuns ?? "", placeholder: "No limit", hint: "Leave empty to run until you stop it" })}
          </div>`
        : html`<div class="grid gap-4 sm:grid-cols-2">
            ${selectField({ name: "triggerDirection", label: "When price", options: [["BELOW", "Falls to or below"], ["ABOVE", "Rises to or above"]], value: keep.triggerDirection ?? "BELOW" })}
            ${field({ name: "triggerPrice", label: "Trigger price", inputmode: "decimal", value: keep.triggerPrice ?? "", suffix: "USDT" })}
          </div>`}
      ${field({ name: "name", label: "Name (optional)", value: keep.name ?? "", placeholder: "e.g. Weekly BTC stack" })}
      <div data-err></div>
    </form>`);
    m.setFooter(html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn btn-primary" data-create>Create bot</button>`);
  };

  on(m.el, "click", "[data-strategy]", (_e, b) => {
    strategy = b.dataset.strategy;
    render();
  });
  on(m.el, "change", "[name=market]", (e) => ($("[data-price]", m.el).textContent = priceLine(e.target.value)));
  on(m.el, "submit", "[data-bot-form]", (e) => {
    e.preventDefault();
    $("[data-create]", m.el)?.click();
  });
  on(m.el, "click", "[data-create]", async (_e, btn) => {
    const f = Object.fromEntries(new FormData($("form", m.el)));
    if (!(toNum(f.amount) > 0)) return setError("Enter the amount to spend per order.");
    if (strategy === "PRICE_TRIGGER" && !(toNum(f.triggerPrice) > 0)) return setError("Enter a trigger price.");
    const body = { strategy, market: f.market, side: f.side, amount: f.amount.trim(), name: f.name || undefined };
    if (strategy === "DCA") Object.assign(body, { intervalMinutes: Number(f.intervalMinutes), maxRuns: f.maxRuns ? Number(f.maxRuns) : undefined });
    else Object.assign(body, { triggerDirection: f.triggerDirection, triggerPrice: f.triggerPrice.trim() });
    btn.disabled = true;
    try {
      await api("/api/bots", { body });
      toast.success("Bot created", strategy === "DCA" ? "Its first order will be placed within a minute." : "It will place its order when the price is reached.");
      m.close();
      invalidate("/api/bots");
    } catch (err) {
      btn.disabled = false;
      setError(err.message ?? "Something went wrong.");
    }
  });
  render();
}

function priceLine(symbol) {
  const last = tickers[symbol]?.lastPrice;
  return last ? `Current price: ${formatPrice(last)} USDT` : "Current price loading…";
}
