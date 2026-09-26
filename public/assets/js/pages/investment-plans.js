import { html, $, mount } from "../core/dom.js";
import { api } from "../core/api.js";
import { initSite, getOptionalUser } from "../core/site.js";
import { errorState } from "../core/ui.js";
import { planCard } from "../components/plan-card.js";

initSite();

Promise.all([api("/api/investments/plans", { allowAnonymous: true }), getOptionalUser()])
  .then(([plans, user]) => {
    mount(
      $("#plans"),
      plans.map((p) => {
        const target = `/dashboard/investments?plan=${p.slug}`;
        return planCard(p, html`<a href="${user ? target : `/register?next=${encodeURIComponent(target)}`}" class="btn btn-primary w-full">${user ? "View plan & subscribe" : "Open an Account"}</a>`);
      }),
    );
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  })
  .catch((err) => mount($("#plans"), errorState({ message: err.message, retry: false })));
