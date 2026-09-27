import { html, raw, $, on, mount } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { api } from "../core/api.js";
import { watch, invalidate } from "../core/store.js";
import { card, pageHeader, statusBadge, badge, assetIcon, notice, errorState, emptyState, toast, openModal, DataTable } from "../core/ui.js";
import { field, bindForm, rules } from "../core/forms.js";
import { formatDate, formatNumber, truncateMiddle } from "../core/format.js";
import { adminPage } from "../components/admin-kit.js";

const { user: admin, view } = await adminPage();
const canManage = admin.can("settings.manage");

mount(
  view,
  html`${pageHeader({ title: "Wallets", description: "Customer balances (platform liabilities), funding networks and deposit addresses." })}
    ${card({ title: "Customer balances by asset", description: "Sum of all customer wallets", body: html`<div data-balances></div>` })}
    ${card({
      cls: "mt-6",
      title: "Funding networks",
      description: "Limits, fees and confirmation requirements shown to users. Processing time is only displayed when set here.",
      action: canManage ? html`<button type="button" class="btn btn-secondary btn-sm" data-add-network>${icon("plus", "h-4 w-4")} Add network</button>` : "",
      body: html`<div data-networks></div>`,
    })}
    ${card({
      cls: "mt-6",
      title: "Deposit addresses",
      description: "Addresses supplied by your custodian or treasury. The platform never generates addresses.",
      action: canManage ? html`<button type="button" class="btn btn-primary btn-sm" data-add>${icon("plus", "h-4 w-4")} Register address</button>` : "",
      body: html`<div data-addresses></div>`,
    })}`,
);

let data = null;
const balances = new DataTable($("[data-balances]", view), {
  defaultSort: { key: "holders", dir: "desc" },
  columns: [
    { key: "a", header: "Asset", sortValue: (b) => b.symbol, cell: (b) => html`<span class="flex items-center gap-2">${assetIcon(b.symbol, b.color, 24)}<span class="font-semibold text-white">${b.symbol}</span></span>` },
    { key: "av", header: "Available", align: "right", sortValue: (b) => Number(b.available), cell: (b) => html`<span class="num">${formatNumber(b.available, 8)}</span>` },
    { key: "lk", header: "Locked", align: "right", sortValue: (b) => Number(b.locked), cell: (b) => html`<span class="num text-muted">${formatNumber(b.locked, 8)}</span>` },
    { key: "holders", header: "Holders", align: "right", sortValue: (b) => b.holders, cell: (b) => String(b.holders) },
  ],
});
const networks = new DataTable($("[data-networks]", view), {
  columns: [
    { key: "a", header: "Asset", cell: (n) => html`<span class="font-semibold text-white">${n.asset}</span>` },
    { key: "n", header: "Network", cell: (n) => n.name },
    { key: "md", header: "Min dep.", align: "right", hideOnMobile: true, cell: (n) => html`<span class="num">${n.minDeposit}</span>` },
    { key: "mw", header: "Min wdr.", align: "right", hideOnMobile: true, cell: (n) => html`<span class="num">${n.minWithdrawal}</span>` },
    { key: "f", header: "Fee", align: "right", cell: (n) => html`<span class="num">${n.withdrawalFee}</span>` },
    { key: "c", header: "Conf.", align: "right", hideOnMobile: true, cell: (n) => String(n.confirmations) },
    { key: "st", header: "Deposit / Withdraw", cell: (n) => html`<span class="flex gap-1">${statusBadge(n.depositEnabled ? "ACTIVE" : "DISABLED", n.depositEnabled ? "In" : "In off")}${statusBadge(n.withdrawEnabled ? "ACTIVE" : "DISABLED", n.withdrawEnabled ? "Out" : "Out off")}</span>` },
    { key: "ad", header: "Addresses", align: "right", cell: (n) => (n.activeAddresses ? String(n.activeAddresses) : html`<span class="text-xs text-warn">None</span>`) },
    { key: "e", header: html`<span class="sr-only">Edit</span>`, align: "right", cell: (n) => (canManage ? html`<button type="button" class="btn btn-ghost btn-sm" data-edit="${n.id}">Edit</button>` : "") },
  ],
});
const addresses = new DataTable($("[data-addresses]", view), {
  empty: emptyState({ title: "No deposit addresses configured", description: "Live deposits stay unavailable until an address is registered for a network." }),
  columns: [
    { key: "a", header: "Asset / network", cell: (a) => html`<span><span class="font-semibold text-white">${a.asset}</span> <span class="text-muted">${a.network}</span></span>` },
    { key: "ad", header: "Address", cell: (a) => html`<span class="font-mono text-xs">${truncateMiddle(a.address, 10)}${a.memo ? ` · memo ${a.memo}` : ""}</span>` },
    { key: "l", header: "Label", hideOnMobile: true, cell: (a) => a.label ?? "—" },
    { key: "u", header: "Assigned to", cell: (a) => a.assignedTo ?? badge("Shared") },
    { key: "c", header: "Added", hideOnMobile: true, cell: (a) => html`<span class="text-xs text-muted">${formatDate(a.createdAt, "date")}</span>` },
    { key: "s", header: "Active", align: "right", cell: (a) => (canManage ? html`<button type="button" role="switch" class="switch" aria-label="Active" aria-checked="${a.isActive ? "true" : "false"}" data-toggle="${a.id}"></button>` : statusBadge(a.isActive ? "ACTIVE" : "DISABLED")) },
  ],
});
[balances, networks, addresses].forEach((t) => t.set(undefined, { loading: true }));

