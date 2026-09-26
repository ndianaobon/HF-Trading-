// Open orders / order history / trade history for the trading page, with an
// order lifecycle dialog.

import { html, $, on, mount, cx } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { tabs, emptyState, statusBadge, smallDemo, toast, openModal, skeleton, DataTable } from "../core/ui.js";
import { formatDate, formatNumber, formatPrice, titleCase } from "../core/format.js";

export function mountOrdersPanel(el, { market, user }) {
  let tab = "open";
  let onlyCurrent = false;
  let openCount;
  let unsub = null;
  let countUnsub = null;

  mount(
    el,
    html`<div class="flex flex-col gap-2 border-b border-line px-3 sm:flex-row sm:items-center sm:justify-between">
      <div data-tabs></div>
      ${user ? html`<label class="flex cursor-pointer items-center gap-2 pb-2 text-xs text-muted select-none sm:pb-0"><input type="checkbox" class="checkbox" data-only /> Current market only</label>` : ""}
    </div>
    <div data-body></div>`,
  );
  const body = $("[data-body]", el);
  const drawTabs = () =>
    mount(
      $("[data-tabs]", el),
      tabs(
        [
          { value: "open", label: "Open Orders", count: openCount },
          { value: "history", label: "Order History" },
          { value: "trades", label: "Trade History" },
        ],
        tab,
        { size: "sm", name: "otab", cls: "border-0" },
      ),
    );
  drawTabs();

  if (!user) {
    mount(body, emptyState({ title: "Log in to see your orders", cls: "py-8", action: html`<a href="/login?next=${encodeURIComponent(`/trade/${market}`)}" class="text-sm font-semibold text-accent">Log in →</a>` }));
    return;
  }

  const pair = (o) => html`<a href="/trade/${o.market.symbol}" class="font-semibold text-white hover:text-accent">${o.market.symbol.replace("-", "/")}</a>`;
  const sideCell = (o) => html`<span class="flex items-center gap-1.5"><span class="${cx("font-semibold", o.side === "BUY" ? "text-up" : "text-down")}">${o.side === "BUY" ? "Buy" : "Sell"}</span>${o.isDemo ? smallDemo() : ""}</span>`;
  const typeLabel = (o) => (o.type === "STOP_LIMIT" ? `Stop limit${o.triggered ? " · triggered" : ""}` : titleCase(o.type));
  const date = (o) => html`<span class="text-xs text-muted">${formatDate(o.createdAt)}</span>`;

  const COLUMNS = {
    open: [
      { key: "d", header: "Date", cell: date },
      { key: "p", header: "Pair", cell: pair },
      { key: "t", header: "Type", cell: (o) => html`<span class="text-xs">${typeLabel(o)}</span>` },
      { key: "s", header: "Side", cell: sideCell },
      { key: "pr", header: "Price", align: "right", cell: (o) => html`<span class="num">${formatPrice(o.price, o.market.pricePrecision)}${o.stopPrice ? html`<span class="block text-[10px] text-dim">stop ${formatPrice(o.stopPrice, o.market.pricePrecision)}</span>` : ""}</span>` },
      { key: "a", header: "Amount", align: "right", cell: (o) => html`<span class="num">${formatNumber(o.quantity, o.market.quantityPrecision)}</span>` },
      { key: "f", header: "Filled", align: "right", cell: (o) => html`<span class="num text-muted">${((Number(o.filledQuantity) / Number(o.quantity)) * 100).toFixed(1)}%</span>` },
      { key: "st", header: "Status", cell: (o) => statusBadge(o.status) },
      { key: "x", header: html`<span class="sr-only">Cancel</span>`, align: "right", cell: (o) => html`<button type="button" data-cancel="${o.id}" class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-muted hover:bg-down-soft hover:text-down">${icon("x", "h-3.5 w-3.5")} Cancel</button>` },
    ],
    history: [
      { key: "d", header: "Date", cell: date },
      { key: "p", header: "Pair", cell: pair },
      { key: "t", header: "Type", cell: (o) => html`<span class="text-xs">${typeLabel(o)}</span>` },
      { key: "s", header: "Side", cell: sideCell },
      { key: "avg", header: "Avg. price", align: "right", cell: (o) => html`<span class="num">${o.avgFillPrice ? formatPrice(o.avgFillPrice, o.market.pricePrecision) : o.price ? formatPrice(o.price, o.market.pricePrecision) : "Market"}</span>` },
      { key: "fq", header: "Filled / Amount", align: "right", cell: (o) => html`<span class="num">${formatNumber(o.filledQuantity, o.market.quantityPrecision)} / ${formatNumber(o.quantity, o.market.quantityPrecision)}</span>` },
      { key: "fee", header: "Fee", align: "right", hideOnMobile: true, cell: (o) => html`<span class="num text-muted">${Number(o.feeTotal) ? formatNumber(o.feeTotal, 4) : "—"}</span>` },
      { key: "st", header: "Status", cell: (o) => html`<span title="${o.rejectReason ?? ""}">${statusBadge(o.status)}${o.rejectReason ? html`<span class="mt-0.5 block max-w-48 truncate text-[10px] text-down">${o.rejectReason}</span>` : ""}</span>` },
    ],
    trades: [
      { key: "d", header: "Date", cell: date },
      { key: "p", header: "Pair", cell: pair },
      { key: "s", header: "Side", cell: sideCell },
      { key: "pr", header: "Price", align: "right", cell: (t) => html`<span class="num">${formatPrice(t.price, t.market.pricePrecision)}</span>` },
      { key: "q", header: "Amount", align: "right", cell: (t) => html`<span class="num">${formatNumber(t.quantity, 8)}</span>` },
      { key: "tot", header: "Total", align: "right", cell: (t) => html`<span class="num">${formatNumber(t.quoteQuantity, 2)}</span>` },
      { key: "fee", header: "Fee", align: "right", cell: (t) => html`<span class="num text-muted">${formatNumber(t.fee, 4)} ${t.feeAsset}</span>` },
      { key: "r", header: "Role", align: "right", hideOnMobile: true, cell: (t) => html`<span class="text-xs text-dim">${t.isMaker ? "Maker" : "Taker"}</span>` },
    ],
  };
  const EMPTY = { open: "No open orders", history: "No order history", trades: "No trades yet" };

  const mq = () => (onlyCurrent ? `&market=${market}` : "");
  function load() {
    unsub?.();
    // A fresh host per load so row handlers from the previous table don't linger.
    const host = document.createElement("div");
    body.replaceChildren(host);
    const table = new DataTable(host, { dense: true, columns: COLUMNS[tab], empty: emptyState({ title: EMPTY[tab], cls: "py-8" }), onRowClick: tab === "trades" ? null : (o) => showOrder(o.id) });
    table.set(undefined, { loading: true });
    const key = tab === "trades" ? `/api/trades?pageSize=50${mq()}` : `/api/orders?status=${tab}&pageSize=50${mq()}`;
    unsub = watch(key, ({ data, error }) => (data ? table.set(data.items) : error && table.set(undefined, { error })), { refresh: tab === "open" ? 15000 : undefined });
  }
  function watchCount() {
    countUnsub?.();
    countUnsub = watch(`/api/orders?status=open&pageSize=50${mq()}`, ({ data }) => {
      if (!data || data.total === openCount) return;
      openCount = data.total;
      drawTabs();
    });
  }

  on(el, "click", "[data-otab]", (_e, b) => {
    tab = b.dataset.otab;
    drawTabs();
    load();
  });
  $("[data-only]", el)?.addEventListener("change", (e) => {
    onlyCurrent = e.target.checked;
    watchCount();
    load();
  });
  on(el, "click", "[data-cancel]", async (e, b) => {
    e.stopPropagation();
    b.disabled = true;
    try {
      await api(`/api/orders/${b.dataset.cancel}`, { method: "DELETE" });
      toast.success("Order cancelled", "Reserved funds were released.");
      ["/api/orders", "/api/wallets"].forEach(invalidate);
    } catch (err) {
      b.disabled = false;
      toast.error("Could not cancel order", err.message);
    }
  });

  watchCount();
  load();
}

