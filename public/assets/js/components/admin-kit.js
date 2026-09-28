// Building blocks for admin pages: page bootstrap, filterable paged tables and
// the audited action dialog used for every sensitive operation.

import { html, raw, $, on, mount, param, debounce } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { watch } from "../core/store.js";
import { initAdmin } from "../core/app-shell.js";
import { pagination, emptyState, openModal, notice, DataTable } from "../core/ui.js";
import { titleCase } from "../core/format.js";

/** Initialises the admin shell; resolves with { user, view }. */
export async function adminPage() {
  const user = await initAdmin();
  const view = $("#view");
  view.removeAttribute("aria-busy");
  return { user, view };
}

export const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  return p.toString();
};

export const statusOptions = (list, all = "All statuses", label = titleCase) => [["", all], ...list.map((s) => [s, label(s)])];

/**
 * Filterable, paginated table backed by an admin list endpoint returning
 * { items, total, page, pageCount }.
 * filters: [{ name, type: "search" | "select", placeholder?, options?: [[value, label]], cls? }]
 * Initial filter values are read from the page URL (e.g. ?status=PENDING).
 * Returns { reload(), rows() }.
 */
export function adminTable(el, { endpoint, columns, filters = [], pageSize = 25, onRowClick, empty, rowClass, extraParams = {}, toolbarExtra, dense }) {
  const state = { page: 1, ...Object.fromEntries(filters.map((f) => [f.name, param(f.name) ?? f.default ?? ""])) };
  mount(
    el,
    html`<section class="card">
      ${filters.length || toolbarExtra
        ? html`<div class="flex flex-col gap-3 border-b border-line px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">${filters.map((f) =>
              f.type === "search"
                ? html`<div class="relative ${f.cls ?? "md:w-80"}">${icon("search", "pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-dim")}<input data-filter="${f.name}" value="${state[f.name]}" placeholder="${f.placeholder ?? "Search"}" aria-label="${f.placeholder ?? "Search"}" class="input h-10 pl-9 text-sm" /></div>`
                : html`<select data-filter="${f.name}" aria-label="${f.label ?? titleCase(f.name)}" class="select h-10 text-sm ${f.cls ?? "sm:w-48"}">${f.options.map(([v, l]) => html`<option value="${v}" ${String(v) === String(state[f.name]) ? raw("selected") : ""}>${l}</option>`)}</select>`,
            )}</div>
            ${toolbarExtra ? html`<div class="flex flex-wrap gap-2">${toolbarExtra}</div>` : ""}
          </div>`
        : ""}
      <div data-table></div>
      <div class="border-t border-line px-4 py-3" data-pages></div>
    </section>`,
  );
  const table = new DataTable($("[data-table]", el), { columns, onRowClick, rowClass, dense, empty: empty ?? emptyState({ title: "Nothing found" }) });
  table.set(undefined, { loading: true });
  let unsub = null;
  const key = () => `${endpoint}?${qs({ ...state, ...(typeof extraParams === "function" ? extraParams() : extraParams), pageSize })}`;
  const load = () => {
    unsub?.();
    unsub = watch(key(), ({ data, error }) => {
      if (!data) return error && table.set(undefined, { error });
      table.set(data.items);
      mount($("[data-pages]", el), pagination(state.page, data.pageCount, data.total));
    });
  };
  const setFilter = (name, value) => {
    state[name] = value;
    state.page = 1;
    load();
  };
  on(el, "change", "select[data-filter]", (_e, s) => setFilter(s.dataset.filter, s.value));
  on(
    el,
    "input",
    "input[data-filter]",
    debounce((_e, i) => setFilter(i.dataset.filter, i.value.trim()), 300),
  );
  on(el, "click", "[data-pages] [data-page]", (_e, b) => {
    state.page = Number(b.dataset.page);
    load();
  });
  load();
  return { reload: load, rows: () => table.rows ?? [], state };
}

/**
 * Confirmation dialog for sensitive admin actions with optional reason and
 * transaction-hash inputs. `onConfirm({ reason, txHash })` may throw; the
 * error is shown in the dialog. Resolves true when the action completed.
 */
export function actionModal({ title, description, confirmLabel, tone = "primary", reason, reasonLabel = "Reason", requireTxHash, warning, onConfirm, extraFields }) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title,
      description,
      onClose: () => resolve(done),
      body: html`<form class="space-y-4" data-action-form novalidate>
        ${warning ? notice("warn", { body: warning }) : ""}
        ${extraFields ?? ""}
        ${requireTxHash ? html`<div class="field"><label class="label" for="am-tx">Transaction hash</label><input id="am-tx" name="txHash" class="input font-mono" autocomplete="off" /></div>` : ""}
        ${reason ? html`<div class="field"><label class="label" for="am-reason">${reasonLabel}${reason === "required" ? "" : " (optional)"}</label><textarea id="am-reason" name="reason" rows="3" class="textarea" maxlength="500"></textarea></div>` : ""}
        <p class="text-xs text-dim">This action is recorded in the audit log with your account, IP address and timestamp.</p>
        <div data-err></div>
      </form>`,
      footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn ${tone === "danger" ? "btn-danger" : "btn-primary"}" data-go>${confirmLabel}</button>`,
    });
    const form = $("[data-action-form]", m.el);
    const fail = (msg) => mount($("[data-err]", m.el), msg ? notice("down", { body: msg }) : "");
    const go = async () => {
      const btn = $("[data-go]", m.el);
      const r = form.reason?.value.trim() ?? "";
      const tx = form.txHash?.value.trim() ?? "";
      if (reason === "required" && r.length < 3) return fail(`${reasonLabel} is required.`);
      if (requireTxHash && tx.length < 10) return fail("Enter the on-chain transaction hash.");
      btn.disabled = true;
      fail(null);
      try {
        await onConfirm({ reason: r || undefined, txHash: tx || undefined, form });
        done = true;
        m.close();
      } catch (err) {
        fail(err.message ?? "Action failed.");
        btn.disabled = false;
      }
    };
    on(m.el, "click", "[data-go]", go);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      go();
    });
  });
}

/** Two-column key/value list. */
export const kv = (rows) => html`<dl class="space-y-2 text-sm">${rows.map(([k, v]) => html`<div class="flex justify-between gap-3 border-b border-line/60 pb-2 last:border-0"><dt class="text-dim">${k}</dt><dd class="text-right text-fg">${v}</dd></div>`)}</dl>`;
