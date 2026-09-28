import { html, $, on, mount, param } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api, ApiError } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { card, notice, errorState, emptyState, skeleton, pageHeader, pagination, smallDemo, moneyStatusBadge, toast, openModal, confirmDialog } from "../core/ui.js";
import { field, bindForm, rules, readForm, showErrors, setFormError } from "../core/forms.js";
import { formatDate, formatNumber, toNum, truncateMiddle } from "../core/format.js";
import { assetNetworkPicker, resolvePick, stepUpFields, stepUpRule } from "../components/wallet-bits.js";

const user = await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

mount(
  view,
  html`${pageHeader({ title: "Withdraw", description: "Send funds from your HarborFinance wallet to an external address." })}
    ${!user.emailVerified ? notice("warn", { cls: "mb-6", body: html`Verify your email address to enable withdrawals. <a href="/verify-email" class="font-semibold underline">Verify now</a>` }) : ""}
    ${user.emailVerified && user.kycStatus !== "APPROVED" ? notice("info", { cls: "mb-6", iconName: "info", title: "Identity verification may be required", body: html`Withdrawals can require an approved identity verification. <a href="/dashboard/verification" class="font-semibold underline">Check your status</a>` }) : ""}
    <div class="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_1fr]">
      ${card({
        title: "Withdraw crypto",
        body: html`<div class="card-body"><div data-loading>${skeleton("h-64 w-full")}</div>
          <form id="withdraw-form" class="space-y-5" novalidate hidden>
            <div data-picker></div>
            <p class="text-[13px] font-medium text-muted">3. Destination &amp; amount</p>
            ${field({ name: "address", label: "Destination address", cls: "font-mono", autocomplete: "off", attrs: html`spellcheck="false"` })}
            <div data-memo hidden>${field({ name: "memo", label: "Memo / destination tag", hint: "Required by this network. Check with the receiving platform.", autocomplete: "off" })}</div>
            <div><div class="mb-1.5 flex justify-end"><button type="button" class="text-xs font-semibold text-accent" data-max></button></div>${field({ name: "amount", label: "Amount", inputmode: "decimal", suffix: html`<span data-unit></span>` })}</div>
            <dl class="space-y-2 rounded-xl border border-line bg-base-2 p-4 text-sm" data-summary></dl>
            ${stepUpFields(user)}
            <div data-form-error hidden></div>
            <button type="submit" class="btn btn-primary btn-lg w-full" ${user.emailVerified ? "" : html`disabled`}>Review withdrawal</button>
          </form></div>`,
      })}
      ${card({ title: "Withdrawal history", body: html`<div class="card-body pt-0"><div data-history>${skeleton("h-64 w-full")}</div><div class="mt-3" data-pages></div></div>` })}
    </div>`,
);

const form = $("#withdraw-form", view);
let assets = null;
let wallets = [];
let asset = (param("asset") ?? "USDT").toUpperCase();
let network = "";

const current = () => {
  const selected = assets?.find((a) => a.symbol === asset);
  const net = selected?.networks.find((n) => n.code === network);
  const available = toNum(wallets.find((w) => w.symbol === asset)?.available);
  const fee = toNum(net?.withdrawalFee);
  const amt = toNum(form.amount.value);
  return { net, available, fee, amt, total: amt + fee, max: Math.max(0, available - fee) };
};

function sync() {
  const { net, available, fee, amt, total } = current();
  $("[data-unit]", form).textContent = asset;
  $("[data-max]", form).textContent = `Available ${formatNumber(available, 8)} ${asset}`;
  $("[data-memo]", form).hidden = !net?.memoRequired;
  const row = (k, v, strong) => html`<div class="flex justify-between ${strong === "top" ? "border-t border-line pt-2" : ""}"><dt class="${strong ? "text-muted" : "text-dim"}">${k}</dt><dd class="num ${strong ? "font-semibold text-white" : "text-fg"}">${v}</dd></div>`;
  const summary = $("[data-summary]", form);
  summary.hidden = !net;
  if (net)
    mount(
      summary,
      html`${row("Minimum withdrawal", `${net.minWithdrawal} ${asset}`)}${row("Network fee", `${formatNumber(fee, 8)} ${asset}`)}${row("Total deducted", `${formatNumber(total, 8)} ${asset}`, "top")}${row("Recipient receives", `${formatNumber(amt, 8)} ${asset}`, true)}${net.processingTime ? row("Estimated processing", net.processingTime) : ""}`,
    );
}

function select() {
  ({ asset, network } = resolvePick(assets, asset, network, "withdraw"));
  mount($("[data-picker]", form), assetNetworkPicker(assets, asset, network, "withdraw"));
  sync();
}

watch("/api/assets/networks", ({ data, error }) => {
  if (!data) return error && mount($("[data-loading]", view), errorState({ message: error.message }));
  assets = data;
  $("[data-loading]", view).hidden = true;
  form.hidden = false;
  select();
});
watch("/api/wallets", ({ data }) => {
  if (!data) return;
  wallets = data;
  if (assets) sync();
});

on(form, "click", "[data-pick-asset]", (_e, b) => {
  asset = b.dataset.pickAsset;
  network = "";
  select();
});
on(form, "click", "[data-pick-network]", (_e, b) => {
  network = b.dataset.pickNetwork;
  select();
});
on(form, "click", "[data-max]", () => {
  const { max } = current();
  form.amount.value = max > 0 ? String(Number(max.toFixed(8))) : "0";
  sync();
});
form.addEventListener("input", sync);

