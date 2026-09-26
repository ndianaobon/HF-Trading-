import { html, $, mount } from "../core/dom.js";
import { api } from "../core/api.js";
import { initSite } from "../core/site.js";
import { errorState } from "../core/ui.js";
import { formatNumber } from "../core/format.js";

initSite();

const pct = (v) => `${(Number(v) * 100).toFixed(2)}%`;

api("/api/public/fees", { allowAnonymous: true })
  .then((d) => {
    $('[data-fee="maker"]').textContent = pct(d.trading.maker);
    $('[data-fee="taker"]').textContent = pct(d.trading.taker);
    mount(
      $("[data-networks]"),
      html`<table class="table min-w-[640px]"><thead><tr><th>Asset</th><th>Network</th><th class="r">Min. deposit</th><th class="r">Min. withdrawal</th><th class="r">Withdrawal fee</th><th class="r">Confirmations</th></tr></thead>
      <tbody>${d.networks.map((n) => html`<tr><td class="font-semibold text-white">${n.asset}</td><td class="text-muted">${n.name}</td><td class="num r">${formatNumber(n.minDeposit)}</td><td class="num r">${formatNumber(n.minWithdrawal)}</td><td class="num r">${formatNumber(n.withdrawalFee)} ${n.asset}</td><td class="num r">${n.confirmations}</td></tr>`)}</tbody></table>`,
    );
    mount(
      $("[data-plans]"),
      html`<table class="table min-w-[560px]"><thead><tr><th>Plan</th><th class="r">Management / yr</th><th class="r">Performance</th><th class="r">Early exit</th></tr></thead>
      <tbody>${d.plans.map((p) => html`<tr><td class="font-semibold text-white">${p.name}</td><td class="num r">${Number(p.managementFeePct)}%</td><td class="num r">${Number(p.performanceFeePct)}% of positive P&amp;L</td><td class="num r">${p.earlyExitAllowed ? `${Number(p.earlyExitFeePct)}%` : "Not permitted"}</td></tr>`)}</tbody></table>`,
    );
  })
  .catch((err) => mount($("#fees-root"), errorState({ message: err.message, retry: false })));
