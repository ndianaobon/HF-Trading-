import { html, $, $$, param } from "../core/dom.js";
import { api } from "../core/api.js";
import { initSite } from "../core/site.js";
import { bindForm, rules } from "../core/forms.js";
import { COUNTRIES } from "../core/countries.js";

initSite();

$("#country").insertAdjacentHTML("beforeend", String(html`${COUNTRIES.map(([c, n]) => html`<option value="${c}">${n}</option>`)}`));
if (param("ref")) $("#referralCode").value = param("ref");

// Password strength meter
const LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong"];
const COLORS = ["bg-down", "bg-down", "bg-warn", "bg-info", "bg-up"];
$("#password").addEventListener("input", (e) => {
  const pw = e.target.value;
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  s = Math.min(4, Math.max(0, s - 1));
  $("[data-strength]").hidden = !pw;
  $$("[data-strength] span.h-1").forEach((bar, i) => (bar.className = `h-1 flex-1 rounded-full ${i < s ? COLORS[s] : "bg-panel-3"}`));
  $("[data-strength-label]").textContent = LABELS[s];
});

bindForm(
  $("#register-form"),
  {
    firstName: [rules.required("First name"), rules.max(60), rules.name("First name")],
    lastName: [rules.required("Last name"), rules.max(60), rules.name("Last name")],
    email: [rules.required("Email"), rules.email()],
    phone: [rules.optional(rules.pattern(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number"))],
    country: [(v) => (v ? null : "Select your country")],
    password: [rules.password()],
    confirmPassword: [rules.matches("password", "Passwords do not match")],
    referralCode: [rules.optional(rules.pattern(/^[A-Za-z0-9]{4,16}$/, "Invalid referral code"))],
    acceptTerms: [rules.checked("You must accept the Terms of Service and Risk Disclosure")],
  },
  async (v) => {
    await api("/api/auth/register", { body: { ...v, referralCode: v.referralCode.trim().toUpperCase() } });
    location.href = "/verify-email?registered=1";
  },
);