watch("/api/admin/wallets", ({ data: d, error }) => {
  if (!d) return error && mount(view, errorState({ message: error.message }));
  data = d;
  balances.set(d.balances);
  networks.set(d.networks);
  addresses.set(d.addresses);
});

on(view, "click", "[data-toggle]", async (_e, b) => {
  const isActive = b.getAttribute("aria-checked") !== "true";
  b.disabled = true;
  try {
    await api(`/api/admin/wallet-addresses/${b.dataset.toggle}`, { method: "PATCH", body: { isActive } });
    toast.success(isActive ? "Address activated" : "Address deactivated");
    invalidate("/api/admin/wallets");
  } catch (err) {
    toast.error("Could not update address", err.message);
    b.disabled = false;
  }
});

const switchRow = (name, label, checked) => html`<label class="flex items-center justify-between rounded-xl border border-line p-3 text-sm">${label}<input type="checkbox" class="checkbox" name="${name}" ${checked ? raw("checked") : ""} /></label>`;

on(view, "click", "[data-edit]", (_e, b) => {
  const n = data?.networks.find((x) => x.id === b.dataset.edit);
  if (!n) return;
  const m = openModal({
    title: `Edit ${n.asset} · ${n.name}`,
    body: html`<form id="net-form" class="grid gap-4 sm:grid-cols-2" novalidate>
      ${field({ name: "minDeposit", label: "Minimum deposit", value: n.minDeposit, inputmode: "decimal" })}
      ${field({ name: "minWithdrawal", label: "Minimum withdrawal", value: n.minWithdrawal, inputmode: "decimal" })}
      ${field({ name: "withdrawalFee", label: "Withdrawal fee", value: n.withdrawalFee, inputmode: "decimal" })}
      ${field({ name: "confirmations", label: "Confirmations", type: "number", value: String(n.confirmations), attrs: html`min="1" max="1000"` })}
      ${field({ name: "processingTime", label: "Estimated processing time", value: n.processingTime ?? "", placeholder: "e.g. Usually within 2 hours", hint: "Leave empty to hide from users", cls: "sm:col-span-2" })}
      ${switchRow("depositEnabled", "Deposits enabled", n.depositEnabled)}
      ${switchRow("withdrawEnabled", "Withdrawals enabled", n.withdrawEnabled)}
      <div class="sm:col-span-2" data-form-error hidden></div>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="net-form" class="btn btn-primary">Save</button>`,
  });
  const dec = (label) => [rules.pattern(/^\d+(\.\d+)?$/, `Enter a valid ${label.toLowerCase()}`), rules.required(label)];
  bindForm($("#net-form", m.el), { minDeposit: dec("Minimum deposit"), minWithdrawal: dec("Minimum withdrawal"), withdrawalFee: dec("Withdrawal fee"), confirmations: [rules.pattern(/^\d+$/, "Enter a whole number")] }, async (v) => {
    await api(`/api/admin/networks/${n.id}`, {
      method: "PATCH",
      body: { minDeposit: v.minDeposit, minWithdrawal: v.minWithdrawal, withdrawalFee: v.withdrawalFee, confirmations: Number(v.confirmations), processingTime: v.processingTime.trim() || null, depositEnabled: v.depositEnabled, withdrawEnabled: v.withdrawEnabled },
    });
    toast.success("Network updated");
    m.close();
    invalidate("/api/admin/wallets");
  });
});

on(view, "click", "[data-add]", () => {
  if (!data) return;
  const assets = [...new Set(data.networks.map((n) => n.asset))];
  const netOptions = (asset) => data.networks.filter((n) => n.asset === asset).map((n) => html`<option value="${n.code}">${n.name}</option>`);
  const m = openModal({
    title: "Register deposit address",
    body: html`<form id="addr-form" class="space-y-4" novalidate>
      ${notice("info", { iconName: "info", body: "Only register addresses controlled by your custodian or treasury. They are validated against the network format and shown to users as deposit destinations." })}
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="field"><label class="label" for="ad-a">Asset</label><select id="ad-a" name="asset" class="select">${assets.map((a) => html`<option ${a === "USDT" ? raw("selected") : ""}>${a}</option>`)}</select></div>
        <div class="field"><label class="label" for="ad-n">Network</label><select id="ad-n" name="network" class="select">${netOptions(assets.includes("USDT") ? "USDT" : assets[0])}</select></div>
      </div>
      ${field({ name: "address", label: "Address", cls: "font-mono", autocomplete: "off" })}
      <div class="grid gap-4 sm:grid-cols-2">${field({ name: "memo", label: "Memo / tag", hint: "If the network requires one" })}${field({ name: "label", label: "Label" })}</div>
      ${field({ name: "userEmail", label: "Assign to user (email)", type: "email", hint: "Leave empty for a shared address (users must submit a tx hash)" })}
      <div data-form-error hidden></div>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="addr-form" class="btn btn-primary">Register</button>`,
  });
  const form = $("#addr-form", m.el);
  form.asset.addEventListener("change", () => mount(form.network, netOptions(form.asset.value)));
  bindForm(form, { address: [rules.min(10, "Enter the deposit address")], userEmail: [rules.optional(rules.email())] }, async (v) => {
    await api("/api/admin/wallet-addresses", { body: { asset: v.asset, network: v.network, address: v.address.trim(), memo: v.memo || undefined, label: v.label || undefined, userEmail: v.userEmail || undefined } });
    toast.success("Deposit address registered");
    m.close();
    invalidate("/api/admin/wallets");
  });
});

