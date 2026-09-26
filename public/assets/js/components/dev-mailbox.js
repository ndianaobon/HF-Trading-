// Development helper: shows emails captured by the "console" email provider so
// verification and reset links can be followed locally. The API returns 404 in
// production (or when a real email provider is configured), so nothing renders.
import { html, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { formatDate } from "../core/format.js";

export async function renderDevMailbox(el, email) {
  if (!el || !email) return;
  try {
    const res = await fetch(`/api/dev/outbox?email=${encodeURIComponent(email)}`);
    if (!res.ok) return;
    const items = (await res.json()).data ?? [];
    if (!items.length) return;
    mount(
      el,
      html`<div class="mt-6 rounded-xl border border-dashed border-warn/40 bg-warn-soft p-4 text-left">
        <p class="flex items-center gap-2 text-xs font-bold tracking-wide text-warn uppercase">${icon("flask-conical", "h-3.5 w-3.5")} Development mailbox</p>
        <p class="mt-1 text-xs text-muted">No email provider is configured, so messages are captured locally. This panel is not shown in production.</p>
        <ul class="mt-3 space-y-2">${items.slice(0, 2).map(
          (m) => html`<li class="rounded-lg border border-line bg-panel p-3 text-xs"><p class="font-semibold text-white">${m.subject}</p><p class="text-dim">${formatDate(m.createdAt)}</p>${m.links.map((l) => html`<a href="${l}" class="mt-1 block truncate text-accent hover:underline">${l}</a>`)}</li>`,
        )}</ul>
      </div>`,
    );
  } catch {
    /* development helper only */
  }
}
