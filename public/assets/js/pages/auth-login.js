import { $, param, safeNext, mount } from "../core/dom.js";
import { api } from "../core/api.js";
import { initSite } from "../core/site.js";
import { notice } from "../core/ui.js";
import { bindForm, rules } from "../core/forms.js";

initSite();

const next = safeNext(param("next"));
const note = $("#login-notice");
if (param("expired")) {
  mount(note, notice("warn", { body: "Your session has expired. Please log in again." }));
  note.hidden = false;
} else if (param("reset")) {
  mount(note, notice("up", { title: "Password updated", body: "Log in with your new password.", iconName: "check-circle-2" }));
  note.hidden = false;
}

bindForm($("#login-form"), { email: [rules.required("Email"), rules.email()], password: [rules.required("Password")] }, async (v) => {
  const res = await api("/api/auth/login", { body: { email: v.email, password: v.password, remember: v.remember } });
  if (res.mfaRequired) location.href = `/login/verify?next=${encodeURIComponent(next)}`;
  else if (!res.emailVerified) location.href = "/verify-email";
  else location.href = next;
});
