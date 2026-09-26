import { html, $, mount, param } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { pageHeader, statusBadge, smallDemo, notice, emptyState } from "../core/ui.js";
import { formatDate, formatNumber, titleCase } from "../core/format.js";
import { adminPage, adminTable, statusOptions, qs } from "../components/admin-kit.js";

const { view } = await adminPage();
const userId = param("userId") ?? "";

mount(
  view,
  html`${pageHeader({ title: "Transactions", description: "Platform-wide ledger of balance changes.", actions: html`<a class="btn btn-secondary" href="#" data-csv>${icon("download", "h-4 w-4")} Export CSV</a>` })}
    ${userId ? notice("info", { iconName: "info", cls: "mb-4", body: html`Filtered to one user. <a href="/admin/transactions" class="font-semibold underline">Clear</a>` }) : ""}
    <div data-list></div>`,
);

const list = adminTable($("[data-list]", view), {
  endpoint: "/api/admin/transactions",
  dense: true,
  extraParams: { userId },
  filters: [
    { name: "q", type: "search", placeholder: "Search reference, ID or email" },
    { name: "type", type: "select", options: statusOptions(["DEPOSIT", "WITHDRAWAL", "TRADE", "TRANSFER", "INVESTMENT", "COPY_TRADING", "REFERRAL", "FEE", "ADJUSTMENT"], "All types") },
    { name: "status", type: "select", options: statusOptions(["PENDING", "CONFIRMING", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED"]) },
  ],
  empty: emptyState({ title: "No transactions" }),
  columns: [
    { key: "d", header: "Date", cell: (t) => html`<span class="text-xs text-muted">${formatDate(t.createdAt)}</span>` },
    { key: "u", header: "User", cell: (t) => html`<a href="/admin/users/${t.user.id}" class="text-white hover:text-accent">${t.user.email}</a>` },
    { key: "t", header: "Type", cell: (t) => html`<span class="flex items-center gap-1.5">${titleCase(t.type)} ${t.isDemo ? smallDemo() : ""}</span>` },
    { key: "a", header: "Amount", align: "right", cell: (t) => html`<span class="num ${t.direction === "CREDIT" ? "text-up" : ""}">${t.direction === "CREDIT" ? "+" : "−"}${formatNumber(t.amount, 8)} ${t.asset.symbol}</span>` },
    { key: "f", header: "Fee", align: "right", hideOnMobile: true, cell: (t) => html`<span class="num text-muted">${Number(t.fee) ? formatNumber(t.fee, 8) : "—"}</span>` },
    { key: "s", header: "Status", cell: (t) => statusBadge(t.status) },
    { key: "r", header: "Transaction ID", hideOnMobile: true, cell: (t) => html`<span class="font-mono text-xs text-muted">${t.reference}</span>` },
  ],
});

// Keep the export link in sync with the active filters.
const csv = $("[data-csv]", view);
const syncCsv = () => (csv.href = `/api/admin/transactions?${qs({ type: list.state.type, status: list.state.status, q: list.state.q, userId, format: "csv" })}`);
syncCsv();
view.addEventListener("input", () => setTimeout(syncCsv, 350));
view.addEventListener("change", syncCsv);
