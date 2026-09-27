// Lead-trader directory with risk/strategy/asset filters and return period.
// Every figure is calculated from the trader's recorded signals.
import { html, $, on, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { segmented, riskBadge, sparkline, skeleton, emptyState, errorState } from "../core/ui.js";
import { formatPercent } from "../core/format.js";
import { traderAvatar } from "./copy-bits.js";

const PERIODS = [
  { value: "return30dPct", label: "30D" },
  { value: "return90dPct", label: "90D" },
  { value: "totalReturnPct", label: "All" },
];

export function mountTraderDirectory(el, { profileBase }) {
  const f = { risk: "", strategy: "", asset: "", period: "return90dPct" };
  let list = null;

  mount(
    el,
    html`<div class="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-3 lg:flex-row lg:items-center">
        <div class="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
          <select class="select" aria-label="Risk" data-f="risk"><option value="">All risk levels</option><option value="LOW">Low risk</option><option value="MEDIUM">Medium risk</option><option value="HIGH">High risk</option><option value="VERY_HIGH">Very high risk</option></select>
          <select class="select" aria-label="Strategy" data-f="strategy"><option value="">All strategies</option></select>
          <select class="select" aria-label="Assets" data-f="asset"><option value="">All assets</option></select>
        </div>
        <div data-periods></div>
      </div>
      <p class="mt-4 text-xs text-dim">Returns are the compounded price move of each trader's closed signals, measured from execution to close at live market prices.</p>
      <div class="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-grid>${Array.from({ length: 6 }, () => skeleton("h-72 rounded-2xl"))}</div>`,
  );

  const drawPeriods = () => mount($("[data-periods]", el), segmented(PERIODS, f.period, { name: "period" }));
  drawPeriods();

  const stat = (ic, label, value) => html`<div class="flex items-center justify-between gap-2"><dt class="flex items-center gap-1.5 text-dim">${icon(ic, "h-3.5 w-3.5")} ${label}</dt><dd class="num font-semibold text-fg">${value}</dd></div>`;

  const draw = () => {
    const grid = $("[data-grid]", el);
    if (!list) return;
    if (!list.length) return mount(grid, html`<div class="md:col-span-2 xl:col-span-3">${emptyState({ title: "No traders match these filters", description: "Try widening the risk level or strategy." })}</div>`);
    const val = (t) => t.stats[f.period];
    const sorted = [...list].sort((a, b) => (val(b) ?? -Infinity) - (val(a) ?? -Infinity));
    const label = PERIODS.find((p) => p.value === f.period).label;
    mount(
      grid,
      sorted.map((t) => {
        const s = t.stats;
        const ret = val(t);
        return html`<a href="${profileBase}/${t.slug}" class="group flex flex-col rounded-2xl border border-line bg-panel p-5 transition-all hover:-translate-y-0.5 hover:border-line-strong">
          <div class="flex items-start justify-between gap-3"><div class="flex items-center gap-3">${traderAvatar(t, 44)}<div><p class="font-display font-bold text-white">${t.displayName}</p><p class="text-xs text-dim">${t.strategy}</p></div></div>${riskBadge(t.riskLevel)}</div>
          <div class="mt-4 flex items-end justify-between"><div><p class="text-[11px] font-semibold tracking-wide text-dim uppercase">${label} signal return</p><p class="num font-display text-2xl font-extrabold ${ret === null ? "text-dim" : ret >= 0 ? "text-up" : "text-down"}">${ret === null ? "—" : formatPercent(ret)}</p></div>${sparkline(s.sparkline, 120, 40)}</div>
          <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-4 text-xs">
            ${stat("target", "Win rate", s.winRatePct === null ? "—" : `${s.winRatePct.toFixed(0)}%`)}${stat("activity", "Signals", s.totalSignals.toLocaleString())}${stat("users", "Followers", s.activeFollowers.toLocaleString())}${stat("radio", "Open now", s.openSignals.toLocaleString())}
          </dl>
          <div class="mt-4 flex flex-wrap items-center gap-1.5">${t.assets.slice(0, 4).map((a) => html`<span class="rounded bg-panel-3 px-1.5 py-0.5 text-[10px] font-semibold text-muted">${a}</span>`)}${t.copyEnabled ? "" : html`<span class="ml-auto text-[11px] text-warn">Not accepting new copiers</span>`}</div>
        </a>`;
      }),
    );
  };

  const load = async () => {
    const qs = new URLSearchParams(Object.entries({ risk: f.risk, strategy: f.strategy, asset: f.asset }).filter(([, v]) => v)).toString();
    try {
      list = await api(`/api/copy-trading/traders${qs ? `?${qs}` : ""}`, { allowAnonymous: true });
      draw();
    } catch (err) {
      mount($("[data-grid]", el), html`<div class="md:col-span-2 xl:col-span-3">${errorState({ message: err.message, retry: false })}</div>`);
    }
  };

  api("/api/copy-trading/traders", { allowAnonymous: true })
    .then((all) => {
      const tags = [...new Set(all.flatMap((t) => t.strategyTags))].sort();
      const assets = [...new Set(all.flatMap((t) => t.assets))].sort();
      $('[data-f="strategy"]', el).insertAdjacentHTML("beforeend", String(html`${tags.map((t) => html`<option>${t}</option>`)}`));
      $('[data-f="asset"]', el).insertAdjacentHTML("beforeend", String(html`${assets.map((a) => html`<option>${a}</option>`)}`));
      list = all;
      draw();
    })
    .catch((err) => mount($("[data-grid]", el), errorState({ message: err.message, retry: false })));

  on(el, "change", "[data-f]", (_e, s) => {
    f[s.dataset.f] = s.value;
    void load();
  });
  on(el, "click", "[data-period]", (_e, b) => {
    f.period = b.dataset.period;
    drawPeriods();
    draw();
  });
}
