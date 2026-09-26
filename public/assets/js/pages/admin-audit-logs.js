import { html, $, mount } from "../core/dom.js";
import { pageHeader, emptyState } from "../core/ui.js";
import { formatDate } from "../core/format.js";
import { adminPage, adminTable } from "../components/admin-kit.js";

const { view } = await adminPage();
const TARGETS = ["User", "Withdrawal", "Deposit", "KycApplication", "KycDocument", "InvestmentSubscription", "InvestmentPlan", "Market", "FeeConfiguration", "SystemSetting", "WalletAddress", "Network", "CopyTrader", "ReferralReward", "SupportTicket", "Notification"];

mount(view, html`${pageHeader({ title: "Audit logs", description: "Append-only record of sensitive actions by staff and users." })}<div data-list></div>`);

adminTable($("[data-list]", view), {
  endpoint: "/api/admin/audit-logs",
  pageSize: 30,
  dense: true,
  filters: [
    { name: "q", type: "search", placeholder: "Search actor, action or target ID" },
    { name: "targetType", type: "select", label: "Target", cls: "sm:w-56", options: [["", "All targets"], ...TARGETS.map((t) => [t, t])] },
  ],
  empty: emptyState({ title: "No log entries" }),
  columns: [
    { key: "t", header: "Time", cell: (l) => html`<span class="text-xs text-muted">${formatDate(l.createdAt)}</span>` },
    { key: "a", header: "Actor", cell: (l) => l.actorEmail ?? html`<span class="text-dim">system</span>` },
    { key: "ac", header: "Action", cell: (l) => html`<span class="font-mono text-xs text-accent">${l.action}</span>` },
    { key: "tg", header: "Target", cell: (l) => html`<span class="text-xs">${l.targetType}${l.targetId ? html`<span class="block font-mono text-[10px] text-dim">${l.targetId.slice(0, 24)}</span>` : ""}</span>` },
    { key: "m", header: "Details", hideOnMobile: true, cell: (l) => html`<span class="block max-w-80 truncate font-mono text-[11px] text-muted" title="${JSON.stringify(l.metadata)}">${Object.keys(l.metadata ?? {}).length ? JSON.stringify(l.metadata) : "—"}</span>` },
    { key: "ip", header: "IP", hideOnMobile: true, cell: (l) => html`<span class="font-mono text-xs text-dim">${l.ip ?? "—"}</span>` },
  ],
});
