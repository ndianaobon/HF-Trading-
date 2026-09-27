// Admin → Copy Trading: lead traders, signals, followers, copy trades and
// performance. Every performance figure is calculated server-side from
// recorded signals and executed copy trades; none can be typed in here.
import { html, $, on, mount, param } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, get, invalidate } from "../core/store.js";
import { card, pageHeader, riskBadge, stat, notice, toast, openModal, confirmDialog, tabs, segmented, skeleton, emptyState, DataTable, smallSim } from "../core/ui.js";
import { field, selectField, textareaField, checkboxField, bindForm, rules } from "../core/forms.js";
import { formatDate, formatNumber, formatPrice, formatUsd, titleCase, toNum } from "../core/format.js";
import { adminPage, adminTable, actionModal } from "../components/admin-kit.js";
import { traderAvatar, traderStatusBadge, signalStatusBadge, copyStatusBadge, sideLabel, pair, pnlCell, pctCell, priceCell, closeReason, tone } from "../components/copy-bits.js";

const { view } = await adminPage();

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "traders", label: "Lead Traders" },
  { value: "signals", label: "Signals" },
  { value: "followers", label: "Followers" },
  { value: "trades", label: "Copy Trades" },
];
let tab = TABS.some((t) => t.value === param("tab")) ? param("tab") : "overview";
let traders = [];

mount(
  view,
  html`${pageHeader({
      title: "Copy Trading",
      description: "Lead traders and their signals are created here. Results are calculated from executed trades at market prices.",
      actions: html`<button type="button" class="btn btn-secondary" data-new-trader>${icon("user-plus", "h-4 w-4")} Add lead trader</button><button type="button" class="btn btn-primary" data-new-signal>${icon("radio", "h-4 w-4")} Create signal</button>`,
    })}
    <div class="mb-5 overflow-x-auto" data-tabs></div>
    <div data-panel></div>`,
);

const refreshAll = () => ["/api/admin/copy-"].forEach(invalidate);
const loadTraders = () => get("/api/admin/copy-traders", { maxAge: 0 }).then((d) => (traders = d));
const traderOptions = (all = "All lead traders") => [["", all], ...traders.map((t) => [t.id, t.displayName])];

function show(next, extra = {}) {
  tab = next;
  const qs = new URLSearchParams({ tab, ...extra });
  history.replaceState(null, "", `${location.pathname}?${qs}`);
  mount($("[data-tabs]", view), tabs(TABS, tab, { name: "tab" }));
  // A fresh container per tab: watchers from the previous tab only touch detached nodes.
  const host = $("[data-panel]", view);
  const panel = document.createElement("div");
  host.replaceChildren(panel);
  mount(panel, skeleton("h-96 rounded-2xl"));
  ({ overview, traders: traderPanel, signals: signalPanel, followers: followerPanel, trades: tradePanel })[tab](panel);
}

/* ───────────────────────────── Overview ───────────────────────────── */

