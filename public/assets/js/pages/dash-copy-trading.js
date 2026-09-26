import { html, $, on, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { initApp } from "../core/app-shell.js";
import { card, emptyState, pageHeader, smallDemo, statusBadge, riskBadge, avatar, toast, openModal, confirmDialog, DataTable } from "../core/ui.js";
import { field, bindForm, rules } from "../core/forms.js";
import { formatDate, formatNumber, formatUsd, toNum } from "../core/format.js";
import { mountTraderDirectory } from "../components/trader-directory.js";

await initApp();
const view = $("#view");
view.removeAttribute("aria-busy");

mount(
  view,
  html`${pageHeader({ title: "Copy Trading", description: "Manage the traders you copy and discover new strategies." })}
    ${card({ title: "Traders you copy", description: html`<span data-desc>Loading…</span>`, body: html`<div class="border-t border-line" data-table></div><p class="border-t border-line px-5 py-3 text-xs text-dim" data-demo-note hidden>Demo copy relationships are simulated: no trades are mirrored and P&amp;L stays at zero unless recorded by an administrator.</p>` })}
    <h2 class="mt-8 mb-4 font-display text-lg font-bold text-white">Discover traders</h2>
    <div data-directory></div>`,
);

let subs = [];
const refresh = () => ["/api/copy-trading", "/api/wallets", "/api/portfolio", "/api/transactions"].forEach(invalidate);
const pnlTone = (v) => (toNum(v) > 0 ? "text-up" : toNum(v) < 0 ? "text-down" : "text-muted");

const table = new DataTable($("[data-table]", view), {
  rowClass: (s) => (s.status === "STOPPED" ? "opacity-60" : ""),
  empty: emptyState({ title: "You're not copying anyone yet", description: "Browse traders below and review their strategy and risk before copying." }),
  columns: [
    {
      key: "trader",
      header: "Trader",
      cell: (s) =>
        html`<a href="/dashboard/copy-trading/${s.trader.slug}" class="flex items-center gap-3">${avatar(s.trader.displayName, s.trader.avatarColor, 32)}<span><span class="flex items-center gap-2 font-semibold text-white">${s.trader.displayName} ${s.isDemo ? smallDemo() : ""}</span><span class="block text-xs text-dim">${s.trader.strategy}</span></span></a>`,
    },
    { key: "risk", header: "Risk", hideOnMobile: true, cell: (s) => riskBadge(s.trader.riskLevel) },
    { key: "alloc", header: "Allocation", align: "right", cell: (s) => html`<span class="num">${formatNumber(s.allocation, 2)} <span class="text-dim">/ ${formatNumber(s.maxAllocation, 0)}</span></span>` },
    { key: "sl", header: "Stop-copy", align: "right", hideOnMobile: true, cell: (s) => html`<span class="num text-muted">−${Number(s.stopLossPct)}%</span>` },
    { key: "pnl", header: "P&L", align: "right", cell: (s) => html`<span class="num font-semibold ${pnlTone(s.pnl)}">${formatUsd(s.pnl, { sign: true })}</span>` },
    { key: "since", header: "Since", hideOnMobile: true, cell: (s) => html`<span class="text-xs text-muted">${formatDate(s.startedAt, "date")}</span>` },
    { key: "status", header: "Status", cell: (s) => statusBadge(s.status) },
    {
      key: "act",
      header: html`<span class="sr-only">Actions</span>`,
      align: "right",
      cell: (s) =>
        s.status === "STOPPED"
          ? ""
          : html`<div class="flex justify-end gap-1">
              ${s.status === "ACTIVE"
                ? html`<button type="button" class="btn btn-ghost btn-icon" aria-label="Pause copying" title="Pause" data-status="PAUSED" data-id="${s.id}">${icon("pause", "h-4 w-4")}</button>`
                : html`<button type="button" class="btn btn-ghost btn-icon" aria-label="Resume copying" title="Resume" data-status="ACTIVE" data-id="${s.id}">${icon("play", "h-4 w-4")}</button>`}
              <button type="button" class="btn btn-ghost btn-icon" aria-label="Edit settings" title="Settings" data-edit="${s.id}">${icon("sliders-horizontal", "h-4 w-4")}</button>
              <button type="button" class="btn btn-ghost btn-icon" aria-label="Stop copying" title="Stop" data-stop="${s.id}">${icon("square", "h-4 w-4 text-down")}</button>
            </div>`,
    },
  ],
});
table.set(undefined, { loading: true });

watch("/api/copy-trading/subscriptions", ({ data, error }) => {
  if (!data) return error && table.set(undefined, { error });
  subs = data;
  const active = data.filter((s) => s.status !== "STOPPED");
  const stopped = data.filter((s) => s.status === "STOPPED");
  $("[data-desc]", view).textContent = `${active.length} active · ${formatUsd(active.reduce((s, r) => s + toNum(r.allocation), 0))} allocated`;
  $("[data-demo-note]", view).hidden = !active.some((r) => r.isDemo);
  table.set([...active, ...stopped]);
});

const find = (id) => subs.find((s) => s.id === id);

on(view, "click", "[data-status][data-id]", async (_e, b) => {
  b.disabled = true;
  try {
    await api(`/api/copy-trading/subscriptions/${b.dataset.id}`, { method: "PATCH", body: { status: b.dataset.status } });
    toast.success(b.dataset.status === "PAUSED" ? "Copying paused" : "Copying resumed");
    refresh();
  } catch (err) {
    b.disabled = false;
    toast.error("Could not update", err.message);
  }
});

on(view, "click", "[data-edit]", (_e, b) => {
  const s = find(b.dataset.edit);
  if (!s) return;
  const m = openModal({
    title: "Copy settings",
    description: s.trader.displayName,
    body: html`<form id="copy-edit" class="space-y-4" novalidate>
      ${field({ name: "maxAllocation", label: "Maximum allocation", inputmode: "decimal", suffix: "USDT", value: String(Number(s.maxAllocation)) })}
      ${field({ name: "stopLossPct", label: "Stop-copy threshold", type: "number", suffix: "%", value: String(Number(s.stopLossPct)), hint: "Between 5% and 90% drawdown", attrs: html`min="5" max="90"` })}
      <div data-form-error hidden></div>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="copy-edit" class="btn btn-primary">Save</button>`,
  });
  bindForm(
    $("#copy-edit", m.el),
    {
      maxAllocation: [rules.decimal("Maximum allocation"), (v) => (toNum(v) < toNum(s.allocation) ? "Must be at least the current allocation" : null)],
      stopLossPct: [(v) => (Number(v) >= 5 && Number(v) <= 90 ? null : "Enter a value between 5 and 90")],
    },
    async (v) => {
      await api(`/api/copy-trading/subscriptions/${s.id}`, { method: "PATCH", body: { maxAllocation: v.maxAllocation, stopLossPct: Number(v.stopLossPct) } });
      toast.success("Settings updated");
      m.close();
      refresh();
    },
  );
});

on(view, "click", "[data-stop]", async (_e, b) => {
  const s = find(b.dataset.stop);
  if (!s) return;
  const ok = await confirmDialog({
    title: "Stop copying?",
    message: `Your ${formatNumber(s.allocation, 2)} USDT allocation${toNum(s.pnl) !== 0 ? ` and recorded P&L of ${formatUsd(s.pnl, { sign: true })}` : ""} will be returned to your USDT wallet.`,
    confirmLabel: "Stop copying",
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/copy-trading/subscriptions/${s.id}`, { method: "DELETE" });
    toast.success(`Stopped copying ${s.trader.displayName}`, "Your allocation has been returned to your wallet.");
    refresh();
  } catch (err) {
    toast.error("Could not stop copying", err.message);
  }
});

mountTraderDirectory($("[data-directory]", view), { profileBase: "/dashboard/copy-trading" });
