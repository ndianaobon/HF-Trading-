import { html, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { pageHeader, statusBadge, smallDemo, badge, emptyState } from "../core/ui.js";
import { formatDate, timeAgo, titleCase } from "../core/format.js";
import { adminPage, adminTable, statusOptions } from "../components/admin-kit.js";

const { view } = await adminPage();
mount(view, html`${pageHeader({ title: "Users", description: "Search accounts and open a profile to review balances, activity and verification." })}<div data-list></div>`);

adminTable(view.querySelector("[data-list]"), {
  endpoint: "/api/admin/users",
  filters: [
    { name: "q", type: "search", placeholder: "Search email, name, ID or referral code", cls: "md:w-96" },
    { name: "status", type: "select", options: statusOptions(["ACTIVE", "PENDING_VERIFICATION", "SUSPENDED", "BANNED", "CLOSED"]) },
    { name: "staff", type: "select", label: "Account type", options: [["", "All accounts"], ["false", "Customers"], ["true", "Staff"]] },
  ],
  onRowClick: (u) => (location.href = `/admin/users/${u.id}`),
  empty: emptyState({ title: "No users found" }),
  columns: [
    { key: "user", header: "User", cell: (u) => html`<div><p class="flex items-center gap-2 font-semibold text-white">${u.name || "—"} ${u.isDemo ? smallDemo() : ""} ${u.adminRole ? badge(titleCase(u.adminRole), "accent") : ""}</p><p class="text-xs text-dim">${u.email}</p></div>` },
    { key: "country", header: "Country", hideOnMobile: true, cell: (u) => html`<span class="text-muted">${u.country ?? "—"}</span>` },
    { key: "status", header: "Status", cell: (u) => html`<span class="flex flex-wrap items-center gap-1.5">${statusBadge(u.status)}${u.statusLabel ? badge(u.statusLabel, "accent") : ""}</span>` },
    { key: "kyc", header: "KYC", cell: (u) => statusBadge(u.kycStatus) },
    { key: "2fa", header: "2FA", hideOnMobile: true, cell: (u) => (u.twoFactor ? html`<span class="text-up" title="2FA enabled">${icon("shield-check", "h-4 w-4")}</span>` : html`<span class="text-xs text-dim">Off</span>`) },
    { key: "login", header: "Last login", hideOnMobile: true, cell: (u) => html`<span class="text-xs text-muted">${u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Never"}</span>` },
    { key: "joined", header: "Joined", align: "right", cell: (u) => html`<span class="text-xs text-muted">${formatDate(u.createdAt, "date")}</span>` },
  ],
});