async function showOrder(id) {
  const m = openModal({ title: "Order details", body: skeleton("h-40 w-full rounded-lg") });
  try {
    const o = await api(`/api/orders/${id}`);
    const rows = [
      ["Pair", o.market.symbol.replace("-", "/")],
      ["Side", o.side === "BUY" ? "Buy" : "Sell"],
      ["Type", o.type === "STOP_LIMIT" ? `Stop limit${o.triggered ? " · triggered" : ""}` : titleCase(o.type)],
      ["Status", statusBadge(o.status)],
      ["Price", o.price ?? "Market"],
      ["Quantity", o.quantity],
      ["Filled", o.filledQuantity],
      ["Avg. fill price", o.avgFillPrice ?? "—"],
      ["Fees", o.feeTotal],
      ["Environment", o.isDemo ? "Demo (simulated)" : "Live"],
    ];
    m.setBody(html`<div class="space-y-5">
      <dl class="grid grid-cols-2 gap-3 text-sm">${rows.map(([k, v]) => html`<div><dt class="text-xs text-dim">${k}</dt><dd class="num text-white">${v}</dd></div>`)}</dl>
      <div><p class="mb-2 text-xs font-bold tracking-wider text-dim uppercase">Lifecycle</p>
        <ol class="relative space-y-3 border-l border-line-strong pl-5">${o.events.map(
          (ev) => html`<li class="relative"><span class="absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full border-2 border-panel bg-accent"></span><div class="flex items-center justify-between gap-3">${statusBadge(ev.status)}<span class="text-xs text-dim">${formatDate(ev.createdAt, "time")}</span></div>${ev.note ? html`<p class="mt-1 text-xs text-muted">${ev.note}</p>` : ""}</li>`,
        )}</ol>
      </div>
    </div>`);
  } catch (err) {
    m.setBody(html`<p class="text-sm text-down">${err.message}</p>`);
  }
}
