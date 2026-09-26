import { html, $, on, mount } from "../core/dom.js";
import { api } from "../core/api.js";
import { invalidate } from "../core/store.js";
import { pageHeader, statusBadge, smallDemo, copyButton, emptyState, toast } from "../core/ui.js";
import { formatDate, formatNumber, truncateMiddle } from "../core/format.js";
import { adminPage, adminTable, actionModal, statusOptions } from "../components/admin-kit.js";

const { user: admin, view } = await adminPage();
mount(view, html`${pageHeader({ title: "Deposits", description: "Credit deposits only after independently verifying the transaction on-chain or with the custodian." })}<div data-list></div>`);

const list = adminTable($("[data-list]", view), {
  endpoint: "/api/admin/deposits",
  filters: [
    { name: "status", type: "select", options: statusOptions(["PENDING", "CONFIRMING", "COMPLETED", "FAILED", "EXPIRED"]) },
    { name: "q", type: "search", placeholder: "Search tx hash, ID or email", cls: "md:w-72" },
  ],
  empty: emptyState({ title: "No deposits" }),
  columns: [
    { key: "u", header: "User", cell: (d) => html`<a href="/admin/users/${d.user.id}" class="text-white hover:text-accent">${d.user.email}</a>` },
    { key: "a", header: "Asset", cell: (d) => html`<span class="flex items-center gap-1.5 font-semibold">${d.asset.symbol} ${d.isDemo ? smallDemo() : ""}</span>` },
    { key: "amt", header: "Amount", align: "right", cell: (d) => html`<span class="num">${formatNumber(d.amount, 8)}</span>` },
    { key: "n", header: "Network", hideOnMobile: true, cell: (d) => html`<span class="text-muted">${d.network.name}</span>` },
    { key: "tx", header: "Transaction ID", cell: (d) => (d.txHash ? html`<span class="flex items-center gap-1 font-mono text-xs text-muted">${truncateMiddle(d.txHash, 8)} ${copyButton(d.txHash, "Copy transaction hash", true)}</span>` : html`<span class="text-xs text-dim">${d.provider === "demo-simulator" ? "Simulated" : "—"}</span>`) },
    { key: "d", header: "Date", hideOnMobile: true, cell: (d) => html`<span class="text-xs text-muted">${formatDate(d.createdAt)}</span>` },
    { key: "s", header: "Status", cell: (d) => html`<div>${statusBadge(d.status)}${d.status === "CONFIRMING" ? html`<span class="ml-1 text-[10px] text-dim">${d.confirmations}/${d.requiredConfirmations}</span>` : ""}${d.failureReason ? html`<p class="mt-0.5 max-w-40 truncate text-[10px] text-down">${d.failureReason}</p>` : ""}</div>` },
    {
      key: "act",
      header: html`<span class="sr-only">Actions</span>`,
      align: "right",
      cell: (d) => (d.status === "PENDING" && admin.can("deposits.review") ? html`<div class="flex justify-end gap-1"><button type="button" class="btn btn-primary btn-sm" data-act="approve" data-id="${d.id}">Approve</button><button type="button" class="btn btn-ghost btn-sm" data-act="reject" data-id="${d.id}">Reject</button></div>` : ""),
    },
  ],
});

on(view, "click", "[data-act][data-id]", async (_e, b) => {
  const row = list.rows().find((r) => r.id === b.dataset.id);
  if (!row) return;
  const approve = b.dataset.act === "approve";
  const ok = await actionModal({
    title: approve ? "Approve and credit deposit" : "Reject deposit",
    description: `${formatNumber(row.amount, 8)} ${row.asset.symbol} · ${row.user.email}`,
    confirmLabel: approve ? "Credit deposit" : "Reject deposit",
    tone: approve ? "primary" : "danger",
    reason: approve ? undefined : "required",
    warning: approve ? (row.isDemo ? "Demo deposit: approving credits simulated funds only." : `Confirm transaction ${row.txHash ?? ""} on ${row.network.name} has at least ${row.requiredConfirmations} confirmations to the configured address before crediting.`) : undefined,
    onConfirm: ({ reason }) => api(`/api/admin/deposits/${row.id}`, { body: { action: b.dataset.act, reason } }),
  });
  if (ok) {
    toast.success(approve ? "Deposit credited" : "Deposit rejected");
    ["/api/admin/deposits", "/api/admin/overview"].forEach(invalidate);
  }
});
