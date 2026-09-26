// Minimal DOM + templating helpers. `html` escapes every interpolated value
// unless it was produced by `html`/`raw`, so user data can never inject markup.

import "./theme.js"; // light/dark toggle (every page imports this module)

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => (v === null || v === undefined ? "" : String(v).replace(/[&<>"']/g, (c) => ESC[c]));

export class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

/** Marks trusted markup (never pass user input here). */
export const raw = (s) => new Raw(s ?? "");

function renderValue(v) {
  if (v === null || v === undefined || v === false || v === true) return "";
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join("");
  return esc(v);
}

/** Tagged template producing escaped, trusted markup. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function mount(el, content) {
  if (el) el.innerHTML = renderValue(content);
  return el;
}

/** Delegated event listener. */
export function on(root, event, selector, handler, opts) {
  root.addEventListener(
    event,
    (e) => {
      const target = e.target.closest?.(selector);
      if (target && root.contains(target)) handler(e, target);
    },
    opts,
  );
}

export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

/** Reads a query-string parameter. */
export const param = (name) => new URLSearchParams(location.search).get(name);

/** Only same-site relative paths (prevents open redirects). */
export function safeNext(next, fallback = "/dashboard") {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
