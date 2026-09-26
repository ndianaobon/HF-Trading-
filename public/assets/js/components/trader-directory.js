// Copy-trader directory with risk/strategy/asset filters and return period.
import { html, $, on, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { segmented, riskBadge, demoBadge, avatar, sparkline, skeleton, emptyState, errorState } from "../core/ui.js";
import { formatCompact, formatPercent } from "../core/format.js";

const PERIODS = [
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "180d", label: "180D" },
  { value: "1y", label: "1Y" },
];

export function mountTraderDirectory(el, { profileBase }) {
  const f = { risk: "", strategy: "", asset: "", period: "90d" };
  let all = [];
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
      <p class="mt-4 text-xs text-warn" data-demo-note hidden>Profiles marked “Demo statistics” show illustrative data for the development environment and are not real trading records.</p>
      <div class="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-grid>${Array.from({ length: 6 }, () => skeleton("h-72 rounded-2xl"))}</div>`,
  );

  const drawPeriods = () => mount($("[data-periods]", el), segmented(PERIODS, f.period, { name: "period" }));
  drawPeriods();

  const stat = (ic, label, value) => html`<div class="flex items-center justify-between gap-2"><dt class="flex items-center gap-1.5 text-dim">${icon(ic, "h-3.5 w-3.5")} ${label}</dt><dd class="num font-semibold text-fg">${value}</dd></div>`;

  const draw = () => {
    const grid = $("[data-grid]", el);
    if (!list) return;
    $("[data-demo-note]", el).hidden = !list.some((t) => t.isDemo);
    if (!list.length) return mount(grid, html`<div class="md:col-span-2 xl:col-span-3">${emptyState({ title: "No traders match these filters", description: "Try widening the risk level or strategy." })}</div>`);
    const sorted = [...list].sort((a, b) => (b.returns[f.period] ?? -Infinity) - (a.returns[f.period] ?? -Infinity));
    mount(
      grid,
      sorted.map((t) => {
        const ret = t.returns[f.period];
        return html`<a href="${profileBase}/${t.slug}" class="group flex flex-col rounded-2xl border border-line bg-panel p-5 transition-all hover:-translate-y-0.5 hover:border-line-strong">
          <div class="flex items-start justify-between gap-3"><div class="flex items-center gap-3">${avatar(t.displayName, t.avatarColor, 44)}<div><p class="font-display font-bold text-white">${t.displayName}</p><p class="text-xs text-dim">${t.strategy}</p></div></div>${riskBadge(t.riskLevel)}</div>
          <div class="mt-4 flex items-end justify-between"><div><p class="text-[11px] font-semibold tracking-wide text-dim uppercase">${f.period} return</p><p class="num font-display text-2xl font-extrabold ${ret === undefined ? "text-dim" : ret >= 0 ? "text-up" : "text-down"}">${ret === undefined ? "—" : formatPercent(ret)}</p></div>${sparkline(t.sparkline, 120, 40)}</div>
          <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-4 text-xs">
            ${stat("wallet", "AUM", `$${formatCompact(t.aum)}`)}${stat("trending-down", "Max drawdown", `${Number(t.maxDrawdownPct).toFixed(1)}%`)}${stat("users", "Followers", t.followers.toLocaleString())}${stat("activity", "Trades / week", Number(t.tradesPerWeek).toFixed(1))}
          </dl>
          <div class="mt-4 flex flex-wrap items-center gap-1.5">${t.assets.slice(0, 4).map((a) => html`<span class="rounded bg-panel-3 px-1.5 py-0.5 text-[10px] font-semibold text-muted">${a}</span>`)}${t.isDemo ? demoBadge("Demo statistics", "ml-auto") : ""}</div>
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
    .then((data) => {
      all = data;
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
