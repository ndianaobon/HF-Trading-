// Wallet-related shared UI: transaction rows, step-up confirmation fields and
// the internal transfer dialog.

import { html, $ } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { invalidate } from "../core/store.js";
import { moneyStatusBadge, smallDemo, openModal, notice, toast, assetIcon } from "../core/ui.js";
import { field, selectField, bindForm, rules } from "../core/forms.js";
import { formatNumber, timeAgo, titleCase, toNum } from "../core/format.js";

export function txRow(tx) {
  const credit = tx.direction === "CREDIT";
  return html`<div class="flex items-center gap-3 py-3">
    <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl ${credit ? "bg-up-soft text-up" : "bg-panel-3 text-muted"}">${icon(credit ? "arrow-down-left" : "arrow-up-right", "h-4 w-4")}</span>
    <div class="min-w-0 flex-1"><p class="flex min-w-0 items-center gap-2 text-sm font-medium text-white"><span class="min-w-0 truncate">${tx.description ?? titleCase(tx.type)}</span>${tx.isDemo ? smallDemo() : ""}</p><p class="truncate text-xs text-dim">${titleCase(tx.type)} · ${timeAgo(tx.createdAt)}</p></div>
    <div class="shrink-0 text-right"><p class="num text-sm font-semibold ${credit ? "text-up" : "text-fg"}">${credit ? "+" : "−"}${formatNumber(tx.amount, 8)} ${tx.asset.symbol}</p>${moneyStatusBadge(tx.status)}</div>
  </div>`;
}

/** Step-up confirmation: TOTP when 2FA is enabled, otherwise the account password. */
export function stepUpFields(user) {
  return user.twoFactorEnabled
    ? field({ name: "code", label: "2FA code", hint: "From your authenticator app, or a backup code.", inputmode: "numeric", autocomplete: "one-time-code", attrs: html`maxlength="12"` })
    : field({ name: "password", label: "Account password", type: "password", autocomplete: "current-password", hint: "Enable 2FA in Settings to confirm with an authenticator code instead." });
}

export const stepUpRule = (user) => (user.twoFactorEnabled ? { code: [rules.required("2FA code")] } : { password: [rules.required("Password")] });

export async function openTransferModal(user, defaultAsset = "USDT") {
  const wallets = await api("/api/wallets").catch(() => []);
  const funded = wallets.filter((w) => toNum(w.available) > 0);
  const options = (funded.length ? funded : [{ symbol: defaultAsset }]).map((w) => [w.symbol, w.symbol]);
  const availableOf = (sym) => toNum(wallets.find((w) => w.symbol === sym)?.available);

  const m = openModal({
    title: "Internal transfer",
    description: "Send funds instantly to another HarborFinance account. No network fee.",
    body: html`<form id="transfer-form" class="space-y-4" novalidate>
      ${!user.emailVerified ? notice("warn", { body: "Verify your email address to send transfers." }) : ""}
      ${user.demoMode ? notice("warn", { body: "Demo mode: transfers move simulated balances only." }) : ""}
      ${selectField({ name: "asset", label: "Asset", options, value: defaultAsset })}
      ${field({ name: "recipientEmail", label: "Recipient email", type: "email" })}
      <div><div class="mb-1.5 flex justify-end"><button type="button" class="text-xs font-semibold text-accent" data-max>Max <span data-avail></span></button></div>${field({ name: "amount", label: "Amount", inputmode: "decimal", suffix: html`<span data-unit>${defaultAsset}</span>` })}</div>
      ${field({ name: "note", label: "Note", hint: "Optional, visible to the recipient", attrs: html`maxlength="140"` })}
      ${stepUpFields(user)}
      <div data-form-error hidden></div>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="transfer-form" class="btn btn-primary" ${user.emailVerified ? "" : html`disabled`}>Confirm transfer</button>`,
  });
  const form = $("#transfer-form", m.el);
  const sync = () => {
    const sym = form.asset.value;
    $("[data-avail]", form).textContent = formatNumber(availableOf(sym), 8);
    $("[data-unit]", form).textContent = sym;
  };
  sync();
  form.asset.addEventListener("change", sync);
  $("[data-max]", form).addEventListener("click", () => (form.amount.value = String(availableOf(form.asset.value))));
  bindForm(
    form,
    () => ({
      recipientEmail: [rules.required("Recipient email"), rules.email()],
      amount: [rules.decimal("Amount"), (v) => (Number(v) > availableOf(form.asset.value) ? "Amount exceeds your available balance" : null)],
      ...stepUpRule(user),
    }),
    async (v) => {
      const res = await api("/api/wallets/transfer", { body: { asset: v.asset, recipientEmail: v.recipientEmail, amount: v.amount, note: v.note || undefined, code: v.code || undefined, password: v.password || undefined } });
      toast.success("Transfer sent", `${v.amount} ${v.asset} · Ref ${res.reference}${res.isDemo ? " (demo)" : ""}`);
      ["/api/wallets", "/api/portfolio", "/api/transactions"].forEach(invalidate);
      m.close();
    },
  );
}

