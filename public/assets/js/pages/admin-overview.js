import { html, $, $$, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { watch } from "../core/store.js";
import { card, stat, notice, errorState, skeleton, pageHeader } from "../core/ui.js";
import { seriesChart } from "../core/charts.js";
import { formatUsd } from "../core/format.js";
import { adminPage } from "../components/admin-kit.js";

const { view } = await adminPage();
const usd = (v) => formatUsd(v, { compact: v >= 1000 });
const CHARTS = [
  { key: "signups", title: "User growth", sub: "New registrations per day", kind: "bar", color: "#4da2ff", fmt: (v) => String(Math.round(v)) },
  { key: "volume", title: "Trading volume", sub: "USDT per day", kind: "area", color: "#F4BE2C", fmt: (v) => formatUsd(v) },
  { key: "deposits", title: "Deposits", sub: "Completed, USDT equivalent", kind: "bar", color: "#19c784", fmt: (v) => formatUsd(v) },
  { key: "withdrawals", title: "Withdrawals", sub: "Completed, USDT equivalent", kind: "bar", color: "#f0465a", fmt: (v) => formatUsd(v) },
  { key: "revenue", title: "Revenue", sub: "Trading fees + withdrawal network fees, USDT", kind: "area", color: "#b86bc8", fmt: (v) => formatUsd(v), wide: true },
];
const QUICK = [
  ["/admin/kyc?status=PENDING", "Review KYC applications", "pendingKyc"],
  ["/admin/deposits?status=PENDING", "Review pending deposits", "pendingDeposits"],
  ["/admin/withdrawals?status=PENDING_REVIEW", "Review withdrawals", "pendingWithdrawals"],
];

mount(
  view,
  html`${pageHeader({ title: "Platform overview", description: "Last 30 days. Multi-asset values are converted to USDT at current prices." })}
    <div data-demo></div>
    <div class="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" data-stats>${Array.from({ length: 7 }, () => stat({ label: "", loading: true }))}</div>
    <div class="mt-6 grid gap-3 md:grid-cols-3">${QUICK.map(([href, label, k]) => html`<a href="${href}" class="flex items-center justify-between rounded-2xl border border-line bg-panel px-5 py-4 hover:border-accent/40"><span class="text-sm font-semibold text-white">${label}</span><span class="flex items-center gap-2"><span class="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent" data-count="${k}">…</span>${icon("arrow-right", "h-4 w-4 text-dim")}</span></a>`)}</div>
    <div class="mt-6 grid gap-6 lg:grid-cols-2">${CHARTS.map((c) => card({ cls: c.wide ? "lg:col-span-2" : "", title: c.title, description: c.sub, body: html`<div class="card-body"><div style="height:${c.wide ? 240 : 220}px" data-chart="${c.key}">${skeleton("h-full w-full")}</div></div>` }))}</div>`,
);

let charted = false;
watch(
  "/api/admin/overview",
  ({ data, error }) => {
    if (!data) return error && mount(view, errorState({ message: error.message }));
    mount($("[data-demo]", view), data.includesDemoData ? notice("warn", { cls: "mb-6", body: "This environment contains seeded demo data. Figures below include simulated activity and must not be reported as real platform metrics." }) : "");
    mount(
      $("[data-stats]", view),
      html`${stat({ label: "Total users", value: data.totalUsers.toLocaleString(), iconName: "users" })}
      ${stat({ label: "Active users", value: data.activeUsers.toLocaleString(), sub: "Signed in, 30d", iconName: "user-check" })}
      ${stat({ label: "Pending KYC", value: data.pendingKyc, iconName: "badge-check" })}
      ${stat({ label: "Pending deposits", value: data.pendingDeposits, iconName: "arrow-down-to-line" })}
      ${stat({ label: "Pending withdrawals", value: data.pendingWithdrawals, iconName: "arrow-up-from-line" })}
      ${stat({ label: "Trading volume", value: usd(data.tradingVolume30d), sub: "30d, USDT", iconName: "bar-chart-3" })}
      ${stat({ label: "Platform revenue", value: usd(data.revenue30d), sub: "Trading + withdrawal fees", iconName: "coins" })}`,
    );
    $$("[data-count]", view).forEach((e) => (e.textContent = String(data[e.dataset.count] ?? 0)));
    if (charted) return;
    charted = true;
    for (const c of CHARTS) {
      const el = $(`[data-chart="${c.key}"]`, view);
      seriesChart(el, data.series, c.key, { kind: c.kind, color: c.color, format: c.fmt }).catch(() => mount(el, errorState({ message: "Chart could not be displayed.", retry: false })));
    }
  },
  { refresh: 30000 },
);
