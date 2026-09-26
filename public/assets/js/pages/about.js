import { html, $, mount } from "../core/dom.js";
import { initSite, getSiteConfig } from "../core/site.js";

initSite();

// Company details are shown only when an administrator has marked them verified.
getSiteConfig().then((cfg) => {
  const c = cfg?.company;
  if (!c) return;
  mount(
    $("#company-info"),
    html`<dl class="mt-4 space-y-3 text-sm">
      <div><dt class="text-dim">Legal entity</dt><dd class="text-white">${c.legalName}</dd></div>
      ${c.registrationNumber ? html`<div><dt class="text-dim">Registration number</dt><dd class="text-white">${c.registrationNumber}</dd></div>` : ""}
      ${c.registeredAddress ? html`<div><dt class="text-dim">Registered address</dt><dd class="text-white">${c.registeredAddress}</dd></div>` : ""}
      ${c.licenses.map((l) => html`<div><dt class="text-dim">${l.name}</dt><dd class="text-white">${l.authority} · ${l.number}</dd></div>`)}
    </dl>`,
  );
});
