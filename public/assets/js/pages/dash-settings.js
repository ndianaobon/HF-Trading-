import { html, raw, $, $$, on, mount, cx, param } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api, ApiError } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { subscribeMarkets } from "../core/tickers.js";
import { card, badge, notice, errorState, emptyState, skeleton, pageHeader, statusBadge, copyButton, toast, openModal, confirmDialog, withBusy } from "../core/ui.js";
import { field, selectField, checkboxField, bindForm, rules, setFormError } from "../core/forms.js";
import { COUNTRIES } from "../core/countries.js";
import { formatDate, timeAgo } from "../core/format.js";
import { stepUpFields, stepUpRule } from "../components/wallet-bits.js";

const user = await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

const TABS = [
  { id: "profile", label: "Personal information", icon: "user" },
  { id: "security", label: "Security", icon: "shield-check" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "preferences", label: "Preferences", icon: "sliders-horizontal" },
  { id: "sessions", label: "Sessions", icon: "monitor-smartphone" },
  { id: "api", label: "API keys", icon: "key-round" },
];
let tab = TABS.find((t) => t.id === param("tab"))?.id ?? "profile";

mount(
  view,
  html`${pageHeader({ title: "Settings", description: "Manage your profile, security and preferences." })}
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-[230px_1fr]">
      <nav class="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0" aria-label="Settings sections" data-tabs></nav>
      <div class="min-w-0" data-panel></div>
    </div>`,
);
const panel = $("[data-panel]", view);

function drawTabs() {
  mount(
    $("[data-tabs]", view),
    TABS.map(
      (t) =>
        html`<button type="button" data-tab="${t.id}" class="${cx("flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors", tab === t.id ? "bg-panel-3 text-white" : "text-muted hover:bg-panel-2 hover:text-white")}" ${tab === t.id ? raw('aria-current="page"') : ""}>${icon(t.icon, cx("h-4 w-4", tab === t.id ? "text-accent" : "text-dim"))} ${t.label}</button>`,
    ),
  );
}

// Each section returns a cleanup function (unsubscribes its data watchers).
let cleanup = null;
function show(id) {
  tab = id;
  history.replaceState(null, "", `/dashboard/settings?tab=${id}`);
  drawTabs();
  cleanup?.();
  mount(panel, skeleton("h-96 w-full rounded-2xl"));
  cleanup = SECTIONS[id]() ?? null;
}
on(view, "click", "[data-tab]", (_e, b) => show(b.dataset.tab));

const switchEl = (name, checked, { label, disabled } = {}) =>
  html`<button type="button" role="switch" class="switch" data-switch="${name}" aria-label="${label}" aria-checked="${checked ? "true" : "false"}" ${disabled ? html`disabled` : ""}></button>`;
on(view, "click", "[data-switch]", (_e, b) => b.setAttribute("aria-checked", b.getAttribute("aria-checked") === "true" ? "false" : "true"));
const switchValue = (name) => $(`[data-switch="${name}"]`, panel)?.getAttribute("aria-checked") === "true";

const savePrefs = async (preferences) => {
  await api("/api/users/me", { method: "PATCH", body: { preferences } });
  invalidate("/api/users/me");
};

/* ───────────── Profile ───────────── */

