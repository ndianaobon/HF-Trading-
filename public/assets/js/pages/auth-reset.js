import { html, $, mount, param } from "../core/dom.js";
import { api } from "../core/api.js";
import { initSite } from "../core/site.js";
import { bindForm, rules } from "../core/forms.js";

initSite();

const token = param("token");
if (!token) {
  mount(
    $("#reset-root"),
    html`<h1 class="font-display text-3xl font-extrabold text-white">Invalid reset link</h1><p class="mt-2 text-muted">This link is missing its token. Request a new one.</p><a href="/forgot-password" class="mt-6 inline-flex font-semibold text-accent">Request a new link →</a>`,
  );
} else {
  bindForm($("#reset-form"), { password: [rules.password()], confirmPassword: [rules.matches("password", "Passwords do not match")] }, async (v) => {
    await api("/api/auth/reset-password", { body: { token, password: v.password, confirmPassword: v.confirmPassword } });
    location.href = "/login?reset=1";
  });
}
