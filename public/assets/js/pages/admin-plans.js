import { html, $, on, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { card, pageHeader, statusBadge, riskBadge, smallDemo, emptyState, toast, openModal, DataTable } from "../core/ui.js";
import { field, selectField, textareaField, checkboxField, bindForm, rules } from "../core/forms.js";
import { formatDate, formatNumber, formatUsd, titleCase } from "../core/format.js";
import { adminPage, adminTable, actionModal } from "../components/admin-kit.js";

const { view } = await adminPage();
const EMPTY = { name: "", slug: "", tagline: "", description: "", strategy: "", riskLevel: "MEDIUM", riskDescription: "", minAllocation: "100", maxAllocation: "10000", durationDays: 30, managementFeePct: "1", performanceFeePct: "10", earlyExitAllowed: true, earlyExitFeePct: "1", status: "ACTIVE" };
let plans = [];

mount(
  view,
  html`${pageHeader({ title: "Investment plans", description: "Plans must describe strategy and risk honestly. Copy that promises or implies guaranteed returns is rejected.", actions: html`<button type="button" class="btn btn-primary" data-new>${icon("plus", "h-4 w-4")} New plan</button>` })}
    ${card({ body: html`<div data-plans></div>` })}
    <h2 class="mt-8 mb-3 font-display text-lg font-bold text-white">Subscriptions</h2>
    <div data-subs></div>`,
);

const table = new DataTable($("[data-plans]", view), {
  columns: [
    { key: "n", header: "Plan", cell: (p) => html`<div><p class="font-semibold text-white">${p.name}</p><p class="text-xs text-dim">${p.tagline}</p></div>` },
    { key: "r", header: "Risk", cell: (p) => riskBadge(p.riskLevel) },
    { key: "lim", header: "Limits", hideOnMobile: true, cell: (p) => html`<span class="num text-xs">${formatNumber(p.minAllocation, 0)} – ${formatNumber(p.maxAllocation, 0)} USDT · ${p.durationDays}d</span>` },
    { key: "fees", header: "Fees", hideOnMobile: true, cell: (p) => html`<span class="text-xs">${Number(p.managementFeePct)}% mgmt · ${Number(p.performanceFeePct)}% perf</span>` },
    { key: "subs", header: "Subscriptions", align: "right", cell: (p) => html`<span class="num text-xs">${p.activeCount} active · ${p.pendingCount} pending${p.maturedCount ? html`<br /><span class="text-warn">${p.maturedCount} awaiting settlement</span>` : ""}<br />${formatUsd(p.allocated)}</span>` },
    { key: "s", header: "Status", cell: (p) => statusBadge(p.status) },
    { key: "a", header: html`<span class="sr-only">Actions</span>`, align: "right", cell: (p) => html`<div class="flex justify-end gap-1"><button type="button" class="btn btn-ghost btn-sm" data-edit="${p.id}">Edit</button><button type="button" class="btn btn-ghost btn-sm" data-toggle="${p.id}">${p.status === "ACTIVE" ? "Disable" : "Enable"}</button></div>` },
  ],
});
table.set(undefined, { loading: true });
watch("/api/admin/investment-plans", ({ data, error }) => {
  if (!data) return error && table.set(undefined, { error });
  plans = data;
  table.set(data);
});

const isMatured = (s) => s.status === "ACTIVE" && s.endsAt && new Date(s.endsAt) <= new Date();

const subs = adminTable($("[data-subs]", view), {
  endpoint: "/api/admin/investment-subscriptions",
  pageSize: 20,
  filters: [{ name: "status", type: "select", default: "ACTIVE", options: [["PENDING", "Pending"], ["ACTIVE", "Active"], ["MATURED", "Awaiting settlement"], ["COMPLETED", "Completed"], ["CANCELLED", "Cancelled"], ["", "All"]] }],
  empty: emptyState({ title: "No subscriptions" }),
  columns: [
    { key: "u", header: "User", cell: (s) => html`<span class="flex items-center gap-1.5">${s.user.email} ${s.isDemo ? smallDemo() : ""}</span>` },
    { key: "p", header: "Plan", cell: (s) => s.plan.name },
    { key: "a", header: "Amount", align: "right", cell: (s) => html`<span class="num">${formatNumber(s.amount, 2)}</span>` },
    { key: "t", header: "Term", hideOnMobile: true, cell: (s) => html`<span class="text-xs text-muted">${s.startedAt ? `${formatDate(s.startedAt, "date")} → ${formatDate(s.endsAt, "date")}` : "Not started"}${isMatured(s) ? html`<span class="ml-1 text-warn">· matured</span>` : ""}</span>` },
    { key: "r", header: "Realised P&L", align: "right", cell: (s) => (s.realizedPnl === null ? html`<span class="text-dim">—</span>` : html`<span class="num ${Number(s.realizedPnl) >= 0 ? "text-up" : "text-down"}">${formatUsd(s.realizedPnl, { sign: true })}</span>`) },
    { key: "s", header: "Status", cell: (s) => (isMatured(s) ? statusBadge("PENDING", "Awaiting settlement") : statusBadge(s.status)) },
    {
      key: "x",
      header: html`<span class="sr-only">Actions</span>`,
      align: "right",
      cell: (s) =>
        html`<div class="flex justify-end gap-1">
          ${s.status === "PENDING" ? html`<button type="button" class="btn btn-primary btn-sm" data-sub="activate" data-id="${s.id}">Activate</button>` : ""}
          ${s.status === "ACTIVE" ? html`<button type="button" class="btn btn-primary btn-sm" data-sub="settle" data-id="${s.id}">Settle</button>` : ""}
          ${s.status === "ACTIVE" || s.status === "PENDING" ? html`<button type="button" class="btn btn-ghost btn-sm" data-sub="cancel" data-id="${s.id}">Cancel</button>` : ""}
        </div>`,
    },
  ],
});

on(view, "click", "[data-sub][data-id]", async (_e, b) => {
  const s = subs.rows().find((r) => r.id === b.dataset.id);
  if (!s) return;
  const action = b.dataset.sub;
  const ok = await actionModal({
    title: action === "activate" ? "Activate subscription" : action === "settle" ? "Settle subscription" : "Cancel subscription",
    description: `${s.user.email} · ${s.plan.name} · ${formatNumber(s.amount, 2)} USDT`,
    confirmLabel: action === "activate" ? "Activate" : action === "settle" ? "Settle & pay out" : "Cancel & refund",
    tone: action === "cancel" ? "danger" : "primary",
    warning: action === "cancel" ? "Pending subscriptions are refunded in full; active ones are returned minus early-exit and pro-rated fees." : undefined,
    extraFields:
      action === "settle"
        ? html`<p class="text-sm text-muted">Enter the realised P&amp;L reported by the strategy manager for this allocation (negative for a loss). Fees are deducted automatically.</p>${field({ name: "pnl", label: "Realised P&L", placeholder: "e.g. 125.40 or -80", suffix: "USDT", inputmode: "decimal" })}`
        : "",
    onConfirm: async ({ form }) => {
      const pnl = form.pnl?.value.trim() ?? "";
      if (action === "settle" && !/^-?\d+(\.\d+)?$/.test(pnl)) throw new Error("Enter the realised P&L as a number (use a minus sign for a loss).");
      await api(`/api/admin/investment-subscriptions/${s.id}`, { body: { action, realizedPnl: action === "activate" ? undefined : pnl || "0" } });
    },
  });
  if (ok) {
    toast.success("Subscription updated");
    invalidate("/api/admin/investment");
  }
});

on(view, "click", "[data-toggle]", async (_e, b) => {
  const p = plans.find((x) => x.id === b.dataset.toggle);
  if (!p) return;
  try {
    await api(`/api/admin/investment-plans/${p.id}`, { method: "PATCH", body: { status: p.status === "ACTIVE" ? "DISABLED" : "ACTIVE" } });
    toast.success(p.status === "ACTIVE" ? "Plan disabled" : "Plan enabled");
    invalidate("/api/admin/investment-plans");
  } catch (err) {
    toast.error("Update failed", err.message);
  }
});
on(view, "click", "[data-new]", () => editPlan(null));
on(view, "click", "[data-edit]", (_e, b) => editPlan(plans.find((p) => p.id === b.dataset.edit)));

function editPlan(plan) {
  const v = { ...EMPTY, ...(plan ?? {}) };
  const m = openModal({
    title: plan ? "Edit plan" : "Create plan",
    size: "lg",
    body: html`<form id="plan-form" class="grid gap-4 sm:grid-cols-2" novalidate>
      ${field({ name: "name", label: "Name", value: v.name })}
      ${field({ name: "slug", label: "Slug", value: v.slug, hint: "Lowercase letters, numbers and hyphens" })}
      ${field({ name: "tagline", label: "Tagline", value: v.tagline, cls: "sm:col-span-2" })}
      ${textareaField({ name: "description", label: "Description", value: v.description, rows: 2, cls: "sm:col-span-2" })}
      ${textareaField({ name: "strategy", label: "Strategy", value: v.strategy, rows: 2, cls: "sm:col-span-2" })}
      ${selectField({ name: "riskLevel", label: "Risk level", value: v.riskLevel, options: ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"].map((r) => [r, titleCase(r)]) })}
      ${field({ name: "durationDays", label: "Duration (days)", type: "number", value: String(v.durationDays), attrs: html`min="1"` })}
      ${textareaField({ name: "riskDescription", label: "Risk description", value: v.riskDescription, rows: 2, cls: "sm:col-span-2" })}
      ${field({ name: "minAllocation", label: "Min allocation (USDT)", value: String(v.minAllocation), inputmode: "decimal" })}
      ${field({ name: "maxAllocation", label: "Max allocation (USDT)", value: String(v.maxAllocation), inputmode: "decimal" })}
      ${field({ name: "managementFeePct", label: "Management fee % / yr", value: String(Number(v.managementFeePct)), inputmode: "decimal" })}
      ${field({ name: "performanceFeePct", label: "Performance fee %", value: String(Number(v.performanceFeePct)), inputmode: "decimal" })}
      <div class="flex items-center">${checkboxField({ name: "earlyExitAllowed", label: "Allow early exit", checked: v.earlyExitAllowed })}</div>
      ${field({ name: "earlyExitFeePct", label: "Early exit fee %", value: String(Number(v.earlyExitFeePct)), inputmode: "decimal" })}
      <div class="sm:col-span-2" data-form-error hidden></div>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="plan-form" class="btn btn-primary">Save plan</button>`,
  });
  const dec = (label) => [rules.required(label), rules.pattern(/^\d+(\.\d+)?$/, `Enter a valid ${label.toLowerCase()}`)];
  bindForm(
    $("#plan-form", m.el),
    {
      name: [rules.min(2, "Name is too short")],
      slug: [rules.pattern(/^[a-z0-9-]{2,40}$/, "Use 2–40 lowercase letters, numbers or hyphens"), rules.required("Slug")],
      tagline: [rules.min(5, "Tagline is too short")],
      description: [rules.min(10, "Describe the plan (10+ characters)")],
      strategy: [rules.min(10, "Describe the strategy (10+ characters)")],
      riskDescription: [rules.min(10, "Describe the risks (10+ characters)")],
      durationDays: [rules.pattern(/^\d+$/, "Enter a whole number of days")],
      minAllocation: dec("Minimum allocation"),
      maxAllocation: dec("Maximum allocation"),
      managementFeePct: dec("Management fee"),
      performanceFeePct: dec("Performance fee"),
      earlyExitFeePct: dec("Early exit fee"),
    },
    async (f) => {
      const body = { ...f, durationDays: Number(f.durationDays), status: v.status };
      if (plan) await api(`/api/admin/investment-plans/${plan.id}`, { method: "PATCH", body });
      else await api("/api/admin/investment-plans", { body });
      toast.success(plan ? "Plan updated" : "Plan created");
      m.close();
      invalidate("/api/admin/investment-plans");
    },
  );
}
