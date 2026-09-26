import { html, $, mount } from "../core/dom.js";
import { api } from "../core/api.js";
import { icon } from "../core/icons.js";
import { initSite, getSiteConfig } from "../core/site.js";
import { bindForm, rules } from "../core/forms.js";

initSite();

getSiteConfig().then((cfg) => {
  if (!cfg) return;
  $("[data-support-email]").textContent = cfg.support.email;
  $("[data-support-mailto]").href = `mailto:${cfg.support.email}`;
  if (cfg.support.hours) {
    const h = $("[data-support-hours]");
    h.textContent = `Support hours: ${cfg.support.hours}`;
    h.hidden = false;
  }
});

const form = $("#contact-form");
bindForm(
  form,
  {
    name: [rules.required("Name"), rules.min(2, "Name is too short")],
    email: [rules.required("Email"), rules.email()],
    message: [rules.required("Message"), rules.min(10, "Please write at least 10 characters")],
  },
  async (values) => {
    await api("/api/contact", { body: values });
    mount(
      form,
      html`<div class="flex flex-col items-center rounded-xl border border-up/25 bg-up-soft p-8 text-center">${icon("check-circle-2", "h-8 w-8 text-up")}<p class="mt-3 font-semibold text-white">Message received</p><p class="mt-1 text-sm text-muted">Thanks for reaching out. We'll reply to ${values.email}.</p></div>`,
    );
  },
);
