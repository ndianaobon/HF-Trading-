import { html, $, on, mount, param } from "../core/dom.js";
import { api, ApiError } from "../core/api.js";
import { icon } from "../core/icons.js";
import { initSite, getOptionalUser } from "../core/site.js";
import { notice, withBusy } from "../core/ui.js";
import { renderDevMailbox } from "../components/dev-mailbox.js";

initSite();
const root = $("#verify-root");
const token = param("token");

const done = (signedIn) =>
  mount(
    root,
    html`<div class="text-center">${icon("check-circle-2", "mx-auto h-12 w-12 text-up")}<h1 class="mt-5 font-display text-3xl font-extrabold text-white">Email verified</h1><p class="mt-2 text-muted">Your email address is confirmed. You can now fund your account and start trading.</p><a href="${signedIn ? "/dashboard" : "/login"}" class="btn btn-primary btn-lg mt-8 w-full">${signedIn ? "Go to dashboard" : "Log in"}</a></div>`,
  );

async function resend(button, messageEl) {
  return withBusy(button, async () => {
    try {
      await api("/api/auth/resend-verification", { method: "POST" });
      mount(messageEl, notice("up", { body: "A new code is on its way. Only the latest code works.", iconName: "check-circle-2", cls: "mt-3" }));
      return true;
    } catch (err) {
      mount(messageEl, notice("down", { body: err instanceof ApiError ? err.message : "Could not resend the email.", cls: "mt-4" }));
      return false;
    }
  });
}

async function init() {
  const user = await getOptionalUser();
  if (token) {
    mount(root, html`<div class="text-center"><span class="spinner mx-auto block h-10 w-10 text-accent" style="border-width:3px"></span><p class="mt-4 text-muted">Verifying your email…</p></div>`);
    try {
      await api("/api/auth/verify-email", { body: { token } });
      done(!!user);
    } catch (err) {
      mount(
        root,
        html`<div class="text-center">${icon("x-circle", "mx-auto h-12 w-12 text-down")}<h1 class="mt-5 font-display text-3xl font-extrabold text-white">Link not valid</h1><p class="mt-2 text-muted">${err.message}</p>
          ${user ? html`<button type="button" class="btn btn-primary btn-lg mt-8 w-full" data-resend>Send a new link</button><div data-msg></div>` : html`<a href="/login" class="btn btn-primary btn-lg mt-8 w-full">Log in to request a new link</a>`}</div>`,
      );
    }
    on(root, "click", "[data-resend]", (_e, b) => resend(b, $("[data-msg]", root)));
    return;
  }
  if (user?.emailVerified) return done(true);
  if (!user) {
    mount(
      root,
      html`<div class="grid h-12 w-12 place-items-center rounded-2xl border border-accent/25 bg-accent-soft text-accent">${icon("mail-check", "h-6 w-6")}</div>
      <h1 class="mt-6 font-display text-3xl font-extrabold tracking-tight text-white">Verify your email</h1>
      <p class="mt-4 text-muted">Log in to enter the 6-digit code we emailed you.</p>
      <a href="/login?next=%2Fverify-email" class="btn btn-primary btn-lg mt-8 w-full">Log in</a>`,
    );
    return;
  }

  mount(
    root,
    html`<div class="grid h-12 w-12 place-items-center rounded-2xl border border-accent/25 bg-accent-soft text-accent">${icon("mail-check", "h-6 w-6")}</div>
    <h1 class="mt-6 font-display text-3xl font-extrabold tracking-tight text-white">Verify your email</h1>
    ${param("registered") ? notice("up", { title: "Account created", body: "One last step: confirm your email address.", iconName: "check-circle-2", cls: "mt-4" }) : ""}
    <p class="mt-4 text-muted">Enter the 6-digit code we sent to <strong class="text-white">${user.email}</strong>. It expires in 15 minutes.</p>
    <form class="mt-6" data-code-form novalidate>
      <label class="label" for="code">Verification code</label>
      <input id="code" name="code" class="input h-14 text-center font-mono text-2xl font-bold tracking-[0.5em]" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" aria-describedby="code-help" />
      <p id="code-help" class="hint">Check your spam folder if it hasn't arrived within a minute.</p>
      <div data-msg></div>
      <button type="submit" class="btn btn-primary btn-lg mt-5 w-full" data-submit>Verify email</button>
    </form>
    <div class="mt-4 flex items-center justify-between text-sm">
      <button type="button" class="font-semibold text-accent hover:text-accent-strong disabled:text-dim" data-resend>Resend code</button>
      <a href="/dashboard" class="text-muted hover:text-white">Skip for now</a>
    </div>
    <p class="mt-6 text-xs text-dim">Until verified you can browse your dashboard, but deposits, trading and withdrawals are disabled. Wrong email? <a href="/register" class="text-muted hover:underline">Create a new account</a> or contact support.</p>
    <div data-mailbox></div>`,
  );
  const form = $("[data-code-form]", root);
  const input = form.code;
  const msg = $("[data-msg]", root);
  input.focus();
  input.addEventListener("input", () => {
    input.value = input.value.replace(/[^0-9]/g, "").slice(0, 6);
    if (input.value.length === 6) form.requestSubmit();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (!/^[0-9]{6}$/.test(code)) {
      mount(msg, notice("down", { body: "Enter the 6-digit code from the email.", cls: "mt-3" }));
      return;
    }
    await withBusy($("[data-submit]", root), async () => {
      try {
        await api("/api/auth/verify-email", { body: { code } });
        done(true);
      } catch (err) {
        mount(msg, notice("down", { body: err instanceof ApiError ? err.message : "Verification failed. Please try again.", cls: "mt-3" }));
        input.select();
      }
    });
  });

  let cooldown = null;
  on(root, "click", "[data-resend]", async (_e, b) => {
    if (cooldown) return;
    const ok = await resend(b, msg);
    void renderDevMailbox($("[data-mailbox]", root), user.email);
    if (!ok) return;
    let left = 60;
    b.disabled = true;
    cooldown = setInterval(() => {
      left -= 1;
      b.textContent = left > 0 ? `Resend code (${left}s)` : "Resend code";
      if (left <= 0) {
        clearInterval(cooldown);
        cooldown = null;
        b.disabled = false;
      }
    }, 1000);
  });
  void renderDevMailbox($("[data-mailbox]", root), user.email);
}

void init();
