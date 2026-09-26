// Portfolio performance card: range selector + value chart from recorded
// hourly valuations. Flags when the history contains simulated (demo) data.

import { html, $, on, mount } from "../core/dom.js";
import { watch } from "../core/store.js";
import { card, emptyState, errorState, skeleton, segmented, demoBadge } from "../core/ui.js";
import { valueChart } from "../core/charts.js";

const RANGES = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];

export function performanceCard({ cls = "", height = 260 } = {}) {
  return card({
    cls,
    title: html`<span class="flex items-center gap-2">Performance <span data-perf-demo></span></span>`,
    description: "Portfolio value over time (USDT)",
    action: html`<div data-perf-range></div>`,
    body: html`<div class="card-body"><div style="height:${height}px" data-perf>${skeleton("h-full w-full")}</div></div>`,
  });
}

export function mountPerformance(root, initial = "30d") {
  let range = initial;
  let unsub = null;
  const load = () => {
    mount($("[data-perf-range]", root), segmented(RANGES, range, { size: "sm", name: "range" }));
    unsub?.();
    unsub = watch(`/api/portfolio/performance?range=${range}`, ({ data, error }) => {
      const el = $("[data-perf]", root);
      if (!data) {
        if (error) mount(el, errorState({ message: error.message, cls: "h-full" }));
        return;
      }
      mount($("[data-perf-demo]", root), data.containsDemo ? demoBadge("Includes demo data") : "");
      if (data.points.length < 2) mount(el, emptyState({ title: "Not enough history yet", description: "Your performance chart fills in as hourly valuations are recorded.", iconName: "line-chart", cls: "h-full" }));
      else valueChart(el, data.points).catch(() => mount(el, errorState({ message: "Chart could not be displayed.", retry: false })));
    });
  };
  on(root, "click", "[data-perf-range] [data-range]", (_e, b) => {
    range = b.dataset.range;
    load();
  });
  load();
}
