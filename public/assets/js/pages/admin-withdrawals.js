import { html, $, on, mount } from "../core/dom.js";
import { api } from "../core/api.js";
import { invalidate } from "../core/store.js";
import { pageHeader, statusBadge, smallDemo, copyButton, emptyState, toast } from "../core/ui.js";
import { formatDate, formatNumber, truncateMiddle } from "../core/format.js";
import { adminPage, adminTable, actionModal, statusOptions } from "../components/admin-kit.js";

const { user: admin, view } = await adminPage();
mount(view, html`${pageHeader({ title: "Withdrawals", description: "Review destination, amount and account history before approving. Mark completed only once the transfer is confirmed on-chain." })}<div data-list></div>`);

const META = {
  approve: { title: "Approve & mark processing", label: "Approve", done: "marked processing" },
  complete: { title: "Mark withdrawal completed", label: "Mark completed", done: "completed" },
  reject: { title: "Reject withdrawal", label: "Reject", danger: true, done: "rejected" },
  fail: { title: "Mark withdrawal failed", label: "Mark failed", danger: true, done: "marked failed" },
};
const btn = (action, id, primary) => html`<button type="button" class="btn ${primary ? "btn-primary" : "btn-ghost"} btn-sm" data-act="${action}" data-id="${id}">${action === "approve" ? "Approve" : action === "reject" ? "Reject" : action === "complete" ? "Complete" : "Failed"}</button>`;

const list = adminTable($("[data-list]", view), {
  endpoint: "/api/admin/withdrawals",
  filters: [
    { name: "status", type: "select", options: statusOptions(["PENDING_REVIEW", "PROCESSING", "COMPLETED", "REJECTED", "FAILED", "CANCELLED"]) },
    { name: "q", type: "search", placeholder: "Search address, tx hash or email", cls: "md:w-72" },
  ],
  empty: emptyState({ title: "No withdrawals" }),
  columns: [
    { key: "u", header: "User", cell: (w) => html`<a href="/admin/users/${w.user.id}" class="text-white hover:text-accent">${w.user.email}</a>` },
    { key: "a", header: "Asset", cell: (w) => html`<span class="flex items-center gap-1.5 font-semibold">${w.asset.symbol} ${w.isDemo ? smallDemo() : ""}</span>` },
    { key: "amt", header: "Amount", align: "right", cell: (w) => html`<span class="num">${formatNumber(w.amount, 8)}</span>` },
    { key: "dest", header: "Destination", cell: (w) => html`<div><span class="flex items-center gap-1 font-mono text-xs text-muted">${truncateMiddle(w.address, 8)} ${copyButton(w.address, "Copy address", true)}</span><span class="text-[10px] text-dim">${w.network.name}${w.memo ? ` · memo ${w.memo}` : ""}</span></div>` },
    { key: "fee", header: "Fee", align: "right", hideOnMobile: true, cell: (w) => html`<span class="num text-muted">${formatNumber(w.fee, 8)}</span>` },
    { key: "d", header: "Date", hideOnMobile: true, cell: (w) => html`<span class="text-xs text-muted">${formatDate(w.createdAt)}</span>` },
    { key: "s", header: "Status", cell: (w) => html`<div>${statusBadge(w.status)}${w.txHash ? html`<p class="mt-0.5 font-mono text-[10px] text-dim">${truncateMiddle(w.txHash, 6)}</p>` : ""}${w.rejectionReason ? html`<p class="mt-0.5 max-w-40 truncate text-[10px] text-down">${w.rejectionReason}</p>` : ""}</div>` },
    {
      key: "act",
      header: html`<span class="sr-only">Actions</span>`,
      align: "right",
      cell: (w) =>
        !admin.can("withdrawals.review")
          ? ""
          : w.status === "PENDING_REVIEW"
            ? html`<div class="flex justify-end gap-1">${btn("approve", w.id, true)}${btn("reject", w.id)}</div>`
            : w.status === "PROCESSING"
              ? html`<div class="flex justify-end gap-1">${btn("complete", w.id, true)}${btn("fail", w.id)}</div>`
              : "",
    },
  ],
});

on(view, "click", "[data-act][data-id]", async (_e, b) => {
  const row = list.rows().find((r) => r.id === b.dataset.id);
  if (!row) return;
  const action = b.dataset.act;
  const meta = META[action];
  const ok = await actionModal({
    title: meta.title,
    description: `${formatNumber(row.amount, 8)} ${row.asset.symbol} → ${truncateMiddle(row.address, 10)} · ${row.user.email}`,
    confirmLabel: meta.label,
    tone: meta.danger ? "danger" : "primary",
    reason: action === "reject" || action === "fail" ? "required" : action === "approve" ? "optional" : undefined,
    reasonLabel: action === "approve" ? "Review note" : "Reason",
    requireTxHash: action === "complete" && !row.isDemo,
    warning:
      action === "complete"
        ? row.isDemo
          ? "Demo withdrawal: no real transfer takes place."
          : "Only mark completed after the transfer is broadcast and confirmed on-chain."
        : action === "reject" || action === "fail"
          ? "The reserved amount and fee will be returned to the user's available balance."
          : undefined,
    onConfirm: ({ reason, txHash }) => api(`/api/admin/withdrawals/${row.id}`, { body: { action, reason, txHash, note: action === "approve" ? reason : undefined } }),
  });
  if (ok) {
    toast.success(`Withdrawal ${meta.done}`);
    ["/api/admin/withdrawals", "/api/admin/overview"].forEach(invalidate);
  }
});
