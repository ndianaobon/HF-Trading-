import { html, $, on, mount, param } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { card, notice, errorState, emptyState, skeleton, pageHeader, pagination, copyButton, smallDemo, toast, withBusy } from "../core/ui.js";
import { field, setFormError } from "../core/forms.js";
import { formatDate, formatNumber, truncateMiddle } from "../core/format.js";
import { assetNetworkPicker, resolvePick, depositProgress } from "../components/wallet-bits.js";

const user = await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

mount(
  view,
  html`${pageHeader({ title: "Deposit", description: "Add funds to your HarborFinance wallet." })}
    ${!user.emailVerified ? notice("warn", { cls: "mb-6", title: "Email verification required", body: html`Verify your email address to enable deposits. <a href="/verify-email" class="font-semibold underline">Verify now</a>` }) : ""}
    <div class="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_1fr]">
      ${card({ title: "Deposit crypto", body: html`<div class="card-body space-y-6"><div data-picker>${skeleton("h-40 w-full")}</div><div data-details></div></div>` })}
      ${card({ title: "Recent deposits", description: "Statuses update automatically", body: html`<div class="card-body pt-0"><div data-history>${skeleton("h-64 w-full")}</div><div class="mt-3" data-pages></div></div>` })}
    </div>`,
);

let assets = null;
let asset = (param("asset") ?? "USDT").toUpperCase();
let network = "";
let instr = { data: null, error: null };
let instrUnsub = null;

const box = (label, value, cls = "") => html`<div class="rounded-xl border border-line bg-base-2 p-3 ${cls}"><dt class="text-xs text-dim">${label}</dt><dd class="mt-0.5 font-semibold text-white">${value}</dd></div>`;

function drawPicker() {
  mount($("[data-picker]", view), assetNetworkPicker(assets, asset, network, "deposit"));
}

function drawDetails() {
  const el = $("[data-details]", view);
  const n = assets?.find((a) => a.symbol === asset)?.networks.find((x) => x.code === network);
  if (!n) return mount(el, assets && !network ? emptyState({ title: "No deposit networks available", description: "Deposits are not enabled for any asset right now." }) : "");
  const d = instr.data;
  let body;
  if (!user.emailVerified) body = "";
  else if (instr.error)
    body = notice("down", {
      title: instr.error.code === "KYC_REQUIRED" ? "Verification required" : "Deposits unavailable",
      body: html`${instr.error.message} ${instr.error.code === "KYC_REQUIRED" ? html`<a href="/dashboard/verification" class="font-semibold underline">Start verification</a>` : ""}`,
    });
  else if (!d) body = skeleton("h-40 w-full");
  else if (d.demo)
    body = html`<form data-simulate class="space-y-4 rounded-2xl border border-warn/30 bg-warn-soft/50 p-4" novalidate>
      <p class="flex items-center gap-2 text-sm font-semibold text-warn">${icon("flask-conical", "h-4 w-4")} Demo mode — simulated deposit</p>
      <p class="text-sm text-fg/80">${d.reason} Simulated deposits move through the same Pending → Confirming → Completed lifecycle and are labelled as demo everywhere.</p>
      ${field({ name: "amount", label: "Amount", inputmode: "decimal", suffix: asset })}
      <div data-form-error hidden></div>
      <button type="submit" class="btn btn-primary w-full">Simulate ${asset} deposit</button>
    </form>`;
  else if (!d.available || !d.address) body = emptyState({ iconName: "info", title: "Deposits not available on this network yet", description: d.reason ?? undefined });
  else
    body = html`<div class="space-y-4">
      <div class="flex flex-col gap-4 rounded-2xl border border-line bg-base-2 p-4 sm:flex-row sm:items-center">
        <img src="/api/qr?data=${encodeURIComponent(d.address.address)}" alt="QR code for ${asset} deposit address" width="160" height="160" class="h-40 w-40 shrink-0 rounded-xl bg-white p-2" />
        <div class="min-w-0 space-y-3">
          <div><p class="text-xs text-dim">Deposit address · ${d.network.name}</p><p class="mt-1 font-mono text-sm break-all text-white">${d.address.address}</p></div>
          ${copyButton(d.address.address, "Copy address")}
          ${d.address.memo ? html`<div><p class="text-xs text-warn">Memo / tag (required)</p><p class="font-mono text-sm text-white">${d.address.memo}</p><div class="mt-2">${copyButton(d.address.memo, "Copy memo")}</div></div>` : ""}
        </div>
      </div>
      ${notice("warn", { body: html`Send only ${asset} on ${d.network.name}. Other assets or networks may be permanently lost.${d.address.shared ? " This is a shared platform address — submit your transaction hash below so we can attribute the deposit to your account." : ""}` })}
      <form data-report class="space-y-4" novalidate>
        <div class="grid gap-3 sm:grid-cols-2">${field({ name: "amount", label: "Amount sent", inputmode: "decimal", suffix: asset })}${field({ name: "txHash", label: "Transaction hash", cls: "font-mono", autocomplete: "off" })}</div>
        <div data-form-error hidden></div>
        <button type="submit" class="btn btn-secondary w-full">I've sent the funds</button>
      </form>
    </div>`;
  mount(
    el,
    html`<div class="space-y-4">
      <p class="text-[13px] font-medium text-muted">3. Deposit details</p>
      <dl class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">${box("Network", n.name)}${box("Minimum deposit", html`<span class="num">${n.minDeposit} ${asset}</span>`)}${box("Confirmations", `${n.confirmations} required`, "col-span-2 sm:col-span-1")}</dl>
      ${body}
    </div>`,
  );
}

