import { html, raw, $, on, mount } from "../core/dom.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { card, pageHeader, statusBadge, badge, assetIcon, errorState, skeleton, toast, openModal, DataTable } from "../core/ui.js";
import { field, bindForm, rules } from "../core/forms.js";
import { formatCompact, titleCase } from "../core/format.js";
import { adminPage } from "../components/admin-kit.js";

const { user: admin, view } = await adminPage();
const canManage = admin.can("markets.manage");
let data = null;

mount(
  view,
  html`${pageHeader({ title: "Markets", description: "Halt or delist markets, feature them on the homepage and manage trading fees." })}
    ${card({ title: "Trading fees", description: "Global maker/taker rates (fractions, e.g. 0.001 = 0.10%)", body: html`<div class="grid gap-3 px-5 pb-5 sm:grid-cols-2" data-fees>${skeleton("h-24 w-full")}${skeleton("h-24 w-full")}</div>` })}
    ${card({ cls: "mt-6", title: "Markets", body: html`<div data-markets></div>` })}`,
);

const table = new DataTable($("[data-markets]", view), {
  defaultSort: { key: "vol", dir: "desc" },
  columns: [
    { key: "m", header: "Market", sortValue: (m) => m.symbol, cell: (m) => html`<span class="flex items-center gap-2">${assetIcon(m.symbol.split("-")[0], m.color, 24)}<span><span class="block font-semibold text-white">${m.symbol}</span><span class="block text-xs text-dim">${m.name}</span></span></span>` },
    { key: "c", header: "Categories", hideOnMobile: true, cell: (m) => html`<span class="flex flex-wrap gap-1">${m.categories.filter((c) => c !== "SPOT").map((c) => badge(titleCase(c)))}</span>` },
    { key: "vol", header: "Volume 30d", align: "right", sortValue: (m) => Number(m.volume30d), cell: (m) => html`<span class="num">${formatCompact(m.volume30d)}</span>` },
    { key: "t", header: "Fills 30d", align: "right", sortValue: (m) => m.trades30d, cell: (m) => String(m.trades30d) },
    { key: "f", header: "Featured", align: "center", cell: (m) => (canManage ? html`<button type="button" role="switch" class="switch" aria-label="Featured" aria-checked="${m.isFeatured ? "true" : "false"}" data-feature="${m.id}"></button>` : m.isFeatured ? "Yes" : "—") },
    {
      key: "s",
      header: "Status",
      cell: (m) =>
        canManage
          ? html`<select class="select h-8 w-32 text-xs" aria-label="${m.symbol} status" data-status="${m.id}">${["ACTIVE", "HALTED", "DELISTED"].map((s) => html`<option value="${s}" ${m.status === s ? raw("selected") : ""}>${titleCase(s)}</option>`)}</select>`
          : statusBadge(m.status),
    },
  ],
});
table.set(undefined, { loading: true });

watch("/api/admin/markets", ({ data: d, error }) => {
  if (!d) return error && mount(view, errorState({ message: error.message }));
  data = d;
  table.set(d.markets);
  mount(
    $("[data-fees]", view),
    d.fees
      .filter((f) => !f.marketId)
      .map(
        (f) => html`<div class="flex items-center justify-between rounded-xl border border-line bg-base-2 p-4"><div><p class="text-sm font-semibold text-white">${titleCase(f.type.replace("TRADING_", ""))} fee</p><p class="num text-2xl font-bold text-white">${(Number(f.rate) * 100).toFixed(3)}%</p></div>${canManage ? html`<button type="button" class="btn btn-secondary btn-sm" data-fee="${f.id}">Edit</button>` : ""}</div>`,
      ),
  );
});

const patch = async (id, body) => {
  try {
    await api(`/api/admin/markets/${id}`, { method: "PATCH", body });
    toast.success("Market updated");
  } catch (err) {
    toast.error("Update failed", err.message);
  }
  invalidate("/api/admin/markets");
};
on(view, "click", "[data-feature]", (_e, b) => {
  b.disabled = true;
  patch(b.dataset.feature, { isFeatured: b.getAttribute("aria-checked") !== "true" });
});
on(view, "change", "[data-status]", (_e, s) => patch(s.dataset.status, { status: s.value }));

on(view, "click", "[data-fee]", (_e, b) => {
  const fee = data?.fees.find((f) => f.id === b.dataset.fee);
  if (!fee) return;
  const m = openModal({
    title: `Edit ${titleCase(fee.type.replace("TRADING_", ""))} fee`,
    body: html`<form id="fee-form" class="space-y-3" novalidate>${field({ name: "rate", label: "Rate (fraction)", value: fee.rate, inputmode: "decimal", suffix: html`<span data-pct></span>` })}<p class="text-xs text-dim">Changes apply to new orders immediately and are published on the Fees page.</p><div data-form-error hidden></div></form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="fee-form" class="btn btn-primary">Save</button>`,
  });
  const form = $("#fee-form", m.el);
  const sync = () => ($("[data-pct]", form).textContent = `= ${(Number(form.rate.value) * 100 || 0).toFixed(3)}%`);
  sync();
  form.rate.addEventListener("input", sync);
  bindForm(form, { rate: [rules.pattern(/^0(\.\d+)?$/, "Enter a fraction between 0 and 1, e.g. 0.001"), rules.required("Rate")] }, async (v) => {
    await api(`/api/admin/fees/${fee.id}`, { method: "PATCH", body: { rate: v.rate } });
    toast.success("Fee updated");
    m.close();
    invalidate("/api/admin/markets");
  });
});
