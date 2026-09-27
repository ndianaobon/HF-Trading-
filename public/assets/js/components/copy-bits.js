// Shared copy-trading display helpers: lead-trader avatar, status labels and P&L cells.
import { html, esc } from "../core/dom.js";
import { avatar, badge, statusBadge } from "../core/ui.js";
import { formatPercent, formatPrice, formatUsd, toNum } from "../core/format.js";

/** Uploaded profile image, or initials on the trader's colour. */
export function traderAvatar(t, size = 32) {
  if (!t.avatarUrl) return avatar(t.displayName, t.avatarColor, size);
  return html`<img src="${t.avatarUrl}" alt="" width="${size}" height="${size}" class="shrink-0 rounded-full object-cover" style="width:${size}px;height:${size}px;box-shadow:inset 0 0 0 1px ${esc(t.avatarColor)}55" loading="lazy" />`;
}

const TRADER_STATUS = { ACTIVE: ["Active", "up"], INACTIVE: ["Inactive", "neutral"], SUSPENDED: ["Suspended", "down"] };
export const traderStatusBadge = (s) => badge(TRADER_STATUS[s]?.[0] ?? s, TRADER_STATUS[s]?.[1] ?? "neutral");

const SIGNAL_LABELS = { CREATED: "Draft", ACTIVE: "Awaiting entry", EXECUTED: "Open", CLOSED: "Closed", CANCELLED: "Cancelled" };
export const signalStatusBadge = (s) => statusBadge(s, SIGNAL_LABELS[s] ?? s);

const COPY_LABELS = { ACTIVE: "Copying", PAUSED: "Paused", SUSPENDED: "Suspended", STOPPED: "Stopped" };
export const copyStatusBadge = (s) => statusBadge(s, COPY_LABELS[s] ?? s);

export const sideLabel = (side) => html`<span class="font-semibold ${side === "BUY" ? "text-up" : "text-down"}">${side === "BUY" ? "Buy" : "Sell"}</span>`;

export const pair = (symbol) => symbol.replace("-", "/");

export const tone = (v) => (v === null || v === undefined ? "text-dim" : toNum(v) > 0 ? "text-up" : toNum(v) < 0 ? "text-down" : "text-muted");

export const pnlCell = (v) => html`<span class="num font-semibold ${tone(v)}">${v === null || v === undefined ? "—" : formatUsd(v, { sign: true })}</span>`;

export const pctCell = (v) => html`<span class="num font-semibold ${tone(v)}">${v === null || v === undefined ? "—" : formatPercent(v)}</span>`;

export const priceCell = (v, dp) => html`<span class="num">${v === null || v === undefined ? "—" : formatPrice(v, dp)}</span>`;

const CLOSE_REASONS = { TAKE_PROFIT: "Take profit", STOP_LOSS: "Stop loss", MANUAL: "Closed manually" };
export const closeReason = (r) => CLOSE_REASONS[r] ?? "—";

/** Plain-language risk and disclosure copy used on profiles and the copy dialog. */
export const RISK_NOTE =
  "Lead trader profiles and their signals are published by HarborFinance. Results are calculated from executed trades at live market prices, including fees. Past results do not predict future returns, and copy trading can lose money.";