function select() {
  ({ asset, network } = resolvePick(assets, asset, network, "deposit"));
  drawPicker();
  instrUnsub?.();
  instr = { data: null, error: null };
  if (user.emailVerified && network) {
    instrUnsub = watch(`/api/deposits/address?asset=${asset}&network=${network}`, ({ data, error }) => {
      instr = { data: data ?? null, error: data ? null : error };
      drawDetails();
    });
  }
  drawDetails();
}

watch("/api/assets/networks", ({ data, error }) => {
  if (!data) return error && mount($("[data-picker]", view), errorState({ message: error.message }));
  assets = data;
  select();
});

on(view, "click", "[data-pick-asset]", (_e, b) => {
  asset = b.dataset.pickAsset;
  network = "";
  select();
});
on(view, "click", "[data-pick-network]", (_e, b) => {
  network = b.dataset.pickNetwork;
  select();
});

async function submit(form, kind) {
  const amount = form.amount.value.trim();
  setFormError(form, null);
  if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) return setFormError(form, "Enter a valid amount.");
  if (instr.data && Number(amount) < Number(instr.data.minDeposit)) return setFormError(form, `Minimum deposit is ${instr.data.minDeposit} ${asset}.`);
  const txHash = form.txHash?.value.trim();
  if (kind === "report" && (!txHash || txHash.length < 10)) return setFormError(form, "Enter the transaction hash from your wallet.");
  try {
    await withBusy(form.querySelector("[type=submit]"), async () => {
      if (kind === "simulate") {
        await api("/api/deposits/simulate", { body: { asset, network, amount } });
        toast.success("Simulated deposit created", "It will confirm over the next few seconds.");
      } else {
        await api("/api/deposits", { body: { asset, network, amount, txHash } });
        toast.success("Deposit reported", "We'll credit it once it's confirmed on-chain.");
      }
    });
    form.reset();
    ["/api/deposits", "/api/transactions", "/api/wallets", "/api/portfolio"].forEach(invalidate);
  } catch (err) {
    setFormError(form, err.message ?? "Something went wrong.");
  }
}
on(view, "submit", "[data-simulate]", (e, f) => {
  e.preventDefault();
  submit(f, "simulate");
});
on(view, "submit", "[data-report]", (e, f) => {
  e.preventDefault();
  submit(f, "report");
});

let page = 1;
let histUnsub = null;
function loadHistory() {
  histUnsub?.();
  histUnsub = watch(
    `/api/deposits?page=${page}&pageSize=8`,
    ({ data }) => {
      if (!data) return;
      mount(
        $("[data-history]", view),
        !data.items.length
          ? emptyState({ iconName: "clock", title: "No deposits yet" })
          : html`<ul class="divide-y divide-line/60">${data.items.map(
              (d) => html`<li class="flex flex-wrap items-center justify-between gap-3 py-3">
                <div><p class="flex items-center gap-2 text-sm font-semibold text-white">+${formatNumber(d.amount, 8)} ${d.asset.symbol} ${d.isDemo ? smallDemo() : ""}</p><p class="text-xs text-dim">${d.network.name} · ${formatDate(d.createdAt)}${d.txHash ? ` · ${truncateMiddle(d.txHash, 6)}` : ""}</p></div>
                ${depositProgress(d.status, d.confirmations, d.requiredConfirmations)}
              </li>`,
            )}</ul>`,
      );
      mount($("[data-pages]", view), pagination(page, data.pageCount, data.total));
    },
    { refresh: 8000 },
  );
}
on(view, "click", "[data-pages] [data-page]", (_e, b) => {
  page = Number(b.dataset.page);
  loadHistory();
});
loadHistory();
