import { html, $, on, mount } from "../core/dom.js";
import { pageHeader, statusBadge, smallDemo, segmented, emptyState } from "../core/ui.js";
import { formatDate, formatNumber, formatPrice, titleCase } from "../core/format.js";
import { adminPage, adminTable } from "../components/admin-kit.js";

const { view } = await adminPage();
let mode = "trades";

mount(view, html`${pageHeader({ title: "Trades", description: "Executed fills and the order book of every customer." })}<div class="mb-4" data-modes></div><div data-list></div>`);

const common = [
  { key: "d", header: "Date", cell: (r) => html`<span class="text-xs text-muted">${formatDate(r.createdAt)}</span>` },
  { key: "u", header: "User", cell: (r) => r.user.email },
  { key: "m", header: "Market", cell: (r) => html`<span class="font-semibold text-white">${r.market.symbol}</span>` },
  { key: "s", header: "Side", cell: (r) => html`<span class="flex items-center gap-1.5"><span class="${r.side === "BUY" ? "text-up" : "text-down"}">${r.side}</span>${r.isDemo ? smallDemo() : ""}</span>` },
];
const COLUMNS = {
  orders: [
    ...common,
    { key: "t", header: "Type", cell: (r) => titleCase(r.type ?? "") },
    { key: "p", header: "Price", align: "right", cell: (r) => html`<span class="num">${r.price ? formatPrice(r.price) : "Market"}</span>` },
    { key: "q", header: "Filled / Qty", align: "right", cell: (r) => html`<span class="num">${formatNumber(r.filledQuantity ?? 0, 8)} / ${formatNumber(r.quantity, 8)}</span>` },
    { key: "st", header: "Status", cell: (r) => html`<span title="${r.rejectReason ?? ""}">${statusBadge(r.status ?? "")}</span>` },
  ],
  trades: [
    ...common,
    { key: "p", header: "Price", align: "right", cell: (r) => html`<span class="num">${formatPrice(r.price)}</span>` },
    { key: "q", header: "Quantity", align: "right", cell: (r) => html`<span class="num">${formatNumber(r.quantity, 8)}</span>` },
    { key: "v", header: "Value", align: "right", cell: (r) => html`<span class="num">${formatNumber(r.quoteQuantity ?? 0, 2)}</span>` },
    { key: "f", header: "Fee", align: "right", cell: (r) => html`<span class="num text-muted">${formatNumber(r.fee ?? 0, 4)}</span>` },
    { key: "r", header: "Role", cell: (r) => html`<span class="text-xs text-dim">${r.isMaker ? "Maker" : "Taker"}</span>` },
  ],
};

function draw() {
  mount(
    $("[data-modes]", view),
    segmented(
      [
        { value: "trades", label: "Fills" },
        { value: "orders", label: "Orders" },
      ],
      mode,
      { name: "mode" },
    ),
  );
  // A fresh container per mode: the column set differs.
  const host = document.createElement("div");
  $("[data-list]", view).replaceChildren(host);
  adminTable(host, {
    endpoint: "/api/admin/trades",
    dense: true,
    extraParams: { view: mode },
    filters: [
      { name: "market", type: "search", placeholder: "Market e.g. BTC-USDT", cls: "sm:w-56" },
      { name: "q", type: "search", placeholder: "User email", cls: "sm:w-56" },
    ],
    empty: emptyState({ title: "Nothing found" }),
    columns: COLUMNS[mode],
  });
}
on(view, "click", "[data-modes] [data-mode]", (_e, b) => {
  mode = b.dataset.mode;
  draw();
});
draw();
