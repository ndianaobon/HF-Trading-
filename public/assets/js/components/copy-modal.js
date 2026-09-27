// "Start copying" dialog: copy amount, amount per trade and stop-copy threshold.
import { html, $ } from "../core/dom.js";
import { api } from "../core/api.js";
import { invalidate } from "../core/store.js";
import { openModal, toast } from "../core/ui.js";
import { field, bindForm, rules } from "../core/forms.js";
import { formatNumber, toNum } from "../core/format.js";
import { RISK_NOTE } from "./copy-bits.js";

export async function openCopyModal(trader, { onDone } = {}) {
  const wallets = await api("/api/wallets").catch(() => []);
  const usdt = toNum(wallets.find((w) => w.symbol === "USDT")?.available);
  const min = toNum(trader.minAllocation);
  const max = trader.maxAllocation ? toNum(trader.maxAllocation) : null;
  const m = openModal({
    title: `Copy ${trader.displayName}`,
    description: "Each signal from this trader opens a trade in your account using your own balance.",
    body: html`<form id="copy-form" class="space-y-4" novalidate>
      <div class="flex justify-end text-xs text-dim">Available: ${formatNumber(usdt, 2)} USDT</div>
      ${field({ name: "allocation", label: "Copy amount", value: String(min), suffix: "USDT", inputmode: "decimal", hint: `The most this trader's copied positions may use at one time. ${max ? `Between ${formatNumber(min, 2)} and ${formatNumber(max, 2)} USDT.` : `At least ${formatNumber(min, 2)} USDT.`}` })}
      ${field({ name: "amountPerTrade", label: "Amount per trade", value: String(Math.max(10, Math.round(min / 10))), suffix: "USDT", inputmode: "decimal", hint: "Size of each copied position. Some signals use a larger or smaller multiple of this." })}
      ${field({ name: "stopLossPct", label: "Stop-copy threshold", value: "20", suffix: "%", type: "number", hint: "Copying stops and open copy positions close if your losses from this trader reach this share of your copy amount." })}
      <p class="text-xs leading-relaxed text-dim">${RISK_NOTE} Funds stay in your USDT wallet until a signal executes.</p>
      <div data-form-error hidden></div>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="copy-form" class="btn btn-primary">Start copying</button>`,
  });
  bindForm(
    $("#copy-form", m.el),
    {
      allocation: [rules.decimal("Copy amount"), (v) => (toNum(v) < min ? `The minimum is ${min} USDT` : max && toNum(v) > max ? `The maximum is ${max} USDT` : null)],
      amountPerTrade: [
        rules.decimal("Amount per trade"),
        (v, all) => (toNum(v) > toNum(all.allocation) ? "Must not be more than the copy amount" : toNum(v) > usdt ? "More than your available USDT balance" : null),
      ],
      stopLossPct: [(v) => (Number(v) >= 5 && Number(v) <= 90 ? null : "Choose between 5% and 90%")],
    },
    async (v) => {
      await api("/api/copy-trading/subscriptions", { body: { traderId: trader.id, allocation: v.allocation, amountPerTrade: v.amountPerTrade, stopLossPct: Number(v.stopLossPct) } });
      toast.success(`Now copying ${trader.displayName}`, "New signals will be copied to your account.");
      invalidate("/api/copy-trading");
      m.close();
      onDone?.();
    },
  );
}