/** Asset + network chooser used by deposit and withdrawal. mode: "deposit" | "withdraw". */
export function assetNetworkPicker(assets, asset, network, mode) {
  const selected = assets.find((a) => a.symbol === asset);
  const enabled = (n) => (mode === "deposit" ? n.depositEnabled : n.withdrawEnabled);
  const chip = (active) => (active ? "border-accent/60 bg-accent-soft" : "border-line bg-base-2 hover:border-line-strong");
  return html`<div class="space-y-5">
    <div>
      <p class="mb-2 text-[13px] font-medium text-muted">1. Select asset</p>
      <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">${assets.map((a) => {
        const available = mode === "deposit" ? a.depositEnabled : a.withdrawEnabled;
        return html`<button type="button" data-pick-asset="${a.symbol}" ${available ? "" : html`disabled`} aria-pressed="${a.symbol === asset}" class="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-40 ${chip(a.symbol === asset)}">${assetIcon(a.symbol, a.color, 24)}<span class="text-sm font-semibold text-white">${a.symbol}</span></button>`;
      })}</div>
    </div>
    ${selected
      ? html`<div>
          <p class="mb-2 text-[13px] font-medium text-muted">2. Select network</p>
          <div class="grid gap-2 sm:grid-cols-2">${selected.networks.map(
            (n) => html`<button type="button" data-pick-network="${n.code}" ${enabled(n) ? "" : html`disabled`} aria-pressed="${n.code === network}" class="rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-40 ${chip(n.code === network)}">
              <p class="text-sm font-semibold text-white">${n.name}</p>
              <p class="text-xs text-dim">${mode === "deposit" ? `Min ${n.minDeposit} · ${n.confirmations} confirmations` : `Fee ${n.withdrawalFee} ${selected.symbol} · Min ${n.minWithdrawal}`}${enabled(n) ? "" : " · Suspended"}</p>
            </button>`,
          )}</div>
        </div>`
      : ""}
  </div>`;
}

/** Picks a valid asset/network pair given the current (possibly stale) choice. */
export function resolvePick(assets, asset, network, mode) {
  const ok = (x) => (mode === "deposit" ? x.depositEnabled : x.withdrawEnabled);
  const a = assets.find((x) => x.symbol === asset && ok(x)) ?? assets.find(ok);
  if (!a) return { asset: "", network: "" };
  const n = a.networks.find((x) => x.code === network && ok(x)) ?? a.networks.find(ok);
  return { asset: a.symbol, network: n?.code ?? "" };
}

const DEPOSIT_STEPS = ["PENDING", "CONFIRMING", "COMPLETED"];

/** Pending → Confirming (n/m) → Successful tracker, or a terminal failure. */
export function depositProgress(status, confirmations, required) {
  if (status === "FAILED" || status === "EXPIRED") return html`<p class="text-xs font-semibold text-down">${status === "FAILED" ? "Failed" : "Expired"}</p>`;
  const idx = DEPOSIT_STEPS.indexOf(status);
  const done = (i) => i < idx || status === "COMPLETED";
  return html`<div class="flex items-center gap-1.5" aria-label="Status: ${status}">
    ${DEPOSIT_STEPS.map(
      (s, i) => html`<div class="flex items-center gap-1.5"><span class="grid h-4 w-4 place-items-center rounded-full border text-[9px] ${done(i) ? "border-up bg-up text-[#04140d]" : i === idx ? "border-info text-info" : "border-line-strong text-dim"}">${done(i) ? icon("check", "h-2.5 w-2.5") : i + 1}</span>${i < DEPOSIT_STEPS.length - 1 ? html`<span class="h-px w-4 ${i < idx ? "bg-up" : "bg-line-strong"}"></span>` : ""}</div>`,
    )}
    <span class="ml-1 text-xs text-muted">${status === "CONFIRMING" ? `${confirmations}/${required}` : status === "COMPLETED" ? "Successful" : "Awaiting"}</span>
  </div>`;
}
