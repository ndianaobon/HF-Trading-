import { html, $, on, mount, param } from "../core/dom.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { card, notice, errorState, emptyState, skeleton, pageHeader, smallDemo, statusBadge, riskBadge, toast, openModal, confirmDialog, DataTable } from "../core/ui.js";
import { field, checkboxField } from "../core/forms.js";
import { formatDate, formatDuration, formatNumber, formatUsd, toNum } from "../core/format.js";
import { planCard } from "../components/plan-card.js";

const user = await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

mount(
  view,
  html`${pageHeader({ title: "Investment Plans", description: "Managed strategies with documented terms. Returns are not guaranteed." })}
    ${notice("warn", { cls: "mb-6", title: "Digital-asset investments carry risk", body: "Actual returns can vary and may be negative. A subscription's result is only known when it is settled." })}
    ${card({ cls: "mb-6", title: "My subscriptions", description: html`<span data-subs-desc>Loading…</span>`, body: html`<div class="border-t border-line" data-subs></div>` })}
    <h2 class="mb-4 font-display text-lg font-bold text-white">Available plans</h2>
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2" data-plans>${[0, 1, 2, 3].map(() => skeleton("h-96 rounded-2xl"))}</div>`,
);

let plans = [];
let subs = [];
let usdt = 0;

const table = new DataTable($("[data-subs]", view), {
  empty: emptyState({ title: "No subscriptions yet", description: "Choose a plan below to get started." }),
  columns: [
    { key: "plan", header: "Plan", cell: (s) => html`<span class="flex items-center gap-2 font-semibold text-white">${s.plan.name} ${s.isDemo ? smallDemo() : ""}</span>` },
    { key: "amount", header: "Allocation", align: "right", cell: (s) => html`<span class="num">${formatNumber(s.amount, 2)} USDT</span>` },
    { key: "risk", header: "Risk", hideOnMobile: true, cell: (s) => riskBadge(s.plan.riskLevel) },
    { key: "period", header: "Term", hideOnMobile: true, cell: (s) => html`<span class="text-xs text-muted">${s.startedAt ? `${formatDate(s.startedAt, "date")} → ${formatDate(s.endsAt, "date")}` : "Awaiting allocation window"}</span>` },
    {
      key: "pnl",
      header: "Realised P&L",
      align: "right",
      cell: (s) =>
        s.realizedPnl === null
          ? html`<span class="text-xs text-dim">${s.status === "ACTIVE" && s.endsAt && new Date(s.endsAt) < new Date() ? "Awaiting settlement" : "Not yet settled"}</span>`
          : html`<span class="num font-semibold ${toNum(s.realizedPnl) >= 0 ? "text-up" : "text-down"}">${formatUsd(s.realizedPnl, { sign: true })}</span>`,
    },
    { key: "status", header: "Status", cell: (s) => statusBadge(s.status) },
    {
      key: "act",
      header: html`<span class="sr-only">Actions</span>`,
      align: "right",
      cell: (s) => (s.status === "PENDING" || (s.status === "ACTIVE" && s.plan.earlyExitAllowed) ? html`<button type="button" class="btn btn-ghost btn-sm" data-cancel="${s.id}">${s.status === "PENDING" ? "Cancel" : "Exit early"}</button>` : ""),
    },
  ],
});
table.set(undefined, { loading: true });

watch("/api/investments", ({ data, error }) => {
  if (!data) return error && table.set(undefined, { error });
  subs = data;
  const active = data.filter((s) => s.status === "ACTIVE" || s.status === "PENDING");
  $("[data-subs-desc]", view).textContent = `${active.length} active or pending · ${formatUsd(active.reduce((s, x) => s + toNum(x.amount), 0))} allocated`;
  table.set(data);
});
watch("/api/wallets", ({ data }) => data && (usdt = toNum(data.find((w) => w.symbol === "USDT")?.available)));

let autoOpened = false;
watch("/api/investments/plans", ({ data, error }) => {
  if (!data) return error && mount($("[data-plans]", view), html`<div class="lg:col-span-2">${errorState({ message: error.message })}</div>`);
  plans = data;
  mount(
    $("[data-plans]", view),
    data.map((p) => planCard(p, html`<button type="button" class="btn btn-primary w-full" data-plan="${p.id}" ${user.emailVerified ? "" : html`disabled`}>${user.emailVerified ? "Choose allocation" : "Verify email to subscribe"}</button>`)),
  );
  const slug = param("plan");
  if (slug && !autoOpened && user.emailVerified) {
    autoOpened = true;
    const p = data.find((x) => x.slug === slug);
    if (p) subscribe(p);
  }
});

on(view, "click", "[data-plan]", (_e, b) => {
  const p = plans.find((x) => x.id === b.dataset.plan);
  if (p) subscribe(p);
});

