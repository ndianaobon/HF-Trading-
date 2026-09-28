import { $, param, safeNext, mount } from "../core/dom.js";
import { api, ApiError } from "../core/api.js";
import { initSite } from "../core/site.js";
import { notice } from "../core/ui.js";
import { bindForm, rules } from "../core/forms.js";

initSite();

const next = param("next")?.startsWith("/admin") ? safeNext(param("next"), "/admin") : "/admin";
const note = $("#login-notice");
const show = (tone, body) => {
  mount(note, notice(tone, { body }));
  note.hidden = false;
};
if (param("expired")) show("warn", "Your session has expired. Please sign in again.");
if (param("denied")) show("down", "That account doesn't have access to the admin console.");

bindForm($("#admin-login-form"), { email: [rules.required("Email"), rules.email()], password: [rules.required("Password")] }, async (v) => {
  const res = await api("/api/auth/login", { body: { email: v.email, password: v.password, remember: false } });
  if (res.mfaRequired) {
    location.href = `/login/verify?next=${encodeURIComponent(next)}`;
    return;
  }
  const me = await api("/api/auth/me");
  if (!me.admin) {
    // Customer account: don't leave it signed in on the staff page.
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    throw new ApiError("FORBIDDEN", "This account doesn't have access to the admin console.", 403);
  }
  location.href = next;
});
