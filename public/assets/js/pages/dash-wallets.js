import { html, $, on, mount, debounce } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { watch } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { stat, emptyState, pageHeader, assetIcon, DataTable } from "../core/ui.js";
import { formatNumber, formatUsd, toNum } from "../core/format.js";
import { openTransferModal } from "../components/wallet-bits.js";

const user = await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

mount(
  view,
  html`${pageHeader({
      title: "Wallets",
      description: "Balances per asset. Locked funds are reserved for open orders and pending withdrawals.",
      actions: html`<a href="/dashboard/deposit" class="btn btn-primary">${icon("arrow-down-to-line", "h-4 w-4")} Deposit</a>
        <a href="/dashboard/withdraw" class="btn btn-secondary">${icon("arrow-up-from-line", "h-4 w-4")} Withdraw</a>
        <button type="button" class="btn btn-secondary" data-transfer="USDT">${icon("repeat", "h-4 w-4")} Transfer</button>`,
    })}
    <div class="grid gap-3 sm:grid-cols-3" data-stats>${[0, 1, 2].map(() => stat({ label: "", loading: true }))}</div>
    <section class="card mt-6">
      <div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="relative">
          <span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim">${icon("search", "h-4 w-4")}</span>
          <input data-q placeholder="Search assets" aria-label="Search wallets" class="input h-9 w-full pl-9 text-sm sm:w-60" />
        </div>
        <label class="flex cursor-pointer items-center gap-2.5 text-sm text-muted select-none"><input type="checkbox" class="checkbox" data-hide-zero checked /> Hide zero balances</label>
      </div>
      <div class="border-t border-line" data-table></div>
    </section>`,
);

let wallets = null;
let hideSmall = false;
let hideZero = true;
let q = "";

const table = new DataTable($("[data-table]", view), {
  defaultSort: { key: "value", dir: "desc" },
  empty: emptyState({ title: "No balances", description: "Deposit an asset to see it here.", action: html`<a href="/dashboard/deposit" class="btn btn-primary">Deposit</a>` }),
  columns: [
    { key: "asset", header: "Asset", sortValue: (w) => w.symbol, cell: (w) => html`<div class="flex items-center gap-3">${assetIcon(w.symbol, w.color, 30)}<div><p class="font-semibold text-white">${w.symbol}</p><p class="text-xs text-dim">${w.name}</p></div></div>` },
    { key: "available", header: "Available", align: "right", sortValue: (w) => toNum(w.available), cell: (w) => html`<span class="num text-white">${formatNumber(w.available, 8)}</span>` },
    { key: "locked", header: "Locked", align: "right", sortValue: (w) => toNum(w.locked), cell: (w) => html`<span class="num text-muted">${formatNumber(w.locked, 8)}</span>` },
    { key: "total", header: "Total", align: "right", sortValue: (w) => toNum(w.total), cell: (w) => html`<span class="num font-semibold text-white">${formatNumber(w.total, 8)}</span>` },
    { key: "value", header: "Value (USDT)", align: "right", hideOnMobile: true, sortValue: (w) => w.valueUsdt, cell: (w) => html`<span class="num text-muted">${w.valueUsdt !== null ? formatUsd(w.valueUsdt) : "—"}</span>` },
    {
      key: "actions",
      header: html`<span class="sr-only">Actions</span>`,
      align: "right",
      cell: (w) => {
        const avail = toNum(w.available) > 0;
        return html`<div class="flex justify-end gap-1.5">
          ${w.canDeposit ? html`<a href="/dashboard/deposit?asset=${w.symbol}" class="btn btn-outline btn-sm">Deposit</a>` : html`<span class="px-2 text-xs text-dim" title="No deposit network is configured for this asset">Trade only</span>`}
          ${w.canWithdraw && avail ? html`<a href="/dashboard/withdraw?asset=${w.symbol}" class="btn btn-ghost btn-sm">Withdraw</a>` : ""}
          ${avail ? html`<button type="button" class="btn btn-ghost btn-sm" data-transfer="${w.symbol}">Transfer</button>` : ""}
          <a href="/dashboard/transactions?asset=${w.symbol}" class="btn btn-ghost btn-icon h-8 w-8" aria-label="${w.symbol} history">${icon("history", "h-4 w-4")}</a>
        </div>`;
      },
    },
  ],
});

function draw() {
  if (!wallets) return;
  const Q = q.toUpperCase();
  table.set(
    wallets
      .filter((w) => !hideZero || toNum(w.total) > 0)
      .filter((w) => !hideSmall || w.valueUsdt === null || w.valueUsdt >= 1)
      .filter((w) => !Q || w.symbol.includes(Q) || w.name.toUpperCase().includes(Q)),
  );
}

watch(
  "/api/wallets",
  ({ data, error }) => {
    if (!data) {
      if (error) table.set(undefined, { error });
      return;
    }
    wallets = data;
    const total = data.reduce((s, w) => s + (w.valueUsdt ?? 0), 0);
    const locked = data.reduce((s, w) => s + toNum(w.locked) * (w.price ?? 0), 0);
    mount(
      $("[data-stats]", view),
      html`${stat({ label: "Estimated wallet value", value: formatUsd(total), sub: "USDT, at live prices" })}
      ${stat({ label: "Locked value", value: formatUsd(locked), sub: "Orders & pending withdrawals" })}
      ${stat({ label: "Assets held", value: data.filter((w) => toNum(w.total) > 0).length, sub: `${data.length} supported` })}`,
    );
    draw();
  },
  { refresh: 30000 },
);
watch("/api/users/me", ({ data }) => {
  if (!data) return;
  hideSmall = !!data.profile?.preferences?.hideSmallBalances;
  draw();
});

on(view, "click", "[data-transfer]", (_e, b) => openTransferModal(user, b.dataset.transfer));
$("[data-hide-zero]", view).addEventListener("change", (e) => {
  hideZero = e.target.checked;
  draw();
});
$("[data-q]", view).addEventListener(
  "input",
  debounce((e) => {
    q = e.target.value.trim();
    draw();
  }, 150),
);
if (!wallets) table.set(undefined, { loading: true });
