import { html, $, mount } from "../core/dom.js";
import { watch } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { card, stat, notice, errorState, emptyState, skeleton, pageHeader, smallDemo, statusBadge, copyButton, DataTable } from "../core/ui.js";
import { formatDate, formatNumber } from "../core/format.js";

await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

mount(
  view,
  html`${pageHeader({ title: "Referrals", description: "Invite people you know to HarborFinance." })}
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
      ${card({ title: "Your referral link", iconName: "link-2", body: html`<div class="card-body space-y-4" data-link>${skeleton("h-24 w-full")}</div>` })}
      ${card({ title: "Programme rules", iconName: "gift", body: html`<div class="card-body space-y-3 text-sm" data-rules>${skeleton("h-24 w-full")}</div>` })}
    </div>
    <div class="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5" data-stats>${[0, 1, 2, 3, 4].map(() => stat({ label: "", loading: true }))}</div>
    <div data-demo></div>
    ${card({ cls: "mt-6", title: "Referred users", description: "Identities are partially masked for privacy.", body: html`<div class="border-t border-line" data-table></div>` })}`,
);

let unit = "USDT";
const table = new DataTable($("[data-table]", view), {
  empty: emptyState({ title: "No referrals yet", description: "Share your link to invite friends." }),
  columns: [
    { key: "user", header: "User", cell: (r) => html`<span class="flex items-center gap-2 font-mono text-white">${r.user} ${r.isDemo ? smallDemo() : ""}</span>` },
    { key: "date", header: "Registration date", cell: (r) => html`<span class="text-muted">${formatDate(r.registeredAt, "date")}</span>` },
    { key: "status", header: "Status", cell: (r) => statusBadge(r.status) },
    { key: "reward", header: "Reward", align: "right", cell: (r) => html`<span class="num">${r.reward ? `${formatNumber(r.reward, 2)} ${unit}` : "—"}</span>` },
    { key: "rs", header: "Reward status", cell: (r) => (r.rewardStatus ? statusBadge(r.rewardStatus) : html`<span class="text-xs text-dim">—</span>`) },
  ],
});
table.set(undefined, { loading: true });

watch("/api/referrals", ({ data, error }) => {
  if (!data) return error && mount(view, errorState({ message: error.message }));
  unit = data.stats.asset ?? "USDT";
  const p = data.program;
  mount(
    $("[data-link]", view),
    html`<div class="flex flex-col gap-2 rounded-xl border border-line bg-base-2 p-3 sm:flex-row sm:items-center"><p class="min-w-0 flex-1 truncate font-mono text-sm text-white">${data.link}</p>${copyButton(data.link, "Copy link")}</div>
    <div class="flex items-center justify-between rounded-xl border border-line bg-base-2 p-3"><div><p class="text-xs text-dim">Referral code</p><p class="font-mono text-lg font-bold tracking-widest text-accent">${data.code}</p></div>${copyButton(data.code, "Copy code")}</div>`,
  );
  const qualifying = p.qualifyingAction === "FIRST_DEPOSIT" ? `first deposit of at least ${p.minQualifyingDeposit} USDT` : "identity verification";
  mount(
    $("[data-rules]", view),
    !p.enabled
      ? html`<p class="text-muted">The referral programme is currently paused.</p>`
      : html`<p class="text-muted">${p.rewardAmount > 0 ? `A reward of ${p.rewardAmount} ${p.rewardAsset} may be credited when a referred account completes its ${qualifying}, subject to review.` : "Referrals are tracked, but no monetary reward is currently offered."}</p><p class="text-xs leading-relaxed text-dim">${p.terms}</p>`,
  );
  const s = data.stats;
  mount(
    $("[data-stats]", view),
    html`${stat({ label: "Total referrals", value: s.total, iconName: "users" })}
    ${stat({ label: "Active referrals", value: s.active, iconName: "user-check" })}
    ${stat({ label: "Referral rewards", value: `${formatNumber(s.rewardsTotal, 2)} ${unit}` })}
    ${stat({ label: "Pending rewards", value: `${formatNumber(s.pending, 2)} ${unit}`, iconName: "clock" })}
    ${stat({ label: "Completed rewards", value: `${formatNumber(s.completed, 2)} ${unit}`, iconName: "check-circle-2" })}`,
  );
  mount($("[data-demo]", view), data.referrals.some((r) => r.isDemo) ? notice("warn", { cls: "mt-6", body: "Referral rewards shown here include simulated demo data." }) : "");
  table.set(data.referrals);
});
