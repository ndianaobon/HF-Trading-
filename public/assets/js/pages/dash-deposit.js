import { html, $, on, mount, cx, param } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { card, notice, errorState, emptyState, skeleton, pageHeader, pagination, smallDemo, toast, withBusy, badge } from "../core/ui.js";
import { field, setFormError } from "../core/forms.js";
import { formatDate, formatNumber, truncateMiddle } from "../core/format.js";
import { depositProgress } from "../components/wallet-bits.js";
import { coinLogo, networkLogo, networkTicker } from "../components/coin-logos.js";

const user = await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

/** Coins offered in the deposit flow, in display order. */
const COINS = ["USDT", "BTC", "ETH", "BNB", "SOL"];
const STEPS = [
  { key: "coin", label: "Coin" },
  { key: "method", label: "Method" },
  { key: "network", label: "Network" },
  { key: "address", label: "Address" },
];

mount(
  view,
  html`${pageHeader({ title: "Deposit", description: "Add funds to your HarborFinance wallet." })}
    ${!user.emailVerified ? notice("warn", { cls: "mb-6", title: "Email verification required", body: html`Verify your email address to enable deposits. <a href="/verify-email" class="font-semibold underline">Verify now</a>` }) : ""}
    <div class="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_1fr]">
      <section class="card overflow-hidden" data-flow>${skeleton("h-[420px] w-full")}</section>
      <div id="deposit-history">${card({ title: "Recent deposits", description: "Statuses update automatically", body: html`<div class="card-body pt-0"><div data-history>${skeleton("h-64 w-full")}</div><div class="mt-3" data-pages></div></div>` })}</div>
    </div>`,
);

let assets = null;
let state = readUrl();
let instr = { data: null, error: null };
let instrUnsub = null;
let instrKey = "";
let moreOpen = false;

function readUrl() {
  const asset = (param("asset") ?? "").toUpperCase();
  const network = param("network") ?? "";
  const step = STEPS.some((s) => s.key === param("step")) ? param("step") : asset ? "method" : "coin";
  return { step, asset, network };
}

/** Moves to another step; pushes history so the phone/browser back button walks the roadmap. */
function go(next, { replace = false } = {}) {
  state = { ...state, ...next };
  const q = new URLSearchParams({ step: state.step });
  if (state.asset) q.set("asset", state.asset);
  if (state.network && (state.step === "network" || state.step === "address")) q.set("network", state.network);
  history[replace ? "replaceState" : "pushState"](null, "", `${location.pathname}?${q}`);
  render();
  $("[data-flow]", view).scrollIntoView({ block: "nearest", behavior: "smooth" });
}
window.addEventListener("popstate", () => {
  state = readUrl();
  render();
});

const coinOf = (sym) => assets?.find((a) => a.symbol === sym);
const networkOf = () => coinOf(state.asset)?.networks.find((n) => n.code === state.network);
const coinName = (a) => (a.symbol === "USDT" ? "TetherUS" : a.name);
const depositable = (a) => a.depositEnabled && a.networks.some((n) => n.depositEnabled);

