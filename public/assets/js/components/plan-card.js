import { html } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { formatNumber, formatDuration } from "../core/format.js";

const usd = (v) => `$${formatNumber(v, 0)}`;

/** Features included with each plan, keyed by plan slug. */
export const PLAN_FEATURES = {
  basic: ["Full Analysis"],
  silver: ["Full Analysis", "Premium Signals", "Personal Manager"],
  gold: ["Full Analysis", "Premium Signals", "Personal Manager", "Signal Access"],
  platinum: ["Full Analysis", "Premium Signals", "Personal Manager", "Signal Access", "Priority Support", "Advanced Analytics"],
};

/** Investment plan card. Never shows projected or guaranteed returns. */
export function planCard(plan, action) {
  return html`<article id="${plan.slug}" class="flex scroll-mt-24 flex-col rounded-2xl border border-line bg-panel p-6">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-xs font-bold tracking-[0.2em] text-accent uppercase">Minimum funding</p>
        <p class="num mt-2 font-display text-4xl font-extrabold text-white">${usd(plan.minAllocation)}</p>
        <h3 class="mt-2 font-display text-xl font-extrabold text-white">${plan.name}</h3>
      </div>
      <span class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-up/25 bg-up-soft px-2.5 py-1 text-xs font-semibold text-up">${icon("badge-check", "h-3.5 w-3.5")} Verified</span>
    </div>
    <ul class="mt-6 space-y-3 text-sm">
      <li class="flex items-center justify-between gap-3 rounded-xl border border-line bg-base-2 p-3"><span class="flex items-center gap-2 text-dim">${icon("wallet", "h-4 w-4")} Min. Deposit</span><span class="num font-semibold text-white">${usd(plan.minAllocation)}</span></li>
      <li class="flex items-center justify-between gap-3 rounded-xl border border-line bg-base-2 p-3"><span class="flex items-center gap-2 text-dim">${icon("wallet", "h-4 w-4")} Max. Deposit</span><span class="num font-semibold text-white">${usd(plan.maxAllocation)}</span></li>
      <li class="flex items-center justify-between gap-3 rounded-xl border border-line bg-base-2 p-3"><span class="flex items-center gap-2 text-dim">${icon("clock", "h-4 w-4")} Duration</span><span class="font-semibold text-white">${formatDuration(plan.durationDays)}</span></li>
    </ul>
    <div class="mt-5 space-y-3 text-sm leading-relaxed">
      <p class="font-semibold text-white">${plan.tagline}</p>
      <p class="text-muted">${plan.description}</p>
    </div>
    <ul class="mt-5 space-y-2.5 text-sm">
      ${(PLAN_FEATURES[plan.slug] ?? ["Full Analysis"]).map((f) => html`<li class="flex items-center gap-2 text-white">${icon("circle-check", "h-4 w-4 shrink-0 text-accent")} ${f}</li>`)}
    </ul>
    ${action ? html`<div class="mt-auto pt-6">${action}</div>` : ""}
  </article>`;
}
