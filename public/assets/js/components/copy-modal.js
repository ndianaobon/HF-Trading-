// "Copy trader" configuration dialog: allocation, maximum allocation and stop-copy threshold.
import { html, $ } from "../core/dom.js";
import { api } from "../core/api.js";
import { invalidate } from "../core/store.js";
import { openModal, toast, notice } from "../core/ui.js";
import { field, bindForm, rules } from "../core/forms.js";
import { formatNumber, toNum } from "../core/format.js";

export async function openCopyModal(trader) {
  const wallets = await api("/api/wallets").catch(() => []);
  const usdt = toNum(wallets.find((w) => w.symbol === "USDT")?.available);
  const min = Number(trader.minAllocation);
  const m = openModal({
    title: `Copy ${trader.displayName}`,
    description: "Configure how much to allocate and when copying should stop.",
    body: html`<form id="copy-form" class="space-y-4" novalidate>
      ${trader.isDemo ? notice("warn", { title: "Demo trader", body: "This profile uses illustrative demo statistics. Allocations are simulated and no trades are mirrored to your account." }) : ""}
      <div class="flex justify-end text-xs text-dim">Available: ${formatNumber(usdt, 2)} USDT</div>
      ${field({ name: "allocation", label: "Allocation amount", value: String(min), suffix: "USDT", inputmode: "decimal" })}
      ${field({ name: "maxAllocation", label: "Maximum allocation", value: String(min * 2), suffix: "USDT", inputmode: "decimal", hint: "The most this copy relationship may ever use, including future top-ups." })}
      ${field({ name: "stopLossPct", label: "Stop-copy threshold", value: "20", suffix: "%", type: "number", hint: "Copying stops automatically if the allocation falls by this percentage." })}
      <p class="text-xs leading-relaxed text-dim">Past performance does not predict future results. Copy trading can lose money, including more quickly than you expect. Minimum allocation for this trader is ${formatNumber(min, 0)} USDT.</p>
      <div data-form-error hidden></div>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="copy-form" class="btn btn-primary">Confirm &amp; start copying</button>`,
  });
  const form = $("#copy-form", m.el);
  bindForm(
    form,
    {
      allocation: [rules.decimal("Allocation"), (v) => (Number(v) < min ? `Minimum allocation is ${min} USDT` : Number(v) > usdt ? "Exceeds your available USDT balance" : null)],
      maxAllocation: [rules.decimal("Maximum allocation"), (v, all) => (Number(v) < Number(all.allocation) ? "Must be at least the allocation" : null)],
      stopLossPct: [(v) => (Number(v) >= 5 && Number(v) <= 90 ? null : "Choose between 5% and 90%")],
    },
    async (v) => {
      await api("/api/copy-trading/subscriptions", { body: { traderId: trader.id, allocation: v.allocation, maxAllocation: v.maxAllocation, stopLossPct: Number(v.stopLossPct) } });
      toast.success(`Now copying ${trader.displayName}`, `${v.allocation} USDT allocated.`);
      ["/api/copy-trading", "/api/wallets", "/api/portfolio"].forEach(invalidate);
      m.close();
    },
  );
}
