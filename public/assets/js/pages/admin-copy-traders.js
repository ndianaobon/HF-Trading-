import { html, $, on, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { card, pageHeader, riskBadge, demoBadge, avatar, notice, toast, openModal, DataTable } from "../core/ui.js";
import { field, selectField, textareaField, bindForm, rules } from "../core/forms.js";
import { formatPercent, formatUsd, titleCase } from "../core/format.js";
import { adminPage } from "../components/admin-kit.js";

const { view } = await adminPage();
let traders = [];

mount(
  view,
  html`${pageHeader({ title: "Copy traders", description: "Trader statistics must come from verified trading records. Demo profiles are labelled to users.", actions: html`<button type="button" class="btn btn-primary" data-new>${icon("plus", "h-4 w-4")} New trader</button>` })}
    ${card({ body: html`<div data-table></div>` })}`,
);

const table = new DataTable($("[data-table]", view), {
  columns: [
    { key: "n", header: "Trader", cell: (t) => html`<span class="flex items-center gap-2">${avatar(t.displayName, t.avatarColor, 30)}<span><span class="flex items-center gap-1.5 font-semibold text-white">${t.displayName} ${t.isDemo ? demoBadge("Demo stats", "px-1 py-0 text-[9px]") : ""}</span><span class="block text-xs text-dim">${t.strategy}</span></span></span>` },
    { key: "r", header: "Risk", cell: (t) => riskBadge(t.riskLevel) },
    { key: "ret", header: "90D", align: "right", cell: (t) => (t.returns["90d"] !== undefined ? html`<span class="num ${t.returns["90d"] >= 0 ? "text-up" : "text-down"}">${formatPercent(t.returns["90d"])}</span>` : html`<span class="text-dim">—</span>`) },
    { key: "dd", header: "Max DD", align: "right", hideOnMobile: true, cell: (t) => `${Number(t.maxDrawdownPct).toFixed(1)}%` },
    { key: "c", header: "Copiers", align: "right", cell: (t) => html`<span class="num text-xs">${t.copiers} · ${formatUsd(t.copiedAllocation)}</span>` },
    { key: "a", header: "Published", align: "right", cell: (t) => html`<button type="button" role="switch" class="switch" aria-label="Published" aria-checked="${t.isActive ? "true" : "false"}" data-publish="${t.id}"></button>` },
  ],
});
table.set(undefined, { loading: true });
watch("/api/admin/copy-traders", ({ data, error }) => {
  if (!data) return error && table.set(undefined, { error });
  traders = data;
  table.set(data);
});

on(view, "click", "[data-publish]", async (_e, b) => {
  const t = traders.find((x) => x.id === b.dataset.publish);
  if (!t) return;
  b.disabled = true;
  try {
    await api(`/api/admin/copy-traders/${t.id}`, { method: "PATCH", body: { isActive: !t.isActive } });
    toast.success(t.isActive ? "Trader hidden" : "Trader published");
  } catch (err) {
    toast.error("Update failed", err.message);
  }
  invalidate("/api/admin/copy-traders");
});

on(view, "click", "[data-new]", () => {
  const m = openModal({
    title: "New trader profile",
    size: "lg",
    body: html`<form id="trader-form" class="grid gap-4 sm:grid-cols-2" novalidate>
      ${notice("info", { iconName: "info", cls: "sm:col-span-2", body: "Performance fields start empty and should be populated from verified track records via an integration — they cannot be typed in here." })}
      ${field({ name: "displayName", label: "Display name" })}
      ${field({ name: "slug", label: "Slug", hint: "Lowercase letters, numbers and hyphens" })}
      ${field({ name: "strategy", label: "Strategy" })}
      ${selectField({ name: "riskLevel", label: "Risk level", value: "MEDIUM", options: ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"].map((r) => [r, titleCase(r)]) })}
      ${field({ name: "strategyTags", label: "Strategy tags (comma separated)" })}
      ${field({ name: "assets", label: "Assets (comma separated)" })}
      ${field({ name: "minAllocation", label: "Min allocation (USDT)", value: "100", inputmode: "decimal" })}
      ${field({ name: "profitSharePct", label: "Profit share %", value: "10", inputmode: "decimal" })}
      ${textareaField({ name: "bio", label: "Bio", rows: 3, cls: "sm:col-span-2" })}
      <div class="sm:col-span-2" data-form-error hidden></div>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="trader-form" class="btn btn-primary">Create</button>`,
  });
  const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
  bindForm(
    $("#trader-form", m.el),
    {
      displayName: [rules.min(2, "Name is too short")],
      slug: [rules.pattern(/^[a-z0-9-]{2,40}$/, "Use 2–40 lowercase letters, numbers or hyphens"), rules.required("Slug")],
      strategy: [rules.min(3, "Describe the strategy")],
      bio: [rules.min(10, "Write a short bio (10+ characters)")],
      minAllocation: [rules.decimal("Minimum allocation")],
      profitSharePct: [rules.pattern(/^\d+(\.\d+)?$/, "Enter a percentage")],
      strategyTags: [(v) => (list(v).length > 6 ? "At most 6 tags" : null)],
      assets: [(v) => (list(v).length > 10 ? "At most 10 assets" : null)],
    },
    async (v) => {
      await api("/api/admin/copy-traders", { body: { ...v, strategyTags: list(v.strategyTags), assets: list(v.assets).map((a) => a.toUpperCase()), avatarColor: "#F4BE2C" } });
      toast.success("Trader profile created", "It stays hidden until you publish it.");
      m.close();
      invalidate("/api/admin/copy-traders");
    },
  );
});
