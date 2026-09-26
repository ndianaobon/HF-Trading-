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
  await withBusy(button, async () => {
    try {
      await api("/api/auth/resend-verification", { method: "POST" });
      mount(messageEl, notice("up", { body: "A new verification email is on its way.", iconName: "check-circle-2", cls: "mt-4" }));
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

  mount(
    root,
    html`<div class="grid h-12 w-12 place-items-center rounded-2xl border border-accent/25 bg-accent-soft text-accent">${icon("mail-check", "h-6 w-6")}</div>
    <h1 class="mt-6 font-display text-3xl font-extrabold tracking-tight text-white">Verify your email</h1>
    ${param("registered") ? notice("up", { title: "Account created", body: "Your account is not verified yet.", iconName: "check-circle-2", cls: "mt-4" }) : ""}
    <p class="mt-4 text-muted">${user ? html`We sent a verification link to <strong class="text-white">${user.email}</strong>. Open it to confirm your address. The link expires in 24 hours.` : "Open the verification link we emailed you to confirm your address."}</p>
    <div class="mt-6 rounded-xl border border-line bg-panel p-4 text-sm">
      <p class="font-semibold text-white">Verification status</p>
      <p class="mt-1 flex items-center gap-2 text-warn"><span class="h-2 w-2 rounded-full bg-warn"></span> Email not verified</p>
      <p class="mt-2 text-muted">Until verified you can browse your dashboard, but deposits, trading and withdrawals are disabled.</p>
    </div>
    <div data-msg></div>
    <div class="mt-6 flex flex-col gap-3 sm:flex-row">
      ${user ? html`<button type="button" class="btn btn-secondary flex-1" data-resend>Resend email</button>` : ""}
      <a href="${user ? "/dashboard" : "/login"}" class="btn btn-primary flex-1">${user ? "Continue to dashboard" : "Log in"}</a>
    </div>
    <p class="mt-6 text-xs text-dim">Wrong email? <a href="/register" class="text-muted hover:underline">Create a new account</a> or contact support.</p>
    <div data-mailbox></div>`,
  );
  on(root, "click", "[data-resend]", async (_e, b) => {
    await resend(b, $("[data-msg]", root));
    void renderDevMailbox($("[data-mailbox]", root), user.email);
  });
  if (user) void renderDevMailbox($("[data-mailbox]", root), user.email);
}

void init();
