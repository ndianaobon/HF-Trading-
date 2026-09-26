import { html, $, mount } from "../core/dom.js";
import { api } from "../core/api.js";
import { icon } from "../core/icons.js";
import { initSite } from "../core/site.js";
import { bindForm, rules } from "../core/forms.js";
import { renderDevMailbox } from "../components/dev-mailbox.js";

initSite();

bindForm($("#forgot-form"), { email: [rules.required("Email"), rules.email()] }, async (v) => {
  await api("/api/auth/forgot-password", { body: { email: v.email } });
  const root = $("#forgot-root");
  mount(
    root,
    html`<div class="grid h-12 w-12 place-items-center rounded-2xl border border-up/25 bg-up-soft text-up">${icon("mail-check", "h-6 w-6")}</div>
    <h1 class="mt-6 font-display text-3xl font-extrabold text-white">Check your inbox</h1>
    <p class="mt-3 text-muted">If an account exists for <strong class="text-white">${v.email}</strong>, we've sent a link to reset your password. It expires in 30 minutes.</p>
    <a href="/login" class="mt-8 inline-flex text-sm font-semibold text-accent hover:text-accent-strong">← Back to login</a>
    <div data-mailbox></div>`,
  );
  void renderDevMailbox($("[data-mailbox]", root), v.email);
});
