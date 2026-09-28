// Number, currency and date formatting.

export const toNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Precision suited to a price's magnitude. */
export function autoPrecision(price) {
  const p = Math.abs(price);
  if (p === 0) return 2;
  if (p >= 100) return 2;
  if (p >= 1) return 4;
  if (p >= 0.01) return 5;
  if (p >= 0.0001) return 7;
  return 9;
}

export function formatPrice(v, precision) {
  if (v === null || v === undefined || v === "") return "—";
  const n = toNum(v);
  const dp = precision ?? autoPrecision(n);
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function formatNumber(v, maxDp = 8, minDp = 0) {
  if (v === null || v === undefined || v === "") return "—";
  return toNum(v).toLocaleString("en-US", { minimumFractionDigits: minDp, maximumFractionDigits: maxDp });
}

/** Plan term label: 1–2 days in hours, whole weeks (other than 1) in weeks, otherwise days. */
export function formatDuration(days) {
  const d = toNum(days);
  if (d <= 2) return `${d * 24} Hours`;
  if (d % 7 === 0 && d > 7) return `${d / 7} Weeks`;
  return `${d} Days`;
}

export function formatUsd(v, opts = {}) {
  if (v === null || v === undefined || v === "") return "—";
  const n = toNum(v);
  const sign = opts.sign && n > 0 ? "+" : n < 0 ? "−" : "";
  const abs = Math.abs(n);
  const body = opts.compact
    ? abs.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })
    : abs.toLocaleString("en-US", { minimumFractionDigits: opts.dp ?? 2, maximumFractionDigits: opts.dp ?? 2 });
  return `${sign}$${body}`;
}

export function formatCompact(v) {
  if (v === null || v === undefined || v === "") return "—";
  return toNum(v).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
}

export function formatPercent(v, opts = { sign: true }) {
  if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) return "—";
  const n = toNum(v);
  const sign = opts.sign !== false && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(opts.dp ?? 2)}%`;
}

export function formatDate(v, style = "datetime") {
  if (!v) return "—";
  const d = typeof v === "string" || typeof v === "number" ? new Date(v) : v;
  if (style === "date") return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  if (style === "time") return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(v) {
  const d = typeof v === "string" ? new Date(v) : v;
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(d, "date");
}

/** Display name for a transaction's type ("Express Deposit" for admin-funded deposits). */
export const txTypeLabel = (t) => (t.metadata?.express ? "Express Deposit" : titleCase(t.type));

export const titleCase = (s) =>
  String(s ?? "")
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

export function truncateMiddle(s, keep = 6) {
  if (!s) return "";
  return s.length <= keep * 2 + 3 ? s : `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

/** Floors a positive number to `dp` decimals and returns a plain string. */
export const trimNum = (n, dp) => (Number.isFinite(n) && n > 0 ? String(Math.floor(n * 10 ** dp) / 10 ** dp) : "");
