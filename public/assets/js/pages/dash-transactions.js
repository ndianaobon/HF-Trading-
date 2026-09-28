import { html, $, on, mount, param, debounce } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { watch } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { emptyState, pageHeader, pagination, tabs, smallDemo, moneyStatusBadge, moneyStatusLabel, copyButton, openModal, DataTable } from "../core/ui.js";
import { formatDate, formatNumber, titleCase } from "../core/format.js";

await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

const TYPES = ["ALL", "DEPOSIT", "WITHDRAWAL", "TRADE", "TRANSFER", "INVESTMENT", "COPY_TRADING", "REFERRAL", "PROFIT", "ADJUSTMENT"];
const STATUSES = ["PENDING", "CONFIRMING", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED"];
const state = { type: TYPES.includes(param("type")) ? param("type") : "ALL", status: "", asset: (param("asset") ?? "").toUpperCase(), q: "", page: 1 };

mount(
  view,
  html`${pageHeader({
      title: "Transactions",
      description: "Every balance change on your account, including simulated demo activity.",
      actions: html`<a class="btn btn-secondary" data-csv href="#">${icon("download", "h-4 w-4")} Export CSV</a>`,
    })}
    <section class="card">
      <div class="overflow-x-auto px-4 pt-2" data-types></div>
      <div class="grid gap-3 border-t border-line px-4 py-3 sm:grid-cols-[1fr_180px_140px]">
        <div class="relative"><span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim">${icon("search", "h-4 w-4")}</span><input data-q class="input pl-9" placeholder="Search by transaction ID or reference" aria-label="Search transactions" /></div>
        <select data-status class="select" aria-label="Status"><option value="">All statuses</option>${STATUSES.map((s) => html`<option value="${s}">${moneyStatusLabel(s)}</option>`)}</select>
        <input data-asset class="input uppercase" placeholder="Asset" aria-label="Asset" value="${state.asset}" maxlength="10" />
      </div>
      <div class="border-t border-line" data-table></div>
      <div class="border-t border-line px-4 py-3" data-pages></div>
    </section>`,
);

const drawTypes = () => mount($("[data-types]", view), tabs(TYPES.map((t) => ({ value: t, label: t === "ALL" ? "All" : titleCase(t) })), state.type, { size: "sm", name: "type", cls: "border-0" }));
drawTypes();

const table = new DataTable($("[data-table]", view), {
  onRowClick: showDetail,
  empty: emptyState({ title: "No transactions found", description: "Try a different filter or search." }),
  columns: [
    { key: "date", header: "Date", cell: (t) => html`<span class="text-muted">${formatDate(t.createdAt)}</span>` },
    { key: "type", header: "Type", cell: (t) => html`<span class="flex items-center gap-2"><span class="font-medium text-white">${titleCase(t.type)}</span>${t.isDemo ? smallDemo() : ""}</span>` },
    { key: "asset", header: "Asset", cell: (t) => html`<span class="font-semibold">${t.asset.symbol}</span>` },
    { key: "amount", header: "Amount", align: "right", cell: (t) => html`<span class="num font-semibold ${t.direction === "CREDIT" ? "text-up" : "text-fg"}">${t.direction === "CREDIT" ? "+" : "−"}${formatNumber(t.amount, 8)}</span>` },
    { key: "fee", header: "Fee", align: "right", hideOnMobile: true, cell: (t) => html`<span class="num text-muted">${Number(t.fee) ? formatNumber(t.fee, 8) : "—"}</span>` },
    { key: "status", header: "Status", cell: (t) => moneyStatusBadge(t.status) },
    { key: "ref", header: "Transaction ID", hideOnMobile: true, cell: (t) => html`<span class="font-mono text-xs text-muted">${t.reference}</span>` },
  ],
});

function query(extra = {}) {
  const p = new URLSearchParams({ ...extra });
  if (state.type !== "ALL") p.set("type", state.type);
  if (state.status) p.set("status", state.status);
  if (state.asset) p.set("asset", state.asset);
  if (state.q) p.set("q", state.q);
  return p.toString();
}

let unsub = null;
function load() {
  unsub?.();
  table.set(table.rows, { loading: true });
  $("[data-csv]", view).href = `/api/transactions?${query({ format: "csv" })}`;
  unsub = watch(`/api/transactions?${query({ page: state.page, pageSize: 20 })}`, ({ data, error }) => {
    if (!data) return error && table.set(undefined, { error });
    table.set(data.items);
    mount($("[data-pages]", view), pagination(state.page, data.pageCount, data.total));
  });
}

const reset = () => {
  state.page = 1;
  load();
};
on(view, "click", "[data-types] [data-type]", (_e, b) => {
  state.type = b.dataset.type;
  drawTypes();
  reset();
});
$("[data-status]", view).addEventListener("change", (e) => {
  state.status = e.target.value;
  reset();
});
$("[data-asset]", view).addEventListener(
  "input",
  debounce((e) => {
    state.asset = e.target.value.trim().toUpperCase();
    reset();
  }, 300),
);
$("[data-q]", view).addEventListener(
  "input",
  debounce((e) => {
    state.q = e.target.value.trim();
    reset();
  }, 300),
);
on(view, "click", "[data-pages] [data-page]", (_e, b) => {
  state.page = Number(b.dataset.page);
  load();
});

function showDetail(t) {
  const rows = [
    ["Transaction ID", html`<span class="flex items-center justify-end gap-2 font-mono">${t.reference}${copyButton(t.reference, "Copy", true)}</span>`],
    ["Internal ID", html`<span class="font-mono text-xs">${t.id}</span>`],
    ["Type", titleCase(t.type)],
    ["Direction", t.direction === "CREDIT" ? "Credit (in)" : "Debit (out)"],
    ["Amount", `${formatNumber(t.amount, 8)} ${t.asset.symbol}`],
    ["Fee", formatNumber(t.fee, 8)],
    ["Status", moneyStatusBadge(t.status)],
    ["Description", t.description ?? "—"],
    ["Created", formatDate(t.createdAt)],
    ["Last updated", formatDate(t.updatedAt)],
    ["Environment", t.isDemo ? "Demo (simulated)" : "Live"],
  ];
  openModal({
    title: "Transaction details",
    body: html`<dl class="space-y-3 text-sm">${rows.map(([k, v]) => html`<div class="flex justify-between gap-4 border-b border-line/60 pb-2"><dt class="text-dim">${k}</dt><dd class="text-right text-white">${v}</dd></div>`)}</dl>`,
  });
}

load();
