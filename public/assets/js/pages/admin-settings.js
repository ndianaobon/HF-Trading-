import { html, raw, $, on, mount, cx } from "../core/dom.js";
import { api, ApiError } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { card, pageHeader, notice, errorState, skeleton, toast, withBusy } from "../core/ui.js";
import { timeAgo, titleCase } from "../core/format.js";
import { adminPage } from "../components/admin-kit.js";

const { view } = await adminPage();
const label = (k) => titleCase(k.replace(/([A-Z])/g, "_$1"));
let rows = [];

mount(view, html`${pageHeader({ title: "Settings", description: "Platform configuration. Every change is recorded in the audit log." })}<div data-mode></div><div class="space-y-6" data-settings>${skeleton("h-96 w-full rounded-2xl")}</div>`);

/** Renders an editor for one setting; the input type follows the stored value's type. */
function editor(row) {
  const id = (k) => `${row.key}-${k}`.replace(/[^\w-]/g, "_");
  const input = (k, v) => {
    const full = (typeof v === "string" && (v.length > 60 || k === "terms" || k === "message")) || Array.isArray(v) || (v && typeof v === "object");
    let control;
    if (typeof v === "boolean")
      control = html`<label class="flex items-center justify-between rounded-xl border border-line p-3 text-sm text-fg">${label(k)}<button type="button" role="switch" class="switch" aria-label="${label(k)}" aria-checked="${v ? "true" : "false"}" data-k="${k}" data-type="boolean"></button></label>`;
    else if (typeof v === "number") control = html`<div class="field"><label class="label" for="${id(k)}">${label(k)}</label><input id="${id(k)}" type="number" step="any" class="input" value="${v}" data-k="${k}" data-type="number" /></div>`;
    else if (Array.isArray(v) || (v && typeof v === "object"))
      control = html`<div class="field"><label class="label" for="${id(k)}">${label(k)} (JSON)</label><textarea id="${id(k)}" rows="3" class="textarea font-mono text-xs" data-k="${k}" data-type="json">${JSON.stringify(v, null, 2)}</textarea></div>`;
    else if (k === "qualifyingAction")
      control = html`<div class="field"><label class="label" for="${id(k)}">Qualifying action</label><select id="${id(k)}" class="select" data-k="${k}" data-type="string">${[["FIRST_DEPOSIT", "First deposit"], ["KYC_APPROVED", "KYC approved"]].map(([val, l]) => html`<option value="${val}" ${v === val ? raw("selected") : ""}>${l}</option>`)}</select></div>`;
    else if (full) control = html`<div class="field"><label class="label" for="${id(k)}">${label(k)}</label><textarea id="${id(k)}" rows="3" class="textarea" data-k="${k}" data-type="string">${String(v ?? "")}</textarea></div>`;
    else control = html`<div class="field"><label class="label" for="${id(k)}">${label(k)}</label><input id="${id(k)}" class="input" value="${String(v ?? "")}" data-k="${k}" data-type="${v === null ? "nullable" : "string"}" /></div>`;
    return html`<div class="${cx(full && "sm:col-span-2")}">${control}</div>`;
  };
  return card({
    title: html`<span class="font-mono text-sm">${row.key}</span>`,
    description: row.description,
    action: row.updatedAt ? html`<span class="text-xs text-dim">Updated ${timeAgo(row.updatedAt)}</span>` : "",
    body: html`<form class="card-body space-y-3" data-setting="${row.key}" novalidate>
      ${row.key === "company.profile" ? notice("warn", { body: "Only mark as verified once legal entity, registration and licence details are confirmed with documentation. Unverified details are never shown publicly." }) : ""}
      <div class="grid gap-3 sm:grid-cols-2">${Object.entries(row.value).map(([k, v]) => input(k, v))}</div>
      <div data-err></div>
      <button type="submit" class="btn btn-primary btn-sm">Save</button>
    </form>`,
  });
}

watch("/api/admin/settings", ({ data, error }) => {
  if (!data) return error && mount($("[data-settings]", view), errorState({ message: error.message }));
  mount(
    $("[data-mode]", view),
    notice(data.mode === "demo" ? "warn" : "info", {
      cls: "mb-6",
      iconName: data.mode === "demo" ? "flask-conical" : "info",
      title: `Platform mode: ${data.mode.toUpperCase()}`,
      body: data.mode === "demo" ? "Demo mode is controlled by the APP_MODE environment variable. Balances, deposits and fills are simulated." : "Live mode: real funds only move through configured payment providers and execution venues.",
    }),
  );
  // Don't wipe a form someone is editing on background refresh.
  if (rows.length && $("[data-settings]", view).contains(document.activeElement)) return;
  rows = data.settings;
  mount($("[data-settings]", view), rows.map(editor));
});

on(view, "click", "[data-type='boolean']", (_e, b) => b.setAttribute("aria-checked", b.getAttribute("aria-checked") === "true" ? "false" : "true"));

on(view, "submit", "[data-setting]", async (e, form) => {
  e.preventDefault();
  const key = form.dataset.setting;
  const err = $("[data-err]", form);
  mount(err, "");
  const value = {};
  try {
    for (const el of form.querySelectorAll("[data-k]")) {
      const k = el.dataset.k;
      const t = el.dataset.type;
      if (t === "boolean") value[k] = el.getAttribute("aria-checked") === "true";
      else if (t === "number") {
        if (el.value.trim() === "" || !Number.isFinite(Number(el.value))) throw new Error(`${label(k)} must be a number.`);
        value[k] = Number(el.value);
      } else if (t === "json") {
        try {
          value[k] = JSON.parse(el.value);
        } catch {
          throw new Error(`${label(k)} must be valid JSON.`);
        }
      } else if (t === "nullable") value[k] = el.value.trim() || null;
      else value[k] = el.value;
    }
  } catch (ex) {
    return mount(err, notice("down", { body: ex.message }));
  }
  try {
    await withBusy(form.querySelector("[type=submit]"), () => api("/api/admin/settings", { method: "PUT", body: { key, value } }));
    toast.success("Setting saved", key);
    form.querySelector("[type=submit]").blur();
    invalidate("/api/admin/settings");
  } catch (ex) {
    const msg = ex instanceof ApiError && ex.fields ? Object.entries(ex.fields).map(([k, v]) => `${k}: ${v}`).join("; ") : ex.message;
    mount(err, notice("down", { body: msg }));
  }
});
