// Client-side validation that mirrors the server's Zod schemas. The server
// always re-validates; this only gives users immediate feedback.

import { ApiError } from "./api.js";
import { html, $, $$ } from "./dom.js";
import { icon } from "./icons.js";

export const rules = {
  required: (label) => (v) => (String(v ?? "").trim() ? null : `${label} is required`),
  email: () => (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim()) ? null : "Enter a valid email address"),
  min: (n, msg) => (v) => (String(v ?? "").trim().length >= n ? null : msg ?? `Must be at least ${n} characters`),
  max: (n, msg) => (v) => (String(v ?? "").length <= n ? null : msg ?? `Must be at most ${n} characters`),
  pattern: (re, msg) => (v) => (!v || re.test(String(v).trim()) ? null : msg),
  name: (label) => (v) => (/^[\p{L}\p{M}' .-]+$/u.test(String(v).trim()) ? null : `${label} contains invalid characters`),
  password: () => (v) => {
    const s = String(v ?? "");
    if (s.length < 8) return "Use at least 8 characters";
    if (s.length > 128) return "Password is too long";
    return null;
  },
  matches: (field, msg) => (v, all) => (v === all[field] ? null : msg),
  decimal: (label = "Amount") => (v) => (/^\d+(\.\d+)?$/.test(String(v).trim()) && Number(v) > 0 ? null : `Enter a valid ${label.toLowerCase()}`),
  checked: (msg) => (v) => (v === true ? null : msg),
  optional: (...inner) => (v, all) => {
    if (v === undefined || v === null || String(v).trim() === "") return null;
    for (const r of inner) {
      const e = r(v, all);
      if (e) return e;
    }
    return null;
  },
};

export function readForm(form) {
  const values = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") values[el.name] = el.checked;
    else if (el.type === "radio") {
      if (el.checked) values[el.name] = el.value;
    } else if (el.type !== "file") values[el.name] = el.value;
  }
  return values;
}

export function validate(schema, values) {
  const errors = {};
  for (const [field, list] of Object.entries(schema)) {
    for (const rule of list) {
      const err = rule(values[field], values);
      if (err) {
        errors[field] = err;
        break;
      }
    }
  }
  return errors;
}

export function showErrors(form, errors) {
  for (const el of $$("[data-error-for]", form)) {
    const msg = errors[el.dataset.errorFor];
    el.textContent = msg ?? "";
    el.hidden = !msg;
  }
  for (const el of form.elements) {
    if (!el.name) continue;
    if (errors[el.name]) el.setAttribute("aria-invalid", "true");
    else el.removeAttribute("aria-invalid");
  }
}

export function setFormError(form, message) {
  const box = $("[data-form-error]", form);
  if (!box) return;
  box.hidden = !message;
  box.innerHTML = message ? String(html`<div class="notice notice-down" role="alert"><div class="mt-0.5">${icon("alert-triangle", "h-4 w-4")}</div><div class="notice-body">${message}</div></div>`) : "";
}

/**
 * Wires validation + submission to a form. `onSubmit(values, form)` may throw
 * ApiError; its message and field errors are displayed automatically.
 */
export function bindForm(form, schema, onSubmit) {
  let submitted = false;
  const run = () => validate(typeof schema === "function" ? schema() : schema, readForm(form));
  form.addEventListener("input", () => submitted && showErrors(form, run()));
  form.addEventListener("change", () => submitted && showErrors(form, run()));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitted = true;
    setFormError(form, null);
    const errors = run();
    showErrors(form, errors);
    if (Object.keys(errors).length) {
      form.querySelector("[aria-invalid='true']")?.focus();
      return;
    }
    const btn = form.querySelector("[type=submit]") ?? document.querySelector(`[form="${form.id}"][type=submit]`);
    const prev = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${prev}`;
    }
    try {
      await onSubmit(readForm(form), form);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields) showErrors(form, err.fields);
        setFormError(form, err.message);
      } else {
        console.error(err);
        setFormError(form, "Something went wrong. Please try again.");
      }
    } finally {
      if (btn && btn.isConnected) {
        btn.disabled = false;
        btn.innerHTML = prev;
      }
    }
  });
}

/* ───────────── Field markup helpers ───────────── */

export function field({ name, label, type = "text", value = "", hint, placeholder, autocomplete, suffix, prefixIcon, inputmode, attrs = "", cls = "" }) {
  const id = `f-${name}`;
  const isPw = type === "password";
  return html`<div class="field ${cls}">
    ${label ? html`<label class="label" for="${id}">${label}</label>` : ""}
    <div class="input-wrap">
      ${prefixIcon ? html`<span class="input-prefix">${icon(prefixIcon, "h-4 w-4")}</span>` : ""}
      <input id="${id}" name="${name}" type="${type}" class="input ${isPw || suffix ? "pr-12" : ""}" value="${value}" ${placeholder ? html`placeholder="${placeholder}"` : ""} ${autocomplete ? html`autocomplete="${autocomplete}"` : ""} ${inputmode ? html`inputmode="${inputmode}"` : ""} ${attrs} />
      ${isPw ? html`<button type="button" class="toggle-pw" data-toggle-pw aria-label="Show password">${icon("eye", "h-4 w-4")}</button>` : suffix ? html`<span class="input-suffix">${suffix}</span>` : ""}
    </div>
    <p class="field-error" data-error-for="${name}" hidden></p>
    ${hint ? html`<p class="hint">${hint}</p>` : ""}
  </div>`;
}

export function selectField({ name, label, options, value = "", hint, cls = "" }) {
  const id = `f-${name}`;
  return html`<div class="field ${cls}">
    ${label ? html`<label class="label" for="${id}">${label}</label>` : ""}
    <select id="${id}" name="${name}" class="select">${options.map(([v, l]) => html`<option value="${v}" ${String(v) === String(value) ? html`selected` : ""}>${l}</option>`)}</select>
    <p class="field-error" data-error-for="${name}" hidden></p>
    ${hint ? html`<p class="hint">${hint}</p>` : ""}
  </div>`;
}

export function textareaField({ name, label, value = "", rows = 5, placeholder, hint, cls = "" }) {
  const id = `f-${name}`;
  return html`<div class="field ${cls}">
    ${label ? html`<label class="label" for="${id}">${label}</label>` : ""}
    <textarea id="${id}" name="${name}" rows="${rows}" class="textarea" ${placeholder ? html`placeholder="${placeholder}"` : ""}>${value}</textarea>
    <p class="field-error" data-error-for="${name}" hidden></p>
    ${hint ? html`<p class="hint">${hint}</p>` : ""}
  </div>`;
}

export function checkboxField({ name, label, checked = false }) {
  return html`<div><label class="flex cursor-pointer items-start gap-2.5 text-sm text-muted select-none"><input type="checkbox" class="checkbox" name="${name}" ${checked ? html`checked` : ""} /><span class="leading-snug">${label}</span></label><p class="field-error mt-1.5" data-error-for="${name}" hidden></p></div>`;
}

// Show/hide password toggles anywhere on the page.
document.addEventListener("click", (e) => {
  const btn = e.target.closest?.("[data-toggle-pw]");
  if (!btn) return;
  const input = btn.parentElement.querySelector("input");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  btn.innerHTML = String(icon(show ? "eye-off" : "eye", "h-4 w-4"));
});