function profileSection() {
  let drawn = false;
  return watch("/api/users/me", ({ data, error }) => {
    if (!data) return error && mount(panel, errorState({ message: error.message }));
    if (drawn) return;
    drawn = true;
    const p = data.profile ?? {};
    mount(
      panel,
      card({
        title: "Personal information",
        description: "Keep your details up to date. Changes to your legal name may require re-verification.",
        body: html`<div class="card-body"><form id="profile-form" class="space-y-4" novalidate>
          <div class="field"><label class="label" for="p-email">Email</label><div class="flex items-center gap-3"><input id="p-email" class="input flex-1" value="${data.email}" disabled />${statusBadge(data.emailVerified ? "ACTIVE" : "PENDING_VERIFICATION", data.emailVerified ? "Verified" : "Unverified")}</div><p class="hint">Contact support to change your email address.</p></div>
          <div class="grid gap-4 sm:grid-cols-2">
            ${field({ name: "firstName", label: "First name", value: p.firstName ?? "", autocomplete: "given-name" })}
            ${field({ name: "lastName", label: "Last name", value: p.lastName ?? "", autocomplete: "family-name" })}
            ${field({ name: "phone", label: "Phone", type: "tel", value: p.phone ?? "", autocomplete: "tel" })}
            ${selectField({ name: "country", label: "Country", options: COUNTRIES, value: p.country ?? "" })}
          </div>
          ${field({ name: "addressLine", label: "Address", value: p.addressLine ?? "", autocomplete: "street-address" })}
          <div class="grid gap-4 sm:grid-cols-3">
            ${field({ name: "city", label: "City", value: p.city ?? "" })}
            ${field({ name: "postalCode", label: "Postal code", value: p.postalCode ?? "" })}
            ${field({ name: "timezone", label: "Time zone", value: p.timezone ?? "", placeholder: "Europe/London" })}
          </div>
          <div data-form-error hidden></div>
          <button type="submit" class="btn btn-primary">Save changes</button>
        </form></div>`,
      }),
    );
    bindForm(
      $("#profile-form", panel),
      {
        firstName: [rules.required("First name"), rules.name("First name")],
        lastName: [rules.required("Last name"), rules.name("Last name")],
        phone: [rules.optional(rules.pattern(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number"))],
      },
      async (v) => {
        await api("/api/users/me", { method: "PATCH", body: { profile: v } });
        toast.success("Profile updated");
        invalidate("/api/users/me");
      },
    );
  });
}

/* ───────────── Security ───────────── */

function securitySection() {
  let setup = null;
  const unsub = watch("/api/users/me/security", ({ data, error }) => {
    if (!data) return error && mount(panel, errorState({ message: error.message }));
    const tfa = data.twoFactor;
    const tile = (iconName, label, value, sub, tone = "text-white") =>
      html`<div class="rounded-2xl border border-line bg-panel p-4"><p class="flex items-center gap-2 text-xs font-semibold text-dim uppercase">${icon(iconName, "h-3.5 w-3.5")} ${label}</p><p class="mt-2 font-display text-lg font-bold ${tone}">${value}</p><p class="truncate text-xs text-muted">${sub}</p></div>`;
    const pwFocused = document.activeElement?.closest?.("#pw-form");
    if (pwFocused) return; // don't wipe a password form mid-typing on background refresh
    mount(
      panel,
      html`<div class="space-y-6">
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          ${tile("clock", "Last login", data.lastLogin ? timeAgo(data.lastLogin.at) : "—", data.lastLogin ? `${data.lastLogin.device} · ${data.lastLogin.ip ?? ""}` : "")}
          ${tile(tfa.enabled ? "shield-check" : "shield-alert", "2FA status", tfa.enabled ? "Enabled" : "Disabled", tfa.enabled ? `${tfa.backupCodesRemaining} backup codes left` : "Recommended", tfa.enabled ? "text-up" : "text-warn")}
          ${tile("key-round", "Password last changed", timeAgo(data.passwordChangedAt), formatDate(data.passwordChangedAt, "date"))}
          ${tile("shield-check", "Active sessions", String(data.sessions.length), `${data.activeApiKeys} API key${data.activeApiKeys === 1 ? "" : "s"}`)}
        </div>
        ${card({ title: "Two-factor authentication (2FA)", description: "Require a code from an authenticator app when signing in and confirming withdrawals.", body: html`<div class="card-body" data-tfa></div>` })}
        ${card({
          title: "Change password",
          description: "Other sessions are signed out when your password changes.",
          body: html`<div class="card-body"><form id="pw-form" class="grid max-w-xl gap-4" novalidate>
            ${field({ name: "currentPassword", label: "Current password", type: "password", autocomplete: "current-password" })}
            ${field({ name: "newPassword", label: "New password", type: "password", autocomplete: "new-password", hint: "At least 10 characters with upper and lower case, a number and a symbol." })}
            ${field({ name: "confirmPassword", label: "Confirm new password", type: "password", autocomplete: "new-password" })}
            <div data-form-error hidden></div>
            <div><button type="submit" class="btn btn-primary">Update password</button></div>
          </form></div>`,
        })}
        ${card({
          title: "Recent sign-in activity",
          body: html`<div class="overflow-x-auto border-t border-line"><table class="w-full min-w-[520px] text-sm"><tbody>${
            data.loginHistory.length
              ? data.loginHistory.map(
                  (l) =>
                    html`<tr class="border-b border-line/60 last:border-0"><td class="px-5 py-3 text-muted">${formatDate(l.at)}</td><td class="px-3 py-3 text-fg">${l.device}</td><td class="px-3 py-3 font-mono text-xs text-muted">${l.ip ?? ""}</td><td class="px-5 py-3 text-right">${statusBadge(l.success ? "COMPLETED" : "FAILED", l.success ? "Success" : "Failed")}</td></tr>`,
                )
              : html`<tr><td class="px-5 py-6 text-center text-dim">No sign-in activity recorded yet.</td></tr>`
          }</tbody></table></div>`,
        })}
      </div>`,
    );
    drawTfa(tfa);
    bindForm(
      $("#pw-form", panel),
      {
        currentPassword: [rules.required("Current password")],
        newPassword: [rules.password(), (v, all) => (v === all.currentPassword ? "Choose a different password" : null)],
        confirmPassword: [rules.matches("newPassword", "Passwords do not match")],
      },
      async (v, form) => {
        await api("/api/users/me/password", { body: v });
        toast.success("Password changed", "Other sessions have been signed out.");
        form.reset();
        document.activeElement?.blur();
        invalidate("/api/users/me/security");
      },
    );
  });

  function drawTfa(tfa) {
    const el = $("[data-tfa]", panel);
    if (tfa.enabled) {
      mount(el, html`<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><p class="text-sm text-muted">Enabled ${tfa.enabledAt ? `on ${formatDate(tfa.enabledAt, "date")}` : ""}. Keep your backup codes somewhere safe.</p><button type="button" class="btn btn-danger" data-tfa-disable>Disable 2FA</button></div>`);
    } else if (setup) {
      mount(
        el,
        html`<div class="grid grid-cols-1 gap-6 md:grid-cols-[auto_1fr]">
          <img src="${setup.qrDataUrl}" alt="Scan this QR code with your authenticator app" class="h-44 w-44 rounded-xl bg-white p-2" />
          <form class="space-y-4" data-tfa-enable novalidate>
            <ol class="list-decimal space-y-1 pl-5 text-sm text-muted"><li>Scan the QR code with an authenticator app (e.g. 1Password, Google Authenticator, Authy).</li><li>Or enter this key manually:</li></ol>
            <div class="flex items-center gap-2"><code class="rounded-md bg-panel-3 px-2 py-1 font-mono text-sm break-all text-white">${setup.secret}</code>${copyButton(setup.secret, "Copy key", true)}</div>
            ${field({ name: "code", label: "Enter the 6-digit code to confirm", inputmode: "numeric", autocomplete: "one-time-code", attrs: html`maxlength="6"`, cls: "max-w-48" })}
            <div data-form-error hidden></div>
            <div class="flex gap-2"><button type="submit" class="btn btn-primary">Enable 2FA</button><button type="button" class="btn btn-ghost" data-tfa-cancel>Cancel</button></div>
          </form>
        </div>`,
      );
      const form = $("[data-tfa-enable]", el);
      bindForm(form, { code: [rules.pattern(/^\d{6}$/, "Enter the 6-digit code"), rules.required("Code")] }, async (v) => {
        const res = await api("/api/auth/2fa/enable", { body: { code: v.code.trim() } });
        setup = null;
        showBackupCodes(res.backupCodes);
        invalidate("/api/users/me");
      });
    } else {
      mount(el, html`<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">${notice("warn", { cls: "flex-1", body: "2FA is not enabled. Accounts without 2FA are more vulnerable to takeover." })}<button type="button" class="btn btn-primary" data-tfa-start>Enable 2FA</button></div>`);
    }
  }

  const onClick = async (e) => {
    const t = e.target.closest?.("[data-tfa-start],[data-tfa-cancel],[data-tfa-disable]");
    if (!t) return;
    if (t.matches("[data-tfa-start]")) {
      try {
        setup = await withBusy(t, () => api("/api/auth/2fa/setup", { method: "POST" }));
        drawTfa({ enabled: false });
      } catch (err) {
        toast.error("Could not start setup", err.message);
      }
    } else if (t.matches("[data-tfa-cancel]")) {
      setup = null;
      drawTfa({ enabled: false });
    } else disable2fa();
  };
  panel.addEventListener("click", onClick);
  return () => {
    unsub();
    panel.removeEventListener("click", onClick);
  };
}

function showBackupCodes(codes) {
  const m = openModal({
    title: "Save your backup codes",
    description: "Each code works once if you lose access to your authenticator. They won't be shown again.",
    body: html`<div class="grid grid-cols-2 gap-2">${codes.map((c) => html`<code class="rounded-md bg-panel-3 px-3 py-2 text-center font-mono text-sm text-white">${c}</code>`)}</div><div class="mt-4">${copyButton(codes.join("\n"), "Copy all")}</div>`,
    footer: html`<button type="button" class="btn btn-secondary" data-download>${icon("download", "h-4 w-4")} Download</button><button type="button" class="btn btn-primary" data-close>I've saved them</button>`,
    onClose: () => invalidate("/api/users/me/security"),
  });
  on(m.el, "click", "[data-download]", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`HarborFinance 2FA backup codes\nEach code can be used once.\n\n${codes.join("\n")}\n`], { type: "text/plain" }));
    a.download = "harborfinance-backup-codes.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

function disable2fa() {
  const m = openModal({
    title: "Disable two-factor authentication",
    body: html`<form id="tfa-off" novalidate>${field({ name: "code", label: "Authenticator or backup code", autocomplete: "one-time-code", attrs: html`maxlength="12"`, cls: "font-mono" })}<div class="mt-3" data-form-error hidden></div></form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="tfa-off" class="btn btn-danger">Disable 2FA</button>`,
  });
  bindForm($("#tfa-off", m.el), { code: [rules.required("Code")] }, async (v) => {
    await api("/api/auth/2fa/disable", { body: { code: v.code.trim() } });
    toast.success("Two-factor authentication disabled");
    m.close();
    ["/api/users/me/security", "/api/users/me"].forEach(invalidate);
  });
}

/* ───────────── Notifications ───────────── */

const CHANNELS = [
  { key: "trades", label: "Trade executions", body: "When your orders fill or partially fill." },
  { key: "deposits", label: "Deposits", body: "When deposits are received and credited." },
  { key: "withdrawals", label: "Withdrawals", body: "Status changes on your withdrawals." },
  { key: "investments", label: "Investments & copy trading", body: "Subscription and copy updates." },
  { key: "announcements", label: "Platform announcements", body: "Maintenance and product news." },
  { key: "security", label: "Security alerts", body: "New sign-ins and security changes. Always on." },
];

function notificationsSection() {
  let drawn = false;
  return watch("/api/users/me", ({ data, error }) => {
    if (!data) return error && mount(panel, errorState({ message: error.message }));
    if (drawn) return;
    drawn = true;
    const state = { trades: true, deposits: true, withdrawals: true, investments: true, announcements: true, ...data.profile?.preferences?.notifications, security: true };
    mount(
      panel,
      card({
        title: "Notifications",
        description: "Choose which in-app and email notifications you receive.",
        body: html`<div class="card-body divide-y divide-line/60">
          ${CHANNELS.map((c) => html`<div class="flex items-center justify-between gap-4 py-3"><div><p class="text-sm font-medium text-white">${c.label}</p><p class="text-xs text-dim">${c.body}</p></div>${switchEl(c.key, state[c.key], { label: c.label, disabled: c.key === "security" })}</div>`)}
          <div class="pt-4"><button type="button" class="btn btn-primary" data-save>Save preferences</button></div>
        </div>`,
      }),
    );
    on($("[data-save]", panel).parentElement, "click", "[data-save]", async (_e, b) => {
      const notifications = Object.fromEntries(CHANNELS.map((c) => [c.key, c.key === "security" ? true : switchValue(c.key)]));
      try {
        await withBusy(b, () => savePrefs({ notifications }));
        toast.success("Notification preferences saved");
      } catch (err) {
        toast.error("Could not save", err.message);
      }
    });
  });
}

/* ───────────── Preferences ───────────── */

function preferencesSection() {
  let drawn = false;
  let markets = [];
  let prefs = null;
  const draw = () => {
    if (drawn || !prefs || !markets.length) return;
    drawn = true;
    const s = { defaultMarket: "BTC-USDT", hideSmallBalances: false, confirmOrders: true, ...prefs };
    mount(
      panel,
      card({
        title: "Preferences",
        description: "Tailor the trading experience.",
        body: html`<div class="card-body space-y-5">
          ${selectField({ name: "defaultMarket", label: "Default market", hint: "Opened when you select Trade.", options: markets.map((m) => [m.symbol, m.symbol.replace("-", "/")]), value: s.defaultMarket, cls: "max-w-xs" })}
          <div class="flex items-center justify-between gap-4 border-t border-line pt-4"><div><p class="text-sm font-medium text-white">Confirm orders before execution</p><p class="text-xs text-dim">Show a review dialog before each order is placed.</p></div>${switchEl("confirmOrders", s.confirmOrders, { label: "Confirm orders" })}</div>
          <div class="flex items-center justify-between gap-4 border-t border-line pt-4"><div><p class="text-sm font-medium text-white">Hide small balances</p><p class="text-xs text-dim">Hide wallets worth less than 1 USDT in balance lists.</p></div>${switchEl("hideSmallBalances", s.hideSmallBalances, { label: "Hide small balances" })}</div>
          <button type="button" class="btn btn-primary" data-save>Save preferences</button>
        </div>`,
      }),
    );
    $("[data-save]", panel).addEventListener("click", async (e) => {
      try {
        await withBusy(e.currentTarget, () => savePrefs({ defaultMarket: $("[name=defaultMarket]", panel).value, confirmOrders: switchValue("confirmOrders"), hideSmallBalances: switchValue("hideSmallBalances") }));
        toast.success("Preferences saved");
      } catch (err) {
        toast.error("Could not save", err.message);
      }
    });
  };
  const u1 = watch("/api/users/me", ({ data, error }) => {
    if (!data) return error && mount(panel, errorState({ message: error.message }));
    prefs = data.profile?.preferences ?? {};
    draw();
  });
  const u2 = subscribeMarkets((st) => {
    markets = st.markets;
    draw();
  });
  return () => {
    u1();
    u2();
  };
}

/* ───────────── Sessions ───────────── */

function sessionsSection() {
  const unsub = watch("/api/users/me/security", ({ data, error }) => {
    if (!data) return error && mount(panel, errorState({ message: error.message }));
    mount(
      panel,
      card({
        title: "Active sessions",
        description: "Devices currently signed in to your account.",
        action: data.sessions.length > 1 ? html`<button type="button" class="btn btn-secondary btn-sm" data-end-all>Sign out all others</button>` : "",
        body: html`<ul class="border-t border-line">${data.sessions.map(
          (s) => html`<li class="flex flex-col gap-3 border-b border-line/60 px-5 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-3"><span class="grid h-10 w-10 place-items-center rounded-xl bg-panel-3 text-muted">${icon("monitor-smartphone", "h-5 w-5")}</span>
              <div><p class="flex items-center gap-2 text-sm font-semibold text-white">${s.device} ${s.current ? badge("This device", "up") : ""}</p><p class="text-xs text-dim">${s.ip ?? "Unknown IP"} · Active ${timeAgo(s.lastSeenAt)} · Signed in ${formatDate(s.createdAt, "date")}</p></div></div>
            <button type="button" class="btn ${s.current ? "btn-ghost" : "btn-secondary"} btn-sm" data-end="${s.id}">${icon("log-out", "h-4 w-4")} ${s.current ? "Sign out" : "End session"}</button>
          </li>`,
        )}</ul>`,
      }),
    );
  });
  const onClick = async (e) => {
    const end = e.target.closest?.("[data-end]");
    const all = e.target.closest?.("[data-end-all]");
    try {
      if (end) {
        const res = await api(`/api/users/me/sessions/${end.dataset.end}`, { method: "DELETE" });
        if (res.current) return location.replace("/login");
        toast.success("Session ended");
      } else if (all) {
        await api("/api/users/me/sessions", { method: "DELETE" });
        toast.success("Signed out of all other sessions");
      } else return;
      invalidate("/api/users/me/security");
    } catch (err) {
      toast.error("Could not end session", err.message);
    }
  };
  panel.addEventListener("click", onClick);
  return () => {
    unsub();
    panel.removeEventListener("click", onClick);
  };
}

/* ───────────── API keys ───────────── */

function apiKeysSection() {
  mount(
    panel,
    card({
      title: "API keys",
      description: "Programmatic access for read-only data or placing orders. Keys can never withdraw funds.",
      action: html`<button type="button" class="btn btn-primary btn-sm" data-create>${icon("key-round", "h-4 w-4")} Create key</button>`,
      body: html`<div class="border-t border-line" data-keys>${skeleton("m-5 h-24")}</div>
        <p class="border-t border-line px-5 py-3 text-xs text-dim">Authenticate with <code class="text-muted">Authorization: Bearer &lt;key&gt;</code>. Read keys can call GET endpoints such as <code class="text-muted">/api/portfolio</code>; trade keys can also place and cancel orders.</p>`,
    }),
  );
  const unsub = watch("/api/users/me/api-keys", ({ data, error }) => {
    const el = $("[data-keys]", panel);
    if (!el) return;
    if (!data) return error && mount(el, errorState({ message: error.message }));
    mount(
      el,
      !data.length
        ? emptyState({ iconName: "key-round", title: "No API keys", description: "Create a key to access your account data programmatically." })
        : html`<ul>${data.map(
            (k) => html`<li class="flex flex-col gap-3 border-b border-line/60 px-5 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
              <div><p class="flex items-center gap-2 text-sm font-semibold text-white">${k.name} ${k.scopes.map((s) => badge(s, s === "trade" ? "warn" : "info"))}</p><p class="font-mono text-xs text-dim">${k.keyPrefix}_••••••••</p><p class="text-xs text-dim">Created ${formatDate(k.createdAt, "date")} · ${k.lastUsedAt ? `Last used ${timeAgo(k.lastUsedAt)}` : "Never used"}</p></div>
              <button type="button" class="btn btn-ghost btn-sm" data-revoke="${k.id}" data-name="${k.name}">${icon("trash-2", "h-4 w-4 text-down")} Revoke</button>
            </li>`,
          )}</ul>`,
    );
  });
  const onClick = async (e) => {
    const revoke = e.target.closest?.("[data-revoke]");
    if (e.target.closest?.("[data-create]")) return createKey();
    if (!revoke) return;
    if (!(await confirmDialog({ title: "Revoke API key?", message: `Applications using "${revoke.dataset.name}" will stop working immediately.`, confirmLabel: "Revoke", danger: true }))) return;
    try {
      await api(`/api/users/me/api-keys/${revoke.dataset.revoke}`, { method: "DELETE" });
      toast.success("API key revoked");
      invalidate("/api/users/me/api-keys");
    } catch (err) {
      toast.error("Could not revoke key", err.message);
    }
  };
  panel.addEventListener("click", onClick);
  return () => {
    unsub();
    panel.removeEventListener("click", onClick);
  };
}

function createKey() {
  const m = openModal({
    title: "Create API key",
    body: html`<form id="key-form" class="space-y-4" novalidate>
      ${field({ name: "name", label: "Key name", placeholder: "e.g. Portfolio tracker", attrs: html`maxlength="60"` })}
      ${checkboxField({ name: "trade", label: "Allow trading (place and cancel orders)" })}
      ${stepUpFields(user)}
      <div data-form-error hidden></div>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="key-form" class="btn btn-primary">Create key</button>`,
  });
  bindForm($("#key-form", m.el), { name: [rules.min(2, "Give the key a name")], ...stepUpRule(user) }, async (v) => {
    const res = await api("/api/users/me/api-keys", { body: { name: v.name.trim(), scopes: v.trade ? ["read", "trade"] : ["read"], code: v.code || undefined, password: v.password || undefined } });
    m.close();
    invalidate("/api/users/me/api-keys");
    openModal({
      title: "Copy your API key",
      description: "This is the only time the full key is shown.",
      body: html`<code class="block rounded-md bg-panel-3 p-3 font-mono text-xs break-all text-white">${res.secret}</code><div class="mt-3">${copyButton(res.secret, "Copy key")}</div>${notice("warn", { cls: "mt-4", body: `Store it securely. Anyone with this key can access your account data${v.trade ? " and place orders" : ""}.` })}`,
      footer: html`<button type="button" class="btn btn-primary" data-close>Done</button>`,
    });
  });
}

const SECTIONS = { profile: profileSection, security: securitySection, notifications: notificationsSection, preferences: preferencesSection, sessions: sessionsSection, api: apiKeysSection };
show(tab);
void $$;
void ApiError;
void setFormError;