on(view, "click", "[data-cancel]", async (_e, b) => {
  const s = subs.find((x) => x.id === b.dataset.cancel);
  if (!s) return;
  const pending = s.status === "PENDING";
  const ok = await confirmDialog({
    title: pending ? "Cancel subscription?" : "Exit plan early?",
    message: pending
      ? `Your ${formatNumber(s.amount, 2)} USDT allocation will be refunded in full.`
      : `Your allocation is returned minus an early-exit fee of ${Number(s.plan.earlyExitFeePct)}% and pro-rated management fees. No performance is credited for an early exit.`,
    confirmLabel: "Confirm",
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/investments/${s.id}`, { method: "DELETE" });
    toast.success("Subscription cancelled", "Funds have been returned to your wallet.");
    ["/api/investments", "/api/wallets", "/api/portfolio"].forEach(invalidate);
  } catch (err) {
    toast.error("Could not cancel", err.message);
  }
});

/** Two-step subscription dialog: amount → review terms → confirm. */
function subscribe(plan) {
  let amount = String(Number(plan.minAllocation));
  let terms = false;
  const m = openModal({ title: `Subscribe to ${plan.name}`, description: "Choose how much to allocate.", size: "md" });
  const setError = (msg) => mount($("[data-err]", m.el), msg ? notice("down", { body: msg }) : "");

  const formStep = () => {
    m.setBody(html`<form data-step-form class="space-y-4" novalidate>
      <div><div class="mb-1.5 flex justify-end text-xs text-dim">Available ${formatNumber(usdt, 2)} USDT</div>${field({ name: "amount", label: "Allocation", inputmode: "decimal", value: amount, suffix: "USDT", hint: `Between ${formatNumber(plan.minAllocation)} and ${formatNumber(plan.maxAllocation)} USDT` })}</div>
      <div class="flex items-center justify-between rounded-xl border border-line bg-base-2 p-3 text-sm"><span class="text-dim">Risk</span>${riskBadge(plan.riskLevel)}</div>
      <p class="text-sm text-muted">${plan.strategy}</p>
      <div data-err></div>
    </form>`);
    m.setFooter(html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn btn-primary" data-next>Review terms</button>`);
  };

  const reviewStep = () => {
    const mgmt = (toNum(amount) * toNum(plan.managementFeePct) * plan.durationDays) / 100 / 365;
    const rows = [
      ["Allocation", `${formatNumber(amount, 2)} USDT`],
      ["Duration", formatDuration(plan.durationDays)],
      ["Management fee", `${Number(plan.managementFeePct)}% / yr (≈ ${formatNumber(mgmt, 2)} USDT over the term)`],
      ["Performance fee", `${Number(plan.performanceFeePct)}% of positive realised P&L only`],
      ["Early exit", plan.earlyExitAllowed ? `Allowed, ${Number(plan.earlyExitFeePct)}% fee` : "Not permitted"],
      ["Projected return", "None — returns are not projected or guaranteed"],
    ];
    m.setBody(html`<div class="space-y-4">
      <dl class="space-y-2 text-sm">${rows.map(([k, v]) => html`<div class="flex justify-between gap-4 border-b border-line/60 pb-2"><dt class="text-dim">${k}</dt><dd class="text-right text-white">${v}</dd></div>`)}</dl>
      ${notice("warn", { body: plan.riskDescription })}
      ${checkboxField({ name: "terms", checked: terms, label: html`I understand this plan carries risk, returns are not guaranteed, and I accept the plan terms, the <a href="/terms" target="_blank" class="text-accent underline">Terms of Service</a> and the <a href="/risk-disclosure" target="_blank" class="text-accent underline">Risk Disclosure</a>.` })}
      <div data-err></div>
    </div>`);
    m.setFooter(html`<button type="button" class="btn btn-secondary" data-back>Back</button><button type="button" class="btn btn-primary" data-confirm ${terms ? "" : html`disabled`}>Confirm subscription</button>`);
  };

  on(m.el, "click", "[data-next]", () => {
    amount = $("[name=amount]", m.el).value.trim();
    const a = toNum(amount);
    if (!/^\d+(\.\d+)?$/.test(amount) || a <= 0) return setError("Enter a valid amount.");
    if (a < toNum(plan.minAllocation)) return setError(`Minimum allocation is ${formatNumber(plan.minAllocation)} USDT.`);
    if (a > toNum(plan.maxAllocation)) return setError(`Maximum allocation is ${formatNumber(plan.maxAllocation)} USDT.`);
    if (a > usdt) return setError("Insufficient available USDT balance.");
    reviewStep();
  });
  on(m.el, "submit", "[data-step-form]", (e) => {
    e.preventDefault();
    $("[data-next]", m.el)?.click();
  });
  on(m.el, "click", "[data-back]", formStep);
  on(m.el, "change", "[name=terms]", (e) => {
    terms = e.target.checked;
    $("[data-confirm]", m.el).disabled = !terms;
  });
  on(m.el, "click", "[data-confirm]", async (_e, btn) => {
    if (!terms) return setError("Please accept the plan terms and risk disclosure.");
    btn.disabled = true;
    try {
      await api("/api/investments", { body: { planId: plan.id, amount, acceptTerms: true } });
      toast.success(`Subscribed to ${plan.name}`, "Your allocation is pending activation.");
      m.close();
      ["/api/investments", "/api/wallets", "/api/portfolio", "/api/transactions"].forEach(invalidate);
    } catch (err) {
      btn.disabled = false;
      setError(err.message ?? "Something went wrong.");
    }
  });
  formStep();
}