/* ── Frame: header with back arrow + roadmap ── */
function frame(title, body, { back = true, subtitle = "" } = {}) {
  const at = STEPS.findIndex((s) => s.key === state.step);
  return html`<div class="flex items-center gap-2 border-b border-line px-3 py-3 sm:px-4">
      ${back ? html`<button type="button" class="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-fg hover:bg-panel-2" aria-label="Back" data-back>${icon("arrow-left", "h-5 w-5")}</button>` : html`<span class="w-2"></span>`}
      <div class="min-w-0 flex-1 text-center"><h2 class="truncate font-display text-lg font-extrabold text-white">${title}</h2>${subtitle ? html`<p class="truncate text-xs text-dim">${subtitle}</p>` : ""}</div>
      <a href="#deposit-history" class="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-panel-2 hover:text-white" aria-label="Deposit history">${icon("history", "h-5 w-5")}</a>
    </div>
    <nav aria-label="Deposit steps" class="border-b border-line bg-base-2/60 px-3 py-3 sm:px-5">
      <ol class="flex items-center justify-between gap-1 text-[11px] font-bold sm:text-xs">
        ${STEPS.map((s, i) => {
          const done = i < at;
          const current = i === at;
          const dot = html`<span class="${cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px]", done && "bg-up text-[#fff]", current && "bg-accent text-accent-ink", !done && !current && "border border-line-strong text-dim")}">${done ? icon("check", "h-3.5 w-3.5") : i + 1}</span>`;
          const label = html`<span class="${cx("hidden min-[380px]:inline", current ? "text-white" : done ? "text-fg" : "text-dim")}">${s.label}</span>`;
          return html`<li class="flex min-w-0 items-center gap-1">
            ${done ? html`<button type="button" class="flex items-center gap-1.5 rounded-lg p-0.5 hover:bg-panel-2" data-go-step="${s.key}">${dot}${label}</button>` : html`<span class="flex items-center gap-1.5 p-0.5" ${current ? html`aria-current="step"` : ""}>${dot}${label}</span>`}
          </li>${i < STEPS.length - 1 ? html`<li aria-hidden="true" class="${cx("flex flex-1 items-center", i < at ? "text-up" : "text-line-strong")}"><span class="h-px flex-1 bg-current"></span>${icon("chevron-right", "h-4 w-4 shrink-0")}</li>` : ""}`;
        })}
      </ol>
    </nav>
    <div class="p-4 sm:p-5">${body}</div>`;
}

const row = (attrs, inner, disabled = false) =>
  html`<button type="button" ${attrs} class="${cx("flex w-full items-center gap-3.5 rounded-2xl border border-line bg-panel-2/40 p-4 text-left transition-colors", disabled ? "cursor-not-allowed opacity-50" : "hover:border-accent/50 hover:bg-panel-2")}" ${disabled ? html`disabled` : ""}>${inner}</button>`;

/* ── Step 1: coin ── */
function coinStep() {
  const list = COINS.map(coinOf).filter(Boolean);
  if (!list.length) return frame("Select Coin", emptyState({ title: "No coins available", description: "Deposits are not enabled for any coin right now." }), { back: false });
  return frame(
    "Select Coin",
    html`<p class="mb-4 text-sm text-muted">Choose the coin you want to deposit.</p>
    <div class="space-y-2.5">${list.map((a) =>
      row(
        html`data-coin="${a.symbol}"`,
        html`${coinLogo(a.symbol, a.color, 40)}<span class="min-w-0 flex-1"><span class="block font-display text-base font-extrabold text-white">${a.symbol}</span><span class="block text-sm text-muted">${coinName(a)}</span></span>${depositable(a) ? icon("chevron-right", "h-5 w-5 text-dim") : badge("Suspended", "neutral")}`,
        !depositable(a),
      ),
    )}</div>`,
    { back: false },
  );
}

/* ── Step 2: method ── */
function methodStep(a) {
  return frame(
    `Deposit ${a.symbol}`,
    html`<div class="mb-5 flex items-center gap-3 rounded-2xl border border-line bg-base-2 p-3">${coinLogo(a.symbol, a.color, 32)}<p class="text-sm"><span class="font-bold text-white">${a.symbol}</span> <span class="text-muted">${coinName(a)}</span></p><button type="button" class="ml-auto text-xs font-semibold text-accent" data-go-step="coin">Change</button></div>
    <p class="mb-2.5 text-xs font-bold tracking-wider text-dim uppercase">Deposit from wallet</p>
    ${row(
      html`data-method="onchain"`,
      html`<span class="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">${icon("wallet", "h-6 w-6")}<span class="absolute -right-1 -bottom-1 grid h-5 w-5 place-items-center rounded-full bg-accent text-accent-ink ring-2 ring-panel">${icon("arrow-down", "h-3 w-3")}</span></span>
      <span class="min-w-0 flex-1"><span class="block font-display text-base font-extrabold text-white">Deposit Asset</span><span class="mt-0.5 block text-sm leading-snug text-muted">Deposit crypto from other exchange / wallet to HarborFinance Trading App</span></span>
      ${icon("chevron-right", "h-5 w-5 shrink-0 text-dim")}`,
    )}`,
  );
}

/* ── Step 3: network ── */
function networkStep(a) {
  return frame(
    "Choose Network",
    html`<p class="mb-4 text-sm leading-relaxed text-muted">Please note that only supported networks on HarborFinance Trading are shown. If you deposit via another network your assets may be lost.</p>
    <div class="space-y-3">${a.networks.map((n) =>
      row(
        html`data-network="${n.code}"`,
        html`<span class="self-start">${networkLogo(n.code, a.color, 36)}</span>
        <span class="min-w-0 flex-1">
          <span class="block"><span class="font-display text-base font-extrabold text-white">${networkTicker(n.code)}</span> <span class="text-sm text-muted">${n.name}</span></span>
          <span class="mt-1.5 block text-sm text-muted">Min. deposit <span class="num">&gt;${formatNumber(n.minDeposit, 8)}</span> ${a.symbol}</span>
          <span class="block text-sm text-muted">${n.processingTime ? `Est. arrival ≈ ${n.processingTime}` : `${n.confirmations} network confirmation${n.confirmations === 1 ? "" : "s"}`}</span>
        </span>
        ${n.depositEnabled ? "" : badge("Suspended", "neutral")}`,
        !n.depositEnabled,
      ),
    )}</div>`,
  );
}

/* ── Step 4: address ── */
function highlight(addr) {
  if (addr.length <= 16) return html`<span class="text-accent">${addr}</span>`;
  return html`<span class="text-accent">${addr.slice(0, 6)}</span>${addr.slice(6, -6)}<span class="text-accent">${addr.slice(-6)}</span>`;
}

function addressBody(a, n) {
  if (!user.emailVerified) return notice("warn", { title: "Email verification required", body: html`Verify your email to see your deposit address. <a href="/verify-email" class="font-semibold underline">Verify now</a>` });
  if (instr.error)
    return notice("down", {
      title: instr.error.code === "KYC_REQUIRED" ? "Verification required" : "Deposits unavailable",
      body: html`${instr.error.message} ${instr.error.code === "KYC_REQUIRED" ? html`<a href="/dashboard/verification" class="font-semibold underline">Start verification</a>` : ""}`,
    });
  const d = instr.data;
  if (!d) return skeleton("h-80 w-full rounded-2xl");
  if (d.demo)
    return html`<form data-simulate class="space-y-4 rounded-2xl border border-warn/30 bg-warn-soft/50 p-4" novalidate>
      <p class="flex items-center gap-2 text-sm font-semibold text-warn">${icon("flask-conical", "h-4 w-4")} Demo mode — simulated deposit</p>
      <p class="text-sm text-fg/80">${d.reason} Simulated deposits move through the same Pending → Confirming → Completed lifecycle and are labelled as demo everywhere.</p>
      ${field({ name: "amount", label: "Amount", inputmode: "decimal", suffix: a.symbol })}
      <div data-form-error hidden></div>
      <button type="submit" class="btn btn-primary w-full">Simulate ${a.symbol} deposit</button>
    </form>`;
  if (!d.available || !d.address) return emptyState({ iconName: "info", title: "No deposit address yet", description: "A deposit address hasn't been set for this network. Please choose another network or contact support." });

  const addr = d.address.address;
  const detail = (k, v) => html`<div class="flex justify-between gap-3 py-2 text-sm"><dt class="text-dim">${k}</dt><dd class="text-right font-semibold text-white">${v}</dd></div>`;
  return html`<div class="space-y-4">
    <div class="rounded-2xl border border-line bg-panel-2/40 p-5">
      <div class="relative mx-auto h-56 w-56 rounded-2xl bg-[#fff] p-2.5">
        <img src="/api/qr?data=${encodeURIComponent(addr)}" alt="QR code for your ${a.symbol} deposit address" width="320" height="320" class="h-full w-full" data-qr />
        <span class="absolute top-1/2 left-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#fff] p-1">${coinLogo(a.symbol, a.color, 40)}</span>
      </div>
      <p class="mt-6 text-sm text-dim">Deposit Address</p>
      <div class="mt-1.5 flex items-center gap-3">
        <p class="min-w-0 flex-1 font-mono text-[15px] leading-relaxed font-bold break-all text-white">${highlight(addr)}</p>
        <button type="button" data-copy="${addr}" class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-panel-3 text-fg hover:text-accent" aria-label="Copy deposit address">${icon("copy", "h-5 w-5")}</button>
      </div>
      ${d.address.memo
        ? html`<div class="mt-4 rounded-xl border border-warn/30 bg-warn-soft/40 p-3"><p class="text-xs font-semibold text-warn">Memo / tag (required)</p><div class="mt-1 flex items-center gap-3"><p class="flex-1 font-mono text-sm font-bold break-all text-white">${d.address.memo}</p><button type="button" data-copy="${d.address.memo}" class="grid h-9 w-9 place-items-center rounded-full bg-panel-3" aria-label="Copy memo">${icon("copy", "h-4 w-4")}</button></div></div>`
        : ""}
      <div class="mt-4 border-t border-line pt-3">
        <button type="button" class="mx-auto flex items-center gap-1.5 text-sm text-muted hover:text-white" aria-expanded="${moreOpen ? "true" : "false"}" data-more>More Details ${icon(moreOpen ? "chevron-up" : "chevron-down", "h-4 w-4")}</button>
        ${moreOpen
          ? html`<dl class="mt-2 divide-y divide-line/60">${detail("Minimum deposit", html`<span class="num">&gt;${formatNumber(n.minDeposit, 8)} ${a.symbol}</span>`)}${detail("Network confirmations", String(n.confirmations))}${n.processingTime ? detail("Est. arrival", `≈ ${n.processingTime}`) : ""}${detail("Credited to", "Funding wallet")}</dl>`
          : ""}
      </div>
    </div>
    ${notice("warn", { body: html`Send only <b>${a.symbol}</b> on <b>${n.name}</b> to this address. Other coins or networks may be permanently lost.${d.address.shared ? " This is a shared platform address — report your transaction hash below so we can credit your account." : ""}` })}
    <button type="button" class="btn btn-primary w-full py-3.5 text-base" data-share>${icon("share-2", "h-5 w-5")} Save and Share Address</button>
    <details class="group rounded-2xl border border-line bg-base-2 p-4" ${d.address.shared ? html`open` : ""}>
      <summary class="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-white">Already sent? Report your deposit ${icon("chevron-down", "h-4 w-4 text-dim transition-transform group-open:rotate-180")}</summary>
      <form data-report class="mt-4 space-y-4" novalidate>
        <div class="grid gap-3 sm:grid-cols-2">${field({ name: "amount", label: "Amount sent", inputmode: "decimal", suffix: a.symbol })}${field({ name: "txHash", label: "Transaction hash", cls: "font-mono", autocomplete: "off" })}</div>
        <div data-form-error hidden></div>
        <button type="submit" class="btn btn-secondary w-full">I've sent the funds</button>
      </form>
    </details>
  </div>`;
}

function addressStep(a, n) {
  return frame(
    `Deposit ${a.symbol}`,
    html`<button type="button" class="mb-4 flex w-full items-center gap-3 rounded-2xl border border-line bg-panel-2/40 p-4 text-left hover:border-accent/50" data-go-step="network">
      <span class="min-w-0 flex-1"><span class="block text-sm text-dim">Network</span><span class="mt-1 block"><span class="font-display text-lg font-extrabold text-white">${networkTicker(n.code)}</span> <span class="text-sm text-muted">${n.name}</span></span></span>
      ${networkLogo(n.code, a.color, 28)}${icon("chevron-right", "h-5 w-5 text-dim")}
    </button>
    <div data-address>${addressBody(a, n)}</div>`,
  );
}

function loadInstructions() {
  const key = user.emailVerified && state.step === "address" ? `/api/deposits/address?asset=${state.asset}&network=${state.network}` : "";
  if (key === instrKey) return;
  instrUnsub?.();
  instrUnsub = null;
  instrKey = key;
  instr = { data: null, error: null };
  moreOpen = false;
  if (!key) return;
  instrUnsub = watch(key, ({ data, error }) => {
    instr = { data: data ?? null, error: data ? null : error };
    const a = coinOf(state.asset);
    const n = networkOf();
    const el = $("[data-address]", view);
    if (el && a && n) mount(el, addressBody(a, n));
  });
}

function render() {
  const el = $("[data-flow]", view);
  if (!assets) return;
  const a = coinOf(state.asset);
  // Fall back to the furthest valid step when the URL points somewhere unusable.
  if (state.step !== "coin" && (!a || !depositable(a))) state = { step: "coin", asset: "", network: "" };
  const n = networkOf();
  if (state.step === "address" && (!n || !n.depositEnabled)) state = { ...state, step: "network", network: "" };
  loadInstructions();
  mount(el, state.step === "coin" ? coinStep() : state.step === "method" ? methodStep(a) : state.step === "network" ? networkStep(a) : addressStep(a, n));
}

watch("/api/assets/networks", ({ data, error }) => {
  if (!data) return error && mount($("[data-flow]", view), html`<div class="p-5">${errorState({ message: error.message })}</div>`);
  assets = data;
  render();
});

const PREV = { method: "coin", network: "method", address: "network" };
on(view, "click", "[data-back]", () => go({ step: PREV[state.step] ?? "coin" }));
on(view, "click", "[data-go-step]", (_e, b) => go({ step: b.dataset.goStep }));
on(view, "click", "[data-coin]", (_e, b) => go({ step: "method", asset: b.dataset.coin, network: "" }));
on(view, "click", "[data-method]", () => go({ step: "network" }));
on(view, "click", "[data-network]", (_e, b) => go({ step: "address", network: b.dataset.network }));
on(view, "click", "[data-more]", () => {
  moreOpen = !moreOpen;
  const a = coinOf(state.asset);
  const n = networkOf();
  if (a && n) mount($("[data-address]", view), addressBody(a, n));
});

/* Save and share: native share sheet (with the QR image where supported), else copy + download the QR. */
on(view, "click", "[data-share]", async (_e, b) => {
  const d = instr.data;
  const n = networkOf();
  if (!d?.address || !n) return;
  const addr = d.address.address;
  const text = `My ${state.asset} deposit address (${n.name}):\n${addr}${d.address.memo ? `\nMemo: ${d.address.memo}` : ""}`;
  let file = null;
  try {
    const blob = await (await fetch($("[data-qr]", view).src)).blob();
    file = new File([blob], `harborfinance-${state.asset}-${n.code}-deposit.png`, { type: "image/png" });
  } catch {
    /* sharing still works without the image */
  }
  if (navigator.share) {
    try {
      await navigator.share(file && navigator.canShare?.({ files: [file] }) ? { title: `${state.asset} deposit address`, text, files: [file] } : { title: `${state.asset} deposit address`, text });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }
  b.disabled = true;
  try {
    await navigator.clipboard.writeText(addr).catch(() => {});
    if (file) {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
    toast.success("Address saved", file ? "Address copied and QR code downloaded." : "Address copied to clipboard.");
  } finally {
    b.disabled = false;
  }
});

async function submit(form, kind) {
  const amount = form.amount.value.trim();
  const { asset, network } = state;
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
                <div class="flex items-center gap-3">${coinLogo(d.asset.symbol, d.asset.color, 32)}<div><p class="flex items-center gap-2 text-sm font-semibold text-white">+${formatNumber(d.amount, 8)} ${d.asset.symbol} ${d.isDemo ? smallDemo() : ""}</p><p class="text-xs text-dim">${d.network.name} · ${formatDate(d.createdAt)}${d.txHash ? ` · ${truncateMiddle(d.txHash, 6)}` : ""}</p></div></div>
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