function overview(panel) {
  mount(
    panel,
    html`<div class="grid grid-cols-2 gap-3 lg:grid-cols-4" data-kpis>${Array.from({ length: 8 }, () => skeleton("h-28 rounded-2xl"))}</div>
      ${card({ title: "Lead trader performance", description: "Calculated from each trader's signals and the copy trades they produced", cls: "mt-6", body: html`<div data-perf></div>` })}`,
  );
  watch("/api/admin/copy-overview", ({ data }) => {
    if (!data) return;
    const n = (o, k) => (o[k] ?? 0).toLocaleString();
    mount(
      $("[data-kpis]", panel),
      html`${stat({ label: "Lead traders", value: n(data.traders, "ACTIVE"), sub: `${n(data.traders, "INACTIVE")} inactive · ${n(data.traders, "SUSPENDED")} suspended`, iconName: "user-square-2" })}
        ${stat({ label: "Open signals", value: (data.signals.EXECUTED ?? 0) + (data.signals.ACTIVE ?? 0), sub: `${n(data.signals, "ACTIVE")} awaiting entry · ${n(data.signals, "CREATED")} drafts`, iconName: "radio" })}
        ${stat({ label: "Closed signals", value: n(data.signals, "CLOSED"), sub: `${n(data.signals, "CANCELLED")} cancelled`, iconName: "check-circle-2" })}
        ${stat({ label: "Active followers", value: n(data.followers, "ACTIVE"), sub: `${n(data.followers, "PAUSED")} paused · ${n(data.followers, "SUSPENDED")} suspended`, iconName: "users" })}
        ${stat({ label: "Open copy trades", value: n(data.trades, "OPEN"), sub: `${n(data.trades, "PENDING")} pending`, iconName: "activity" })}
        ${stat({ label: "Closed copy trades", value: n(data.trades, "CLOSED"), sub: html`<span class="text-up">${n(data.trades, "PROFIT")} profitable</span> · <span class="text-down">${n(data.trades, "LOSS")} loss</span>`, iconName: "history" })}
        ${stat({ label: "Failed copies", value: n(data.trades, "FAILED"), sub: "Not opened (balance, limits…)", iconName: "alert-triangle" })}
        ${stat({ label: "Followers' realised P&L", value: html`<span class="${tone(data.realizedPnl)}">${formatUsd(data.realizedPnl, { sign: true })}</span>`, sub: "Net of fees", iconName: "wallet" })}`,
    );
  });
  const table = new DataTable($("[data-perf]", panel), {
    empty: emptyState({ title: "No lead traders yet", description: "Add a lead trader to get started.", iconName: "user-plus" }),
    columns: [
      { key: "t", header: "Lead trader", cell: (t) => html`<span class="flex items-center gap-2">${traderAvatar(t, 28)}<span class="font-semibold text-white">${t.displayName}</span></span>` },
      { key: "total", header: "Signals", align: "right", sortValue: (t) => t.stats.totalSignals, cell: (t) => t.stats.totalSignals },
      { key: "open", header: "Open", align: "right", cell: (t) => t.stats.openSignals + t.stats.pendingSignals },
      { key: "closed", header: "Closed", align: "right", cell: (t) => t.stats.closedSignals },
      { key: "win", header: "Won", align: "right", cell: (t) => html`<span class="text-up">${t.stats.winningSignals}</span>` },
      { key: "loss", header: "Lost", align: "right", cell: (t) => html`<span class="text-down">${t.stats.losingSignals}</span>` },
      { key: "ret", header: "Return", align: "right", hideOnMobile: true, sortValue: (t) => t.stats.totalReturnPct, cell: (t) => pctCell(t.stats.totalReturnPct) },
      { key: "f", header: "Followers", align: "right", cell: (t) => html`<span class="num">${t.stats.activeFollowers} <span class="text-dim">/ ${t.stats.followers}</span></span>` },
      { key: "ct", header: "Copied trades", align: "right", hideOnMobile: true, cell: (t) => t.stats.copyTrades },
      { key: "pnl", header: "Total P&L", align: "right", sortValue: (t) => t.stats.realizedPnl, cell: (t) => pnlCell(t.stats.realizedPnl) },
    ],
  });
  table.set(undefined, { loading: true });
  watch("/api/admin/copy-traders", ({ data, error }) => {
    if (!data) return error && table.set(undefined, { error });
    traders = data;
    table.set(data);
  });
}

/* ───────────────────────────── Lead traders ───────────────────────────── */

function traderPanel(panel) {
  const filter = { status: param("status") ?? "" };
  mount(panel, html`<div class="mb-4" data-seg></div>${card({ body: html`<div data-table></div>` })}`);
  const seg = () =>
    mount(
      $("[data-seg]", panel),
      segmented(
        [
          { value: "", label: "All" },
          { value: "ACTIVE", label: "Active" },
          { value: "INACTIVE", label: "Inactive" },
          { value: "SUSPENDED", label: "Suspended" },
        ],
        filter.status,
        { name: "tstatus", size: "sm" },
      ),
    );
  seg();
  const table = new DataTable($("[data-table]", panel), {
    empty: emptyState({ title: "No lead traders here", iconName: "user-square-2" }),
    columns: [
      {
        key: "n",
        header: "Lead trader",
        cell: (t) => html`<span class="flex items-center gap-2.5">${traderAvatar(t, 34)}<span><span class="block font-semibold text-white">${t.displayName}</span><span class="block text-xs text-dim">${t.strategy}</span></span></span>`,
      },
      { key: "st", header: "Status", cell: (t) => traderStatusBadge(t.status) },
      { key: "r", header: "Risk", hideOnMobile: true, cell: (t) => riskBadge(t.riskLevel) },
      { key: "a", header: "Copy amount", align: "right", hideOnMobile: true, cell: (t) => html`<span class="num text-xs">${formatNumber(t.minAllocation, 2)} – ${t.maxAllocation ? formatNumber(t.maxAllocation, 2) : "∞"}</span>` },
      { key: "f", header: "Followers", align: "right", cell: (t) => t.stats.activeFollowers },
      { key: "s", header: "Signals", align: "right", hideOnMobile: true, cell: (t) => t.stats.totalSignals },
      {
        key: "c",
        header: "New copiers",
        align: "center",
        cell: (t) => html`<button type="button" role="switch" class="switch" aria-label="Accepting new copiers" aria-checked="${t.copyEnabled ? "true" : "false"}" data-copy-toggle="${t.id}"></button>`,
      },
      {
        key: "x",
        header: html`<span class="sr-only">Actions</span>`,
        align: "right",
        cell: (t) => html`<div class="flex justify-end gap-1">
          <button type="button" class="btn btn-ghost btn-sm" data-signal-for="${t.id}" title="Create signal">${icon("radio", "h-4 w-4")}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-edit-trader="${t.id}">${icon("pencil", "h-4 w-4")} Edit</button>
        </div>`,
      },
    ],
  });
  table.set(undefined, { loading: true });
  let all = [];
  const draw = () => table.set(all.filter((t) => !filter.status || t.status === filter.status));
  watch("/api/admin/copy-traders", ({ data, error }) => {
    if (!data) return error && table.set(undefined, { error });
    traders = all = data;
    draw();
  });
  on(panel, "click", "[data-tstatus]", (_e, b) => {
    filter.status = b.dataset.tstatus;
    seg();
    draw();
  });
}

