import { html } from "../core/dom.js";
import { icon } from "../core/icons.js";

const MAP = {
  TRADE_EXECUTED: ["candlestick-chart", "bg-info-soft text-info"],
  DEPOSIT_RECEIVED: ["arrow-down-to-line", "bg-up-soft text-up"],
  WITHDRAWAL_STATUS: ["arrow-up-from-line", "bg-warn-soft text-warn"],
  SECURITY_ALERT: ["shield-alert", "bg-down-soft text-down"],
  INVESTMENT_UPDATE: ["piggy-bank", "bg-accent-soft text-accent"],
  SYSTEM_ANNOUNCEMENT: ["megaphone", "bg-panel-3 text-muted"],
  KYC_UPDATE: ["badge-check", "bg-up-soft text-up"],
  SUPPORT_REPLY: ["message-circle", "bg-info-soft text-info"],
};

export function notificationIcon(type, size = "h-8 w-8") {
  const [name, cls] = MAP[type] ?? MAP.SYSTEM_ANNOUNCEMENT;
  return html`<span class="grid ${size} shrink-0 place-items-center rounded-lg ${cls}">${icon(name, "h-4 w-4")}</span>`;
}