bindForm(
  form,
  () => ({
    address: [rules.min(10, "Enter a destination address")],
    memo: current().net?.memoRequired ? [rules.required("Memo")] : [],
    amount: [
      rules.decimal("Amount"),
      () => {
        const { net, amt, total, available } = current();
        if (!net) return "Select a network";
        if (amt < toNum(net.minWithdrawal)) return `Minimum withdrawal is ${net.minWithdrawal} ${asset}`;
        if (total > available) return "Amount plus network fee exceeds your available balance";
        return null;
      },
    ],
    ...stepUpRule(user),
  }),
  async () => openReview(),
);

function openReview() {
  const v = readForm(form);
  const { net, amt, total } = current();
  const rows = [["Asset", asset], ["Network", net.name], ["Destination", html`<span class="font-mono break-all">${v.address}</span>`], ...(v.memo && net.memoRequired ? [["Memo", v.memo]] : []), ["Amount", `${formatNumber(amt, 8)} ${asset}`], ["Network fee", `${net.withdrawalFee} ${asset}`], ["Total deducted", `${formatNumber(total, 8)} ${asset}`]];
  const m = openModal({
    title: "Confirm withdrawal",
    description: "Check every detail. Blockchain transfers cannot be reversed.",
    body: html`<dl class="space-y-3 text-sm">${rows.map(([k, val]) => html`<div class="flex justify-between gap-4 border-b border-line/60 pb-2"><dt class="text-dim">${k}</dt><dd class="text-right text-white">${val}</dd></div>`)}</dl>
      ${notice("warn", { cls: "mt-4", body: user.demoMode ? "Demo mode: this withdrawal is simulated and no funds leave the platform." : "Funds are reserved immediately and sent after review." })}
      <div class="mt-3" data-modal-error></div>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Back</button><button type="button" class="btn btn-primary" data-confirm>${icon("shield-check", "h-4 w-4")} Confirm withdrawal</button>`,
  });
  on(m.el, "click", "[data-confirm]", async (_e, btn) => {
    btn.disabled = true;
    try {
      const res = await api("/api/withdrawals", { body: { asset, network, address: v.address.trim(), memo: net.memoRequired ? v.memo || undefined : undefined, amount: v.amount, code: v.code || undefined, password: v.password || undefined } });
      toast.success("Withdrawal requested", res.isDemo ? "Simulated withdrawal pending review (demo)." : "Your withdrawal is pending review.");
      m.close();
      ["address", "memo", "amount", "code", "password"].forEach((k) => form[k] && (form[k].value = ""));
      sync();
      ["/api/withdrawals", "/api/wallets", "/api/transactions", "/api/portfolio"].forEach(invalidate);
    } catch (err) {
      btn.disabled = false;
      const msg = err instanceof ApiError ? err.message : "Something went wrong.";
      mount($("[data-modal-error]", m.el), notice("down", { body: msg }));
      if (err instanceof ApiError && err.fields) {
        showErrors(form, err.fields);
        setFormError(form, msg);
      }
    }
  });
}

let page = 1;
let histUnsub = null;
function loadHistory() {
  histUnsub?.();
  histUnsub = watch(
    `/api/withdrawals?page=${page}&pageSize=8`,
    ({ data }) => {
      if (!data) return;
      mount(
        $("[data-history]", view),
        !data.items.length
          ? emptyState({ title: "No withdrawals yet" })
          : html`<ul class="divide-y divide-line/60">${data.items.map(
              (w) => html`<li class="py-3"><div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="flex items-center gap-2 text-sm font-semibold text-white">−${formatNumber(w.amount, 8)} ${w.asset.symbol} ${w.isDemo ? smallDemo() : ""}</p>
                  <p class="truncate font-mono text-xs text-dim">To ${truncateMiddle(w.address, 8)}</p>
                  <p class="text-xs text-dim">${w.network.name} · fee ${formatNumber(w.fee)} · ${formatDate(w.createdAt)}</p>
                  ${w.txHash ? html`<p class="truncate font-mono text-xs text-muted">Tx ${truncateMiddle(w.txHash, 10)}</p>` : ""}
                  ${w.rejectionReason ? html`<p class="text-xs text-down">${w.rejectionReason}</p>` : ""}
                </div>
                <div class="flex flex-col items-end gap-2">${moneyStatusBadge(w.status)}${w.status === "PENDING_REVIEW" ? html`<button type="button" data-cancel="${w.id}" class="text-xs font-semibold text-muted hover:text-down">Cancel</button>` : ""}</div>
              </div></li>`,
            )}</ul>`,
      );
      mount($("[data-pages]", view), pagination(page, data.pageCount, data.total));
    },
    { refresh: 15000 },
  );
}
on(view, "click", "[data-pages] [data-page]", (_e, b) => {
  page = Number(b.dataset.page);
  loadHistory();
});
on(view, "click", "[data-cancel]", async (_e, b) => {
  if (!(await confirmDialog({ title: "Cancel withdrawal?", message: "The reserved funds will return to your available balance.", confirmLabel: "Cancel withdrawal", danger: true }))) return;
  try {
    await api(`/api/withdrawals/${b.dataset.cancel}`, { method: "DELETE" });
    toast.success("Withdrawal cancelled", "Funds returned to your available balance.");
    ["/api/withdrawals", "/api/wallets", "/api/transactions"].forEach(invalidate);
  } catch (err) {
    toast.error("Could not cancel", err.message);
  }
});
loadHistory();
