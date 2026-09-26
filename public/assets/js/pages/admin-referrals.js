import { html, $, on, mount } from "../core/dom.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { pageHeader, statusBadge, smallDemo, emptyState, toast, confirmDialog } from "../core/ui.js";
import { formatDate, formatNumber, titleCase } from "../core/format.js";
import { adminPage, adminTable } from "../components/admin-kit.js";

const { user: admin, view } = await adminPage();
const canManage = admin.can("referrals.manage");
mount(view, html`<div data-head>${pageHeader({ title: "Referrals", description: "Referral rewards awaiting review." })}</div><div data-list></div>`);

const list = adminTable($("[data-list]", view), {
  endpoint: "/api/admin/referrals",
  filters: [{ name: "rewardStatus", type: "select", label: "Reward status", default: "PENDING", options: [["PENDING", "Pending"], ["COMPLETED", "Completed"], ["CANCELLED", "Cancelled"], ["", "All"]] }],
  empty: emptyState({ title: "No rewards" }),
  columns: [
    { key: "u", header: "Referrer", cell: (r) => html`<span class="flex items-center gap-1.5">${r.user.email} ${r.isDemo ? smallDemo() : ""}</span>` },
    { key: "ref", header: "Referred user", cell: (r) => r.referral.referred.email },
    { key: "why", header: "Qualified by", hideOnMobile: true, cell: (r) => titleCase(r.reason) },
    { key: "a", header: "Reward", align: "right", cell: (r) => html`<span class="num">${formatNumber(r.amount, 2)} ${r.asset.symbol}</span>` },
    { key: "d", header: "Created", hideOnMobile: true, cell: (r) => html`<span class="text-xs text-muted">${formatDate(r.createdAt, "date")}</span>` },
    { key: "s", header: "Status", cell: (r) => statusBadge(r.status) },
    { key: "x", header: html`<span class="sr-only">Actions</span>`, align: "right", cell: (r) => (r.status === "PENDING" && canManage ? html`<div class="flex justify-end gap-1"><button type="button" class="btn btn-primary btn-sm" data-settle="COMPLETED" data-id="${r.id}">Pay</button><button type="button" class="btn btn-ghost btn-sm" data-settle="CANCELLED" data-id="${r.id}">Cancel</button></div>` : "") },
  ],
});

// The list response also carries programme totals for the header.
watch(`/api/admin/referrals?pageSize=1`, ({ data }) => {
  if (data) mount($("[data-head]", view), pageHeader({ title: "Referrals", description: `${data.referralCount} referrals · ${data.activeCount} qualified. Reward rules are configured in Settings → referral.program.` }));
});

on(view, "click", "[data-settle][data-id]", async (_e, b) => {
  const r = list.rows().find((x) => x.id === b.dataset.id);
  if (!r) return;
  const pay = b.dataset.settle === "COMPLETED";
  const ok = await confirmDialog({
    title: pay ? "Pay referral reward?" : "Cancel referral reward?",
    message: pay ? `${formatNumber(r.amount, 2)} ${r.asset.symbol} will be credited to ${r.user.email}${r.isDemo ? " (demo funds)" : ""}. This is recorded in the audit log.` : `The pending reward for ${r.user.email} will be cancelled. This is recorded in the audit log.`,
    confirmLabel: pay ? "Pay reward" : "Cancel reward",
    danger: !pay,
  });
  if (!ok) return;
  try {
    await api(`/api/admin/referral-rewards/${r.id}`, { body: { decision: b.dataset.settle } });
    toast.success(pay ? "Reward paid" : "Reward cancelled");
    invalidate("/api/admin/referrals");
  } catch (err) {
    toast.error("Action failed", err.message);
  }
});
