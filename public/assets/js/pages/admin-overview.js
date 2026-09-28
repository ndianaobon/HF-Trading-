import { html, $, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { watch } from "../core/store.js";
import { card, stat, notice, errorState, skeleton, statusBadge, badge, emptyState } from "../core/ui.js";
import { seriesChart } from "../core/charts.js";
import { formatNumber, formatUsd, timeAgo, titleCase } from "../core/format.js";
import { adminPage } from "../components/admin-kit.js";

const { user: admin, view } = await adminPage();
const usd = (v) => formatUsd(v, { compact: Math.abs(v) >= 100_000 });
const CHARTS = [
  { key: "signups", title: "User growth", sub: "New registrations per day", kind: "bar", color: "#4da2ff", fmt: (v) => String(Math.round(v)) },
  { key: "deposits", title: "Deposits", sub: "Completed, USDT equivalent", kind: "bar", color: "#19c784", fmt: (v) => formatUsd(v) },
  { key: "withdrawals", title: "Withdrawals", sub: "Completed, USDT equivalent", kind: "bar", color: "#f0465a", fmt: (v) => formatUsd(v) },
  { key: "volume", title: "Trading volume", sub: "USDT per day", kind: "area", color: "#F4BE2C", fmt: (v) => formatUsd(v) },
  { key: "revenue", title: "Revenue", sub: "Trading fees + withdrawal network fees, USDT", kind: "area", color: "#b86bc8", fmt: (v) => formatUsd(v), wide: true },
];
const hour = new Date().getHours();
const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
const quick = [
  ["users.read", "/admin/users", "Users", "users"],
  ["deposits.read", "/admin/deposits", "Deposits", "arrow-down-to-line"],
  ["withdrawals.read", "/admin/withdrawals", "Withdrawals", "arrow-up-from-line"],
  ["support.read", "/admin/support", "Support", "life-buoy"],
  ["settings.manage", "/admin/wallets", "Deposit addresses", "wallet"],
].filter(([perm]) => admin.can(perm));

mount(
  view,
  html`<div class="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p class="text-sm text-muted">${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        <h1 class="font-display text-2xl font-extrabold tracking-tight text-white sm:text-[28px]">${greeting}${admin.firstName ? `, ${admin.firstName}` : ""}</h1>
        <p class="mt-1 text-sm text-muted">Here's what's happening on HarborFinance. Figures refresh every 30 seconds.</p>
      </div>
      <div class="flex flex-wrap gap-2">${quick.map(([, href, label, ic]) => html`<a href="${href}" class="btn btn-secondary btn-sm">${icon(ic, "h-4 w-4")} ${label}</a>`)}</div>
    </div>
    <div data-demo></div>
    <h2 class="mb-3 flex items-center gap-2 font-display text-base font-bold text-white">${icon("bell-ring", "h-4 w-4 text-accent")} Needs your attention</h2>
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-attention>${Array.from({ length: 4 }, () => skeleton("h-28 rounded-2xl"))}</div>
    <h2 class="mt-8 mb-3 font-display text-base font-bold text-white">Users</h2>
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-5" data-users>${Array.from({ length: 5 }, () => stat({ label: "", loading: true }))}</div>
    <h2 class="mt-8 mb-3 font-display text-base font-bold text-white">Money <span class="text-xs font-normal text-dim">· last 30 days, USDT at current prices</span></h2>
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-5" data-money>${Array.from({ length: 5 }, () => stat({ label: "", loading: true }))}</div>
    <div class="mt-8 grid gap-4 lg:grid-cols-2" data-products></div>
    <h2 class="mt-8 mb-3 font-display text-base font-bold text-white">Recent activity</h2>
    <div class="grid gap-4 lg:grid-cols-2" data-activity>${Array.from({ length: 4 }, () => skeleton("h-72 rounded-2xl"))}</div>
    <h2 class="mt-8 mb-3 font-display text-base font-bold text-white">Trends <span class="text-xs font-normal text-dim">· last 30 days</span></h2>
    <div class="grid gap-6 lg:grid-cols-2">${CHARTS.map((c) => card({ cls: c.wide ? "lg:col-span-2" : "", title: c.title, description: c.sub, body: html`<div class="card-body"><div style="height:${c.wide ? 240 : 220}px" data-chart="${c.key}">${skeleton("h-full w-full")}</div></div>` }))}</div>`,
);

const attention = (d) => {
  const items = [
    {
      perm: "support.read",
      href: "/admin/support",
      icon: "message-circle",
      label: "Customers waiting for a reply",
      count: d.supportAwaiting.liveChat + d.supportAwaiting.tickets,
      sub: `${d.supportAwaiting.liveChat} live chat · ${d.supportAwaiting.tickets} tickets`,
    },
    { perm: "withdrawals.read", href: "/admin/withdrawals?status=PENDING_REVIEW", icon: "arrow-up-from-line", label: "Withdrawals to review", count: d.pendingWithdrawals, sub: `${formatUsd(d.pendingWithdrawalsValue)} requested` },
    { perm: "deposits.read", href: "/admin/deposits?status=PENDING", icon: "arrow-down-to-line", label: "Deposits to confirm", count: d.pendingDeposits, sub: `${formatUsd(d.pendingDepositsValue)} reported` },
    { perm: "kyc.read", href: "/admin/kyc?status=PENDING", icon: "badge-check", label: "KYC applications", count: d.pendingKyc, sub: "Identity documents to review" },
  ].filter((i) => admin.can(i.perm));
  return items.map(
    (i) => html`<a href="${i.href}" class="group flex flex-col rounded-2xl border ${i.count ? "border-accent/40 bg-accent/[0.05]" : "border-line bg-panel"} p-4 transition-colors hover:border-accent/60">
      <div class="flex items-center justify-between"><span class="grid h-9 w-9 place-items-center rounded-xl ${i.count ? "bg-accent text-accent-ink" : "bg-panel-3 text-dim"}">${icon(i.icon, "h-4 w-4")}</span><span class="num font-display text-3xl font-extrabold ${i.count ? "text-white" : "text-dim"}">${i.count}</span></div>
      <p class="mt-3 text-sm font-semibold text-white">${i.label}</p>
      <p class="flex items-center justify-between text-xs text-muted">${i.sub}<span class="flex items-center gap-1 font-semibold text-accent opacity-0 transition-opacity group-hover:opacity-100">Open ${icon("arrow-right", "h-3.5 w-3.5")}</span></p>
    </a>`,
  );
};

const listCard = (title, href, rows, empty, render) =>
  card({
    title,
    action: html`<a href="${href}" class="text-sm font-semibold text-accent hover:text-accent-strong">View all →</a>`,
    body: rows.length ? html`<ul class="divide-y divide-line border-t border-line">${rows.map((r) => html`<li>${render(r)}</li>`)}</ul>` : html`<div class="border-t border-line">${emptyState({ title: empty, cls: "py-8" })}</div>`,
  });
const row = (href, left, right) => html`<a href="${href}" class="flex items-center justify-between gap-3 px-5 py-3 hover:bg-panel-2"><div class="min-w-0">${left}</div><div class="shrink-0 text-right">${right}</div></a>`;

let charted = false;
watch(
  "/api/admin/overview",
  ({ data: d, error }) => {
    if (!d) return error && mount(view, errorState({ message: error.message }));
    mount($("[data-demo]", view), d.includesDemoData ? notice("warn", { cls: "mb-6", body: "This environment contains seeded demo data. Figures include simulated activity and must not be reported as real platform metrics." }) : "");
    mount($("[data-attention]", view), attention(d));
    mount(
      $("[data-users]", view),
      html`${stat({ label: "Total customers", value: d.totalUsers.toLocaleString(), iconName: "users" })}
        ${stat({ label: "New today", value: d.newUsersToday.toLocaleString(), sub: `${d.newUsers7d} this week`, iconName: "user-plus" })}
        ${stat({ label: "Active (30 days)", value: d.activeUsers.toLocaleString(), sub: "Signed in", iconName: "user-check" })}
        ${stat({ label: "Email verified", value: d.verifiedUsers.toLocaleString(), sub: d.totalUsers ? `${Math.round((d.verifiedUsers / d.totalUsers) * 100)}% of customers` : "", iconName: "mail-check" })}
        ${stat({ label: "Suspended / banned", value: d.restrictedUsers.toLocaleString(), iconName: "user-x" })}`,
    );
    const sum = (k) => d.series.reduce((s, x) => s + x[k], 0);
    mount(
      $("[data-money]", view),
      html`${stat({ label: "Customer balances", value: usd(d.customerBalances), sub: "All wallets, now", iconName: "wallet" })}
        ${stat({ label: "Deposits", value: usd(sum("deposits")), sub: "Completed", iconName: "arrow-down-to-line" })}
        ${stat({ label: "Withdrawals", value: usd(sum("withdrawals")), sub: "Completed", iconName: "arrow-up-from-line" })}
        ${stat({ label: "Trading volume", value: usd(d.tradingVolume30d), iconName: "bar-chart-3" })}
        ${stat({ label: "Revenue", value: usd(d.revenue30d), sub: "Trading + withdrawal fees", iconName: "coins" })}`,
    );
    const p = d.products;
    const botTone = { RUNNING: "text-up", PAUSED: "text-warn", STOPPED: "text-dim" }[p.automatedTrading.status];
    mount(
      $("[data-products]", view),
      html`${admin.can("copytraders.manage")
        ? card({
            title: "Copy trading",
            iconName: "users",
            action: html`<a href="/admin/copy-traders" class="text-sm font-semibold text-accent">Manage →</a>`,
            body: html`<div class="card-body grid grid-cols-3 gap-3 text-center">${[
              ["Lead traders", p.copyTrading.leadTraders],
              ["Followers", p.copyTrading.followers],
              ["Open copy trades", p.copyTrading.openTrades],
            ].map(([k, v]) => html`<div><p class="num font-display text-2xl font-extrabold text-white">${v}</p><p class="text-xs text-dim">${k}</p></div>`)}</div>`,
          })
        : ""}
      ${admin.can("autobot.manage")
        ? card({
            title: "Automated trading",
            iconName: "bot",
            action: html`<a href="/admin/auto-trading" class="text-sm font-semibold text-accent">Manage →</a>`,
            body: html`<div class="card-body grid grid-cols-3 gap-3 text-center"><div><p class="font-display text-2xl font-extrabold ${botTone}">${titleCase(p.automatedTrading.status)}</p><p class="text-xs text-dim">Bot status</p></div><div><p class="num font-display text-2xl font-extrabold text-white">${p.automatedTrading.participants}</p><p class="text-xs text-dim">Participants</p></div><div><p class="num font-display text-2xl font-extrabold text-white">${p.automatedTrading.openTrades}</p><p class="text-xs text-dim">Open positions</p></div></div>`,
          })
        : ""}`,
    );
    const a = d.activity;
    mount(
      $("[data-activity]", view),
      html`${a.support
        ? listCard("Support conversations", "/admin/support", a.support, "No conversations yet", (t) =>
            row(
              `/admin/support?ticket=${t.id}`,
              html`<p class="truncate text-sm font-medium text-white">${t.category === "LIVE_CHAT" ? badge("Chat", "accent", "mr-1") : ""}${t.subject}</p><p class="truncate text-xs text-dim">${t.user.email}</p>`,
              html`${statusBadge(t.status)}<p class="mt-1 text-[11px] text-dim">${timeAgo(t.lastMessageAt)}</p>`,
            ),
          )
        : ""}
      ${a.users
        ? listCard("Newest customers", "/admin/users", a.users, "No customers yet", (u) =>
            row(
              `/admin/users/${u.id}`,
              html`<p class="truncate text-sm font-medium text-white">${[u.profile?.firstName, u.profile?.lastName].filter(Boolean).join(" ") || u.email}</p><p class="truncate text-xs text-dim">${u.email}${u.profile?.country ? ` · ${u.profile.country}` : ""}</p>`,
              html`${statusBadge(u.status)}<p class="mt-1 text-[11px] text-dim">${timeAgo(u.createdAt)}</p>`,
            ),
          )
        : ""}
      ${a.deposits
        ? listCard("Latest deposits", "/admin/deposits", a.deposits, "No deposits yet", (x) =>
            row(
              `/admin/deposits?status=${x.status}`,
              html`<p class="num text-sm font-semibold text-white">${formatNumber(x.amount, 8)} ${x.asset.symbol} <span class="text-xs font-normal text-dim">${x.network.code}</span></p><p class="truncate text-xs text-dim">${x.user.email}</p>`,
              html`${statusBadge(x.status)}<p class="mt-1 text-[11px] text-dim">${timeAgo(x.createdAt)}</p>`,
            ),
          )
        : ""}
      ${a.withdrawals
        ? listCard("Latest withdrawals", "/admin/withdrawals", a.withdrawals, "No withdrawals yet", (x) =>
            row(
              `/admin/withdrawals?status=${x.status}`,
              html`<p class="num text-sm font-semibold text-white">${formatNumber(x.amount, 8)} ${x.asset.symbol} <span class="text-xs font-normal text-dim">${x.network.code}</span></p><p class="truncate text-xs text-dim">${x.user.email}</p>`,
              html`${statusBadge(x.status)}<p class="mt-1 text-[11px] text-dim">${timeAgo(x.createdAt)}</p>`,
            ),
          )
        : ""}`,
    );
    if (charted) return;
    charted = true;
    for (const c of CHARTS) {
      const el = $(`[data-chart="${c.key}"]`, view);
      seriesChart(el, d.series, c.key, { kind: c.kind, color: c.color, format: c.fmt }).catch(() => mount(el, errorState({ message: "Chart could not be displayed.", retry: false })));
    }
  },
  { refresh: 30000 },
);