on(view, "click", "[data-copy-toggle]", async (_e, b) => {
  const t = traders.find((x) => x.id === b.dataset.copyToggle);
  if (!t) return;
  b.disabled = true;
  try {
    await api(`/api/admin/copy-traders/${t.id}`, { method: "PATCH", body: { copyEnabled: !t.copyEnabled } });
    toast.success(t.copyEnabled ? "New copiers paused" : "Accepting new copiers", t.displayName);
  } catch (err) {
    toast.error("Update failed", err.message);
  }
  refreshAll();
});

on(view, "click", "[data-new-trader]", () => traderForm(null));
on(view, "click", "[data-edit-trader]", (_e, b) => traderForm(traders.find((t) => t.id === b.dataset.editTrader)));

function traderForm(t) {
  const editing = !!t;
  const m = openModal({
    title: editing ? `Edit ${t.displayName}` : "Add lead trader",
    description: editing ? "Changes apply immediately. Performance cannot be edited: it is calculated from signals." : "The profile is visible to users once its status is Active.",
    size: "lg",
    body: html`<form id="trader-form" class="grid gap-4 sm:grid-cols-2" novalidate>
      <div class="flex items-center gap-4 sm:col-span-2">
        <span data-avatar>${traderAvatar(t ?? { displayName: "New trader", avatarColor: "#F4BE2C" }, 56)}</span>
        <div class="field flex-1"><label class="label" for="f-avatar">Profile image</label><input id="f-avatar" name="avatar" type="file" accept="image/png,image/jpeg,image/webp" class="input py-2 text-sm" /><p class="hint">JPG, PNG or WEBP, up to 2 MB.${editing && t.avatarUrl ? html` <button type="button" class="font-semibold text-down" data-remove-avatar>Remove image</button>` : ""}</p></div>
      </div>
      ${field({ name: "displayName", label: "Trader name", value: t?.displayName ?? "" })}
      ${field({ name: "slug", label: "Profile address", value: t?.slug ?? "", hint: "Lowercase letters, numbers and hyphens, e.g. john-trader" })}
      ${field({ name: "strategy", label: "Trading strategy", value: t?.strategy ?? "", placeholder: "e.g. Swing trading majors" })}
      ${selectField({ name: "riskLevel", label: "Risk level", value: t?.riskLevel ?? "MEDIUM", options: ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"].map((r) => [r, titleCase(r)]) })}
      ${field({ name: "assets", label: "Supported instruments", value: t?.assets.join(", ") ?? "", placeholder: "BTC, ETH, SOL", hint: "Comma separated" })}
      ${field({ name: "strategyTags", label: "Strategy tags", value: t?.strategyTags.join(", ") ?? "", placeholder: "Trend, Swing", hint: "Comma separated, up to 6" })}
      ${field({ name: "minAllocation", label: "Minimum copy amount", value: t ? String(toNum(t.minAllocation)) : "100", suffix: "USDT", inputmode: "decimal" })}
      ${field({ name: "maxAllocation", label: "Maximum copy amount", value: t?.maxAllocation ? String(toNum(t.maxAllocation)) : "", suffix: "USDT", inputmode: "decimal", placeholder: "No limit" })}
      ${selectField({ name: "status", label: "Status", value: t?.status ?? "INACTIVE", options: [["ACTIVE", "Active — visible and copyable"], ["INACTIVE", "Inactive — hidden from users"], ["SUSPENDED", "Suspended — visible, no new signals execute"]] })}
      <div class="flex items-end pb-2">${checkboxField({ name: "copyEnabled", label: "Users can start copying this trader", checked: t?.copyEnabled ?? true })}</div>
      ${textareaField({ name: "bio", label: "Description", rows: 4, value: t?.bio ?? "", cls: "sm:col-span-2", placeholder: "Trading approach, typical holding period, how risk is managed…" })}
      ${editing ? html`<div class="rounded-xl border border-down/30 p-4 sm:col-span-2"><p class="text-sm font-semibold text-white">Remove lead trader</p><p class="mt-1 text-xs text-muted">Stops all followers (closing their copy positions at market) and hides the profile. Signal and trade history is kept.</p><button type="button" class="btn btn-danger btn-sm mt-3" data-remove-trader>Remove ${t.displayName}</button></div>` : ""}
      <div class="sm:col-span-2" data-form-error hidden></div>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="trader-form" class="btn btn-primary">${editing ? "Save changes" : "Add lead trader"}</button>`,
  });
  const form = $("#trader-form", m.el);
  const list = (s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  if (!editing) {
    form.displayName.addEventListener("input", () => {
      if (form.slug.dataset.touched) return;
      form.slug.value = form.displayName.value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
    });
    form.slug.addEventListener("input", () => (form.slug.dataset.touched = "1"));
  }
  bindForm(
    form,
    {
      displayName: [rules.min(2, "Name is too short")],
      slug: [rules.required("Profile address"), rules.pattern(/^[a-z0-9-]{2,40}$/, "Use 2–40 lowercase letters, numbers or hyphens")],
      strategy: [rules.min(3, "Describe the strategy")],
      bio: [rules.min(10, "Write a short description (10+ characters)")],
      minAllocation: [rules.decimal("Minimum copy amount")],
      maxAllocation: [rules.optional(rules.decimal("Maximum copy amount"), (v, all) => (toNum(v) < toNum(all.minAllocation) ? "Must be at least the minimum" : null))],
      strategyTags: [(v) => (list(v).length > 6 ? "At most 6 tags" : null)],
      assets: [(v) => (list(v).length > 10 ? "At most 10 instruments" : null)],
    },
    async (v) => {
      const body = {
        displayName: v.displayName,
        slug: v.slug,
        strategy: v.strategy,
        riskLevel: v.riskLevel,
        bio: v.bio,
        strategyTags: list(v.strategyTags),
        assets: list(v.assets).map((a) => a.toUpperCase()),
        minAllocation: v.minAllocation,
        maxAllocation: v.maxAllocation || null,
        status: v.status,
        copyEnabled: v.copyEnabled,
        ...(editing ? {} : { avatarColor: "#F4BE2C" }),
      };
      const saved = await api(editing ? `/api/admin/copy-traders/${t.id}` : "/api/admin/copy-traders", { method: editing ? "PATCH" : "POST", body });
      const file = form.avatar.files[0];
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        try {
          await api(`/api/admin/copy-traders/${saved.id}/avatar`, { form: fd });
        } catch (err) {
          toast.error("Profile saved, but the image upload failed", err.message);
        }
      }
      toast.success(editing ? "Lead trader updated" : "Lead trader added", v.status === "ACTIVE" ? "Visible to users." : "Hidden from users until you set it to Active.");
      m.close();
      refreshAll();
    },
  );
  form.avatar.addEventListener("change", () => {
    const file = form.avatar.files[0];
    if (file) mount($("[data-avatar]", m.el), html`<img src="${URL.createObjectURL(file)}" alt="" class="h-14 w-14 rounded-full object-cover" />`);
  });
  on(m.el, "click", "[data-remove-avatar]", async () => {
    try {
      await api(`/api/admin/copy-traders/${t.id}/avatar`, { method: "DELETE" });
      toast.success("Image removed");
      m.close();
      refreshAll();
    } catch (err) {
      toast.error("Could not remove image", err.message);
    }
  });
  on(m.el, "click", "[data-remove-trader]", async () => {
    const ok = await confirmDialog({
      title: `Remove ${t.displayName}?`,
      message: `${t.stats.activeFollowers} follower${t.stats.activeFollowers === 1 ? "" : "s"} will stop copying and any open copy positions will be closed at market. This cannot be undone.`,
      confirmLabel: "Remove lead trader",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/admin/copy-traders/${t.id}`, { method: "DELETE" });
      toast.success(`${t.displayName} removed`);
      m.close();
      refreshAll();
    } catch (err) {
      toast.error("Could not remove", err.message);
    }
  });
}

/* ───────────────────────────── Signals ───────────────────────────── */

async function signalPanel(panel) {
  await loadTraders().catch(() => {});
  const levels = (s) => html`<span class="block text-[11px] text-dim">TP ${s.takeProfit ? formatPrice(s.takeProfit, s.market.pricePrecision) : "—"} · SL ${s.stopLoss ? formatPrice(s.stopLoss, s.market.pricePrecision) : "—"}</span>`;
  const signals = adminTable(panel, {
    endpoint: "/api/admin/copy-signals",
    filters: [
      {
        name: "status",
        type: "select",
        default: "LIVE",
        options: [
          ["LIVE", "Active signals"],
          ["CREATED", "Drafts"],
          ["ACTIVE", "Awaiting entry"],
          ["EXECUTED", "Open"],
          ["CLOSED", "Closed signals"],
          ["CANCELLED", "Cancelled"],
          ["", "Signal history (all)"],
        ],
      },
      { name: "traderId", type: "select", options: traderOptions() },
    ],
    empty: emptyState({ title: "No signals here", description: "Use “Create signal” to issue one.", iconName: "radio" }),
    columns: [
      { key: "t", header: "Lead trader", cell: (s) => html`<span class="font-semibold text-white">${s.trader.displayName}</span><span class="block text-xs text-dim">${formatDate(s.createdAt)}</span>` },
      { key: "m", header: "Signal", cell: (s) => html`<span class="flex items-center gap-2"><span class="font-semibold text-white">${pair(s.market.symbol)}</span>${sideLabel(s.side)}</span>${levels(s)}` },
      {
        key: "e",
        header: "Entry",
        align: "right",
        cell: (s) =>
          s.executedPrice ? html`${priceCell(s.executedPrice, s.market.pricePrecision)}<span class="block text-[11px] text-dim">executed</span>` : s.entryPrice ? priceCell(s.entryPrice, s.market.pricePrecision) : html`<span class="text-muted">Market</span>`,
      },
      {
        key: "p",
        header: "Price",
        align: "right",
        hideOnMobile: true,
        cell: (s) =>
          s.closePrice ? html`${priceCell(s.closePrice, s.market.pricePrecision)}<span class="block text-[11px] text-dim">${closeReason(s.closeReason)}</span>` : html`${priceCell(s.currentPrice, s.market.pricePrecision)}<span class="block text-[11px] text-dim">live</span>`,
      },
      {
        key: "r",
        header: "Result",
        align: "right",
        cell: (s) => {
          if (s.resultPct !== null) return pctCell(s.resultPct);
          if (s.status !== "EXECUTED" || !s.currentPrice) return html`<span class="text-dim">—</span>`;
          const e = toNum(s.executedPrice);
          return pctCell(((s.side === "BUY" ? s.currentPrice - e : e - s.currentPrice) / e) * 100);
        },
      },
      {
        key: "c",
        header: "Copies",
        align: "right",
        hideOnMobile: true,
        cell: (s) => html`<span class="num text-xs">${s.copies.open + s.copies.closed}${s.copies.failed ? html` <span class="text-down">· ${s.copies.failed} failed</span>` : ""}</span><span class="block">${s.copies.closed ? pnlCell(s.realizedPnl) : ""}</span>`,
      },
      { key: "st", header: "Status", cell: (s) => signalStatusBadge(s.status) },
      {
        key: "x",
        header: html`<span class="sr-only">Actions</span>`,
        align: "right",
        cell: (s) => html`<div class="flex justify-end gap-1">
          ${s.status === "CREATED" ? html`<button type="button" class="btn btn-primary btn-sm" data-sig="activate" data-id="${s.id}">Activate</button>` : ""}
          ${s.status === "EXECUTED" ? html`<button type="button" class="btn btn-secondary btn-sm" data-sig="close" data-id="${s.id}">Close now</button>` : ""}
          ${["CREATED", "ACTIVE", "EXECUTED"].includes(s.status) ? html`<button type="button" class="btn btn-ghost btn-sm" data-sig="edit" data-id="${s.id}" title="Edit">${icon("pencil", "h-4 w-4")}</button>` : ""}
          ${["CREATED", "ACTIVE"].includes(s.status) ? html`<button type="button" class="btn btn-ghost btn-sm text-down" data-sig="cancel" data-id="${s.id}" title="Cancel">${icon("x", "h-4 w-4")}</button>` : ""}
        </div>`,
      },
    ],
  });
  on(panel, "click", "[data-sig]", async (_e, b) => {
    const s = signals.rows().find((r) => r.id === b.dataset.id);
    if (!s) return;
    const act = b.dataset.sig;
    if (act === "edit") return signalForm(s);
    const copy = {
      activate: ["Activate signal?", `${pair(s.market.symbol)} ${s.side} for ${s.trader.displayName}. It executes for all active followers ${s.entryPrice ? `when the price reaches ${formatPrice(s.entryPrice)}` : "immediately at market"}.`, "Activate", "primary"],
      cancel: ["Cancel signal?", "The signal will not execute. It stays in the signal history.", "Cancel signal", "danger"],
      close: ["Close signal now?", `Every follower's ${pair(s.market.symbol)} copy position is closed at the current market price and P&L is booked from the actual fills.`, "Close at market", "danger"],
    }[act];
    await actionModal({
      title: copy[0],
      description: copy[1],
      confirmLabel: copy[2],
      tone: copy[3],
      reason: act === "cancel" ? "optional" : undefined,
      onConfirm: async ({ reason }) => {
        await api(`/api/admin/copy-signals/${s.id}`, { method: "PATCH", body: { action: act, ...(reason ? { reason } : {}) } });
        toast.success({ activate: "Signal activated", cancel: "Signal cancelled", close: "Signal closed" }[act]);
        refreshAll();
      },
    });
  });
}

on(view, "click", "[data-new-signal]", () => signalForm(null));
on(view, "click", "[data-signal-for]", (_e, b) => signalForm(null, b.dataset.signalFor));

async function signalForm(s, traderId) {
  const editing = !!s;
  const executed = s?.status === "EXECUTED";
  const [, snap] = await Promise.all([loadTraders().catch(() => {}), get("/api/markets").catch(() => ({ markets: [], tickers: [] }))]);
  const usable = traders.filter((t) => t.status !== "INACTIVE" || t.id === traderId);
  if (!editing && !usable.length) {
    toast.error("Add a lead trader first", "Signals are issued on behalf of a lead trader.");
    return;
  }
  const markets = snap.markets.filter((mk) => mk.status === "ACTIVE");
  const priceOf = (sym) => snap.tickers.find((x) => x.symbol === sym)?.lastPrice;
  const val = (v) => (v === null || v === undefined ? "" : String(toNum(v)));
  const m = openModal({
    title: editing ? "Edit signal" : "Create trading signal",
    description: editing ? `${s.trader.displayName} · ${pair(s.market.symbol)} ${s.side}` : "Copied automatically to every active follower of the lead trader.",
    size: "lg",
    body: html`<form id="signal-form" class="grid gap-4 sm:grid-cols-2" novalidate>
      ${executed ? notice("info", { iconName: "info", cls: "sm:col-span-2", body: "This signal is open. Only take profit, stop loss and the note can change." }) : ""}
      ${editing ? "" : selectField({ name: "traderId", label: "Lead trader", value: traderId ?? usable.find((t) => t.status === "ACTIVE")?.id ?? "", options: usable.map((t) => [t.id, `${t.displayName}${t.status === "ACTIVE" ? "" : ` (${titleCase(t.status)})`}`]) })}
      ${executed ? "" : selectField({ name: "market", label: "Asset", value: s?.market.symbol ?? "BTC-USDT", options: markets.map((mk) => [mk.symbol, pair(mk.symbol)]) })}
      ${executed ? "" : selectField({ name: "side", label: "Direction", value: s?.side ?? "BUY", options: [["BUY", "BUY"], ["SELL", "SELL"]] })}
      ${executed ? "" : field({ name: "entryPrice", label: "Entry price", value: val(s?.entryPrice), inputmode: "decimal", placeholder: "Market", hint: html`Leave empty to execute at market. <span data-live></span>` })}
      ${field({ name: "takeProfit", label: "Take profit", value: val(s?.takeProfit), inputmode: "decimal", placeholder: "Optional" })}
      ${field({ name: "stopLoss", label: "Stop loss", value: val(s?.stopLoss), inputmode: "decimal", placeholder: "Optional" })}
      ${executed ? "" : field({ name: "sizeMultiplier", label: "Position size", value: val(s?.sizeMultiplier ?? 1), inputmode: "decimal", suffix: "× per trade", hint: "Multiplies each follower's amount per trade (0.1–10). Capped by their copy amount." })}
      ${editing ? "" : selectField({ name: "status", label: "Signal status", value: "ACTIVE", options: [["ACTIVE", "Active — executes when the entry is reached"], ["CREATED", "Draft — save without executing"]] })}
      ${textareaField({ name: "note", label: "Note (optional)", rows: 2, value: s?.note ?? "", cls: "sm:col-span-2", placeholder: "Shown in the audit log and signal history" })}
      <p class="text-xs leading-relaxed text-dim sm:col-span-2">Take profit and stop loss close every follower's position automatically at the live market price. Sell signals can only be copied by followers who hold the asset.</p>
      <div class="sm:col-span-2" data-form-error hidden></div>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="signal-form" class="btn btn-primary">${editing ? "Save signal" : "Create signal"}</button>`,
  });
  const form = $("#signal-form", m.el);
  const showLive = () => {
    const el = $("[data-live]", m.el);
    if (!el || !form.market) return;
    const p = priceOf(form.market.value);
    el.textContent = p ? `Current price: ${formatPrice(p)}` : "";
  };
  form.market?.addEventListener("change", showLive);
  showLive();
  const optPrice = rules.optional(rules.decimal("Price"));
  bindForm(
    form,
    {
      entryPrice: [optPrice],
      takeProfit: [optPrice],
      stopLoss: [optPrice],
      sizeMultiplier: [(v) => (v === undefined || (Number(v) >= 0.1 && Number(v) <= 10) ? null : "Between 0.1 and 10")],
    },
    async (v) => {
      const levels = { takeProfit: v.takeProfit || null, stopLoss: v.stopLoss || null, note: v.note || null };
      if (editing) {
        await api(`/api/admin/copy-signals/${s.id}`, {
          method: "PATCH",
          body: { action: "edit", ...levels, ...(executed ? {} : { market: v.market, side: v.side, entryPrice: v.entryPrice || null, sizeMultiplier: Number(v.sizeMultiplier) }) },
        });
        toast.success("Signal updated");
      } else {
        await api("/api/admin/copy-signals", {
          body: { traderId: v.traderId, market: v.market, side: v.side, entryPrice: v.entryPrice || null, sizeMultiplier: Number(v.sizeMultiplier), status: v.status, ...levels, note: v.note || undefined },
        });
        toast.success(v.status === "ACTIVE" ? "Signal created and active" : "Draft signal saved", v.status === "ACTIVE" ? (v.entryPrice ? "It executes when the entry price is reached." : "Executing for followers at market now.") : undefined);
      }
      m.close();
      refreshAll();
      if (tab !== "signals") show("signals");
    },
  );
}

/* ───────────────────────────── Followers ───────────────────────────── */

async function followerPanel(panel) {
  await loadTraders().catch(() => {});
  const followers = adminTable(panel, {
    endpoint: "/api/admin/copy-followers",
    filters: [
      { name: "q", type: "search", placeholder: "Search by email" },
      {
        name: "status",
        type: "select",
        options: [
          ["", "All followers"],
          ["ACTIVE", "Active copying"],
          ["PAUSED", "Paused by user"],
          ["SUSPENDED", "Suspended"],
          ["STOPPED", "Stopped copying"],
        ],
      },
      { name: "traderId", type: "select", options: traderOptions() },
    ],
    empty: emptyState({ title: "No followers found", iconName: "users" }),
    columns: [
      {
        key: "u",
        header: "User",
        cell: (s) => html`<a class="font-semibold text-white hover:text-accent" href="/admin/users/${s.user.id}">${[s.user.profile?.firstName, s.user.profile?.lastName].filter(Boolean).join(" ") || s.user.email}</a><span class="block text-xs text-dim">${s.user.email}</span>`,
      },
      { key: "t", header: "Lead trader", cell: (s) => s.trader.displayName },
      { key: "a", header: "Copy amount", align: "right", hideOnMobile: true, cell: (s) => html`<span class="num">${formatNumber(s.allocation, 2)}</span><span class="block text-[11px] text-dim">${formatNumber(s.amountPerTrade, 2)} per trade</span>` },
      { key: "tr", header: "Trades", align: "right", hideOnMobile: true, cell: (s) => html`<span class="num text-xs">${s.openTrades} open · ${s.closedTrades} closed${s.failedTrades ? html` · <span class="text-down">${s.failedTrades} failed</span>` : ""}</span>` },
      { key: "p", header: "Realised P&L", align: "right", cell: (s) => pnlCell(s.pnl) },
      { key: "st", header: "Status", cell: (s) => copyStatusBadge(s.status) },
      { key: "d", header: "Since", align: "right", hideOnMobile: true, cell: (s) => html`<span class="text-xs text-muted">${formatDate(s.startedAt, "date")}</span>` },
      {
        key: "x",
        header: html`<span class="sr-only">Actions</span>`,
        align: "right",
        cell: (s) =>
          s.status === "STOPPED"
            ? ""
            : html`<div class="flex justify-end gap-1">
                ${s.status === "SUSPENDED" ? html`<button type="button" class="btn btn-secondary btn-sm" data-fol="reinstate" data-id="${s.id}">Reinstate</button>` : html`<button type="button" class="btn btn-ghost btn-sm" data-fol="suspend" data-id="${s.id}">Suspend</button>`}
                <button type="button" class="btn btn-ghost btn-sm text-down" data-fol="stop" data-id="${s.id}">Stop</button>
              </div>`,
      },
    ],
  });
  on(panel, "click", "[data-fol]", async (_e, b) => {
    const s = followers.rows().find((r) => r.id === b.dataset.id);
    if (!s) return;
    const act = b.dataset.fol;
    const copy = {
      suspend: ["Suspend follower?", `${s.user.email} stops receiving new ${s.trader.displayName} signals. Open positions stay open until their signals close.`, "Suspend", "danger"],
      reinstate: ["Reinstate follower?", `${s.user.email} will receive new ${s.trader.displayName} signals again.`, "Reinstate", "primary"],
      stop: ["Stop this copy relationship?", `All of ${s.user.email}'s open ${s.trader.displayName} copy positions are closed at market and copying ends.`, "Stop copying", "danger"],
    }[act];
    await actionModal({
      title: copy[0],
      description: copy[1],
      confirmLabel: copy[2],
      tone: copy[3],
      reason: act === "reinstate" ? "optional" : "required",
      onConfirm: async ({ reason }) => {
        await api(`/api/admin/copy-followers/${s.id}`, { method: "PATCH", body: { action: act, ...(reason ? { reason } : {}) } });
        toast.success({ suspend: "Follower suspended", reinstate: "Follower reinstated", stop: "Copying stopped" }[act]);
        refreshAll();
      },
    });
  });
}

/* ───────────────────────────── Copy trades ───────────────────────────── */

async function tradePanel(panel) {
  await loadTraders().catch(() => {});
  const statusCell = (x) => {
    const label = { PENDING: "Pending", OPEN: "Open", CLOSED: "Closed", FAILED: "Failed", CANCELLED: "Cancelled" }[x.status];
    const cls = { OPEN: "badge-accent", CLOSED: "badge-neutral", FAILED: "badge-down", PENDING: "badge-warn", CANCELLED: "badge-neutral" }[x.status];
    return html`<span class="badge badge-dot ${cls}">${label}</span>${x.failReason || x.lastError ? html`<span class="mt-0.5 block max-w-[14rem] text-[11px] leading-snug text-dim">${x.lastError ?? x.failReason}</span>` : ""}`;
  };
  adminTable(panel, {
    endpoint: "/api/admin/copy-trades",
    filters: [
      { name: "q", type: "search", placeholder: "Search by email" },
      {
        name: "status",
        type: "select",
        options: [
          ["", "All copy trades"],
          ["OPEN", "Open"],
          ["CLOSED", "Closed"],
          ["PROFIT", "Profitable"],
          ["LOSS", "Loss"],
          ["PENDING", "Pending"],
          ["FAILED", "Failed"],
          ["CANCELLED", "Cancelled"],
        ],
      },
      { name: "traderId", type: "select", options: traderOptions() },
    ],
    empty: emptyState({ title: "No copy trades found", iconName: "history" }),
    columns: [
      { key: "u", header: "User", cell: (x) => html`<a class="text-white hover:text-accent" href="/admin/users/${x.user.id}">${x.user.email}</a><span class="block text-xs text-dim">${x.trader.displayName}</span>` },
      { key: "m", header: "Trade", cell: (x) => html`<span class="flex items-center gap-2"><span class="font-semibold text-white">${pair(x.market.symbol)}</span>${sideLabel(x.side)}${x.isDemo ? smallSim() : ""}</span><span class="block text-[11px] text-dim">${x.quantity && toNum(x.quantity) > 0 ? `${formatNumber(x.quantity)} · ${formatUsd(x.entryValue ?? x.notional)}` : formatUsd(x.notional)}</span>` },
      { key: "e", header: "Entry", align: "right", cell: (x) => priceCell(x.entryPrice, x.market.pricePrecision) },
      { key: "x", header: "Exit", align: "right", hideOnMobile: true, cell: (x) => (x.status === "OPEN" ? html`<span class="text-dim">now</span> ${priceCell(x.currentPrice, x.market.pricePrecision)}` : priceCell(x.exitPrice, x.market.pricePrecision)) },
      { key: "f", header: "Fees", align: "right", hideOnMobile: true, cell: (x) => html`<span class="num text-xs text-muted">${toNum(x.fees) ? formatUsd(x.fees, { dp: 4 }) : "—"}</span>` },
      { key: "g", header: "Gross", align: "right", hideOnMobile: true, cell: (x) => (x.status === "CLOSED" ? pnlCell(x.grossPnl) : html`<span class="text-dim">—</span>`) },
      { key: "n", header: "Net P&L", align: "right", cell: (x) => (x.status === "OPEN" ? html`${pnlCell(x.unrealizedPnl)}<span class="block text-[11px] text-dim">unrealised</span>` : x.status === "CLOSED" ? pnlCell(x.netPnl) : html`<span class="text-dim">—</span>`) },
      { key: "st", header: "Status", cell: statusCell },
      { key: "d", header: "Date", align: "right", hideOnMobile: true, cell: (x) => html`<span class="text-xs text-muted">${formatDate(x.closedAt ?? x.openedAt ?? x.createdAt)}</span>` },
    ],
  });
}

on(view, "click", "[data-tab]", (_e, b) => show(b.dataset.tab));
show(tab, Object.fromEntries([...new URLSearchParams(location.search)].filter(([k]) => k !== "tab")));