const ADDRESS_FORMATS = [
  ["^0x[a-fA-F0-9]{40}$", "EVM (0x…, 40 hex) — BSC, Ethereum, Polygon, Plasma, Arbitrum"],
  ["^T[1-9A-HJ-NP-Za-km-z]{33}$", "TRON (T…)"],
  ["^[1-9A-HJ-NP-Za-km-z]{32,44}$", "Solana (base58)"],
  ["^0x[a-fA-F0-9]{1,64}$", "Aptos (0x…, up to 64 hex)"],
  ["", "Any format (no validation)"],
];

on(view, "click", "[data-add-network]", () => {
  if (!data) return;
  const assets = [...new Set([...data.networks.map((n) => n.asset), ...data.balances.map((b) => b.symbol)])].sort();
  const m = openModal({
    title: "Add funding network",
    description: "Users can choose this network when depositing once an address is registered for it.",
    body: html`<form id="new-net-form" class="grid gap-4 sm:grid-cols-2" novalidate>
      <div class="field"><label class="label" for="nn-a">Asset</label><select id="nn-a" name="asset" class="select">${assets.map((a) => html`<option ${a === "USDT" ? raw("selected") : ""}>${a}</option>`)}</select></div>
      ${field({ name: "code", label: "Network code", placeholder: "e.g. POL", hint: "Short code: BEP20, TRC20, ERC20, SOL, POL, APT, PLASMA…" })}
      ${field({ name: "name", label: "Display name", placeholder: "e.g. Polygon POS", cls: "sm:col-span-2" })}
      ${field({ name: "minDeposit", label: "Minimum deposit", inputmode: "decimal", value: "10" })}
      ${field({ name: "confirmations", label: "Confirmations", type: "number", value: "12", attrs: html`min="1" max="1000"` })}
      ${field({ name: "minWithdrawal", label: "Minimum withdrawal", inputmode: "decimal", value: "10" })}
      ${field({ name: "withdrawalFee", label: "Withdrawal fee", inputmode: "decimal", value: "1" })}
      ${field({ name: "processingTime", label: "Estimated arrival", placeholder: "e.g. 1 mins", hint: "Shown as \"Est. arrival ≈ …\". Leave empty to hide.", cls: "sm:col-span-2" })}
      <div class="field sm:col-span-2"><label class="label" for="nn-p">Address format</label><select id="nn-p" name="addressPattern" class="select">${ADDRESS_FORMATS.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
      ${switchRow("memoRequired", "Memo / tag required", false)}
      <div class="sm:col-span-2" data-form-error hidden></div>
    </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="new-net-form" class="btn btn-primary">Add network</button>`,
  });
  const dec = (label) => [rules.required(label), rules.pattern(/^\d+(\.\d+)?$/, `Enter a valid ${label.toLowerCase()}`)];
  bindForm(
    $("#new-net-form", m.el),
    {
      code: [rules.required("Network code"), rules.pattern(/^[A-Za-z0-9_-]{2,20}$/, "Use 2–20 letters or digits")],
      name: [rules.required("Display name")],
      minDeposit: dec("Minimum deposit"),
      minWithdrawal: dec("Minimum withdrawal"),
      withdrawalFee: dec("Withdrawal fee"),
      confirmations: [rules.pattern(/^\d+$/, "Enter a whole number")],
    },
    async (v) => {
      await api("/api/admin/networks", {
        body: {
          asset: v.asset,
          code: v.code.trim().toUpperCase(),
          name: v.name.trim(),
          minDeposit: v.minDeposit,
          minWithdrawal: v.minWithdrawal,
          withdrawalFee: v.withdrawalFee,
          confirmations: Number(v.confirmations),
          processingTime: v.processingTime.trim() || undefined,
          addressPattern: v.addressPattern || undefined,
          memoRequired: v.memoRequired,
        },
      });
      toast.success("Network added", "Register a deposit address for it to make it live.");
      m.close();
      invalidate("/api/admin/wallets");
    },
  );
});
