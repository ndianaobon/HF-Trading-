import { html, $, on, mount, cx } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { card, badge, demoBadge, smallDemo, statusBadge, errorState, emptyState, skeleton, toast, DataTable } from "../core/ui.js";
import { countryName } from "../core/countries.js";
import { formatDate, formatNumber, titleCase } from "../core/format.js";
import { adminPage, actionModal, kv } from "../components/admin-kit.js";

const { user: admin, view } = await adminPage();
const id = location.pathname.split("/").pop();
const key = `/api/admin/users/${id}`;

const ACTIONS = {
  suspend: { title: "Suspend account", label: "Suspend", danger: true, reason: "required", icon: "ban" },
  activate: { title: "Activate account", label: "Activate", icon: "check-circle-2" },
  reset_kyc: { title: "Reset verification", label: "Reset KYC", danger: true, reason: "required", icon: "rotate-ccw" },
  revoke_sessions: { title: "Sign out all sessions", label: "Revoke sessions", icon: "log-out" },
  verify_email: { title: "Mark email verified", label: "Verify email", icon: "mail-check" },
  unlock: { title: "Unlock sign-in", label: "Unlock", icon: "unlock" },
};

mount(view, html`<a href="/admin/users" class="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-white">${icon("arrow-left", "h-4 w-4")} Users</a><div data-body>${skeleton("h-[600px] w-full rounded-2xl")}</div>`);
const body = $("[data-body]", view);
let current = null;

