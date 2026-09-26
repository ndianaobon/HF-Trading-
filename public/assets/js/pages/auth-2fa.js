import { $, param, safeNext } from "../core/dom.js";
import { api } from "../core/api.js";
import { initSite } from "../core/site.js";
import { bindForm } from "../core/forms.js";

initSite();

const next = safeNext(param("next"));
const input = $("#code");
let backup = false;

$("#toggle-backup").addEventListener("click", (e) => {
  backup = !backup;
  input.value = "";
  input.maxLength = backup ? 12 : 6;
  input.inputMode = backup ? "text" : "numeric";
  $("[data-code-label]").textContent = backup ? "Backup code" : "Authentication code";
  $("[data-hint]").textContent = backup ? "Enter one of your 10-character backup codes. Each code can be used once." : "Enter the 6-digit code from your authenticator app.";
  e.currentTarget.textContent = backup ? "Use authenticator code" : "Use a backup code";
  input.focus();
});
input.addEventListener("input", () => {
  if (!backup) input.value = input.value.replace(/\D/g, "");
});

bindForm($("#mfa-form"), { code: [(v) => (backup ? (/^[a-z0-9-]{10,12}$/i.test(v.trim()) ? null : "Enter a valid backup code") : /^\d{6}$/.test(v) ? null : "Enter the 6-digit code")] }, async (v) => {
  const res = await api("/api/auth/2fa/challenge", { body: { code: v.code } });
  location.href = res.emailVerified === false ? "/verify-email" : next;
});
