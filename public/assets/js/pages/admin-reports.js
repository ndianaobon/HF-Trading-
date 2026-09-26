import { html, $, on, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { watch } from "../core/store.js";
import { card, stat, pageHeader, segmented, skeleton, errorState } from "../core/ui.js";
import { seriesChart } from "../core/charts.js";
import { formatUsd, titleCase } from "../core/format.js";
import { adminPage } from "../components/admin-kit.js";

const { view } = await adminPage();
const RANGES = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
  { value: "180", label: "180D" },
];
const CHARTS = [
  ["volume", "area", "#F4BE2C"],
  ["revenue", "area", "#b86bc8"],
  ["deposits", "bar", "#19c784"],
  ["withdrawals", "bar", "#f0465a"],
];
let range = "30";
let unsub = null;

mount(
  view,
  html`${pageHeader({ title: "Reports", description: "Platform activity over time. Multi-asset values converted to USDT at current prices.", actions: html`<div data-range></div><a class="btn btn-secondary" data-csv href="#">${icon("download", "h-4 w-4")} CSV</a>` })}
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-5" data-stats></div>
    <div class="mt-6 grid gap-6 lg:grid-cols-2">${CHARTS.map(([k]) => card({ title: titleCase(k), body: html`<div class="card-body"><div class="h-[220px]" data-chart="${k}"></div></div>` }))}</div>`,
);

function load() {
  mount($("[data-range]", view), segmented(RANGES, range, { name: "r" }));
  $("[data-csv]", view).href = `/api/admin/reports?range=${range}&format=csv`;
  mount($("[data-stats]", view), Array.from({ length: 5 }, () => stat({ label: "", loading: true })));
  CHARTS.forEach(([k]) => mount($(`[data-chart="${k}"]`, view), skeleton("h-full w-full")));
  unsub?.();
  unsub = watch(`/api/admin/reports?range=${range}`, ({ data, error }) => {
    if (!data) return error && mount($("[data-stats]", view), html`<div class="col-span-full">${errorState({ message: error.message })}</div>`);
    const t = data.totals;
    mount(
      $("[data-stats]", view),
      html`${stat({ label: "New users", value: String(t.signups) })}${stat({ label: "Trading volume", value: formatUsd(t.volume, { compact: true }) })}${stat({ label: "Deposits", value: formatUsd(t.deposits, { compact: true }) })}${stat({ label: "Withdrawals", value: formatUsd(t.withdrawals, { compact: true }) })}${stat({ label: "Revenue", value: formatUsd(t.revenue) })}`,
    );
    CHARTS.forEach(([k, kind, color]) => {
      const el = $(`[data-chart="${k}"]`, view);
      seriesChart(el, data.series, k, { kind, color, format: (v) => formatUsd(v) }).catch(() => mount(el, errorState({ message: "Chart could not be displayed.", retry: false })));
    });
  });
}
on(view, "click", "[data-range] [data-r]", (_e, b) => {
  range = b.dataset.r;
  load();
});
load();