watch(key, ({ data: u, error }) => {
  if (!u) return error && mount(body, errorState({ message: error.code === "NOT_FOUND" ? "This user doesn't exist." : error.message, retry: error.code !== "NOT_FOUND" }));
  current = u;
  const name = `${u.profile?.firstName ?? ""} ${u.profile?.lastName ?? ""}`.trim() || u.email;
  document.title = `${name} · Users | HarborFinance Admin`;
  const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
  const btn = (action, variant = "btn-secondary") => html`<button type="button" class="btn ${variant} btn-sm" data-act="${action}">${icon(ACTIONS[action].icon, "h-4 w-4")} ${ACTIONS[action].label}</button>`;
  const txTable = u.transactions === null ? null : document.createElement("div");
  const loginTable = document.createElement("div");

  mount(
    body,
    html`<div class="space-y-6">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 class="flex flex-wrap items-center gap-2 font-display text-2xl font-extrabold text-white">${name} ${u.isDemo ? demoBadge() : ""} ${u.adminUser ? badge(titleCase(u.adminUser.role), "accent") : ""}</h1>
          <p class="text-sm text-muted">${u.email} · <span class="font-mono text-xs">${u.id}</span></p>
          <div class="mt-2 flex flex-wrap gap-2">${statusBadge(u.status)}${statusBadge(u.emailVerifiedAt ? "ACTIVE" : "PENDING_VERIFICATION", u.emailVerifiedAt ? "Email verified" : "Email unverified")}${statusBadge(u.twoFactor?.enabled ? "ACTIVE" : "INACTIVE", u.twoFactor?.enabled ? "2FA on" : "2FA off")}${locked ? badge("Sign-in locked", "down") : ""}</div>
        </div>
        ${admin.can("users.manage")
          ? html`<div class="flex flex-wrap gap-2">
              ${u.status === "SUSPENDED" ? btn("activate", "btn-primary") : btn("suspend", "btn-danger")}
              ${btn("revoke_sessions")}${btn("reset_kyc")}${!u.emailVerifiedAt ? btn("verify_email") : ""}${u.lockedUntil ? btn("unlock") : ""}
            </div>`
          : ""}
      </div>
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
        ${card({
          title: "Profile",
          body: html`<div class="card-body">${kv([
            ["Country", countryName(u.profile?.country)],
            ["City", u.profile?.city ?? "—"],
            ["Phone", u.profile?.phone ?? "—"],
            ["Joined", formatDate(u.createdAt)],
            ["Last login", u.lastLoginAt ? `${formatDate(u.lastLoginAt)} (${u.lastLoginIp ?? "?"})` : "Never"],
            ["Referral code", u.referralCode],
            ["Referred by", u.referredBy?.referrer.email ?? "—"],
            ["Orders / trades", `${u._count.orders} / ${u._count.trades}`],
            ["Active sessions", String(u._count.sessions)],
            ["Support tickets", String(u._count.tickets)],
          ])}</div>`,
        })}
        ${card({
          title: "Balances",
          body: html`<div class="card-body">${
            u.wallets === null
              ? html`<p class="text-sm text-dim">You don't have permission to view balances.</p>`
              : !u.wallets.length
                ? html`<p class="text-sm text-dim">No balances.</p>`
                : html`<table class="w-full text-sm"><thead><tr class="text-[11px] text-dim uppercase"><th class="pb-2 text-left">Asset</th><th class="pb-2 text-right">Available</th><th class="pb-2 text-right">Locked</th></tr></thead><tbody>${u.wallets.map(
                    (w) => html`<tr class="border-t border-line/60"><td class="py-2 font-semibold text-white">${w.symbol}</td><td class="num py-2 text-right">${formatNumber(w.available, 8)}</td><td class="num py-2 text-right text-muted">${formatNumber(w.locked, 8)}</td></tr>`,
                  )}</tbody></table>`
          }</div>`,
        })}
        ${card({
          title: "KYC",
          action: admin.can("kyc.read") ? html`<a href="/admin/kyc" class="text-sm font-semibold text-accent">Queue →</a>` : "",
          body: html`<div class="card-body space-y-3">${
            !u.kycApplications.length
              ? html`<p class="text-sm text-dim">No applications.</p>`
              : u.kycApplications.map(
                  (k) => html`<a href="/admin/kyc?status=&open=${k.id}" class="block rounded-xl border border-line p-3 hover:border-line-strong"><div class="flex items-center justify-between">${statusBadge(k.status)}<span class="text-xs text-dim">${formatDate(k.submittedAt, "date")}</span></div><p class="mt-1 text-xs text-muted">${k.documents.length} documents${k.rejectionReason ? ` · ${k.rejectionReason}` : ""}</p></a>`,
                )
          }</div>`,
        })}
      </div>
      ${card({ title: "Recent transactions", action: admin.can("transactions.read") ? html`<a href="/admin/transactions?userId=${u.id}" class="text-sm font-semibold text-accent">All →</a>` : "", body: u.transactions === null ? html`<p class="px-5 pb-5 text-sm text-dim">You don't have permission to view transactions.</p>` : html`<div data-tx></div>` })}
      ${card({ title: "Login history", body: html`<div data-logins></div>` })}
    </div>`,
  );

  if (txTable) {
    $("[data-tx]", body).replaceWith(txTable);
    new DataTable(txTable, {
      dense: true,
      empty: emptyState({ title: "No transactions" }),
      columns: [
        { key: "d", header: "Date", cell: (t) => html`<span class="text-xs text-muted">${formatDate(t.createdAt)}</span>` },
        { key: "t", header: "Type", cell: (t) => html`<span class="flex items-center gap-1.5">${titleCase(t.type)} ${t.isDemo ? smallDemo() : ""}</span>` },
        { key: "a", header: "Amount", align: "right", cell: (t) => html`<span class="${cx("num", t.direction === "CREDIT" && "text-up")}">${t.direction === "CREDIT" ? "+" : "−"}${formatNumber(t.amount, 8)} ${t.asset.symbol}</span>` },
        { key: "s", header: "Status", cell: (t) => statusBadge(t.status) },
        { key: "r", header: "Reference", cell: (t) => html`<span class="font-mono text-xs text-muted">${t.reference}</span>` },
      ],
    }).set(u.transactions);
  }
  $("[data-logins]", body).replaceWith(loginTable);
  new DataTable(loginTable, {
    dense: true,
    empty: emptyState({ title: "No sign-ins recorded" }),
    columns: [
      { key: "d", header: "Date", cell: (l) => html`<span class="text-xs text-muted">${formatDate(l.createdAt)}</span>` },
      { key: "dev", header: "Device", cell: (l) => l.device },
      { key: "ip", header: "IP", cell: (l) => html`<span class="font-mono text-xs">${l.ip ?? ""}</span>` },
      { key: "r", header: "Result", cell: (l) => statusBadge(l.success ? "COMPLETED" : "FAILED", l.success ? "Success" : `Failed${l.reason ? ` · ${l.reason}` : ""}`) },
    ],
  }).set(u.loginHistory);
});

on(view, "click", "[data-act]", async (_e, b) => {
  const action = b.dataset.act;
  const meta = ACTIONS[action];
  const ok = await actionModal({
    title: meta.title,
    description: current?.email,
    confirmLabel: meta.label,
    tone: meta.danger ? "danger" : "primary",
    reason: meta.reason,
    onConfirm: ({ reason }) => api(key, { body: { action, reason } }),
  });
  if (ok) {
    toast.success("Action completed", meta.title);
    invalidate("/api/admin/users");
  }
});
