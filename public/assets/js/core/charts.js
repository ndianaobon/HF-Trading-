// Charting. Time series use TradingView Lightweight Charts (loaded on demand);
// the allocation donut and hero candle preview are plain SVG.

import { raw, esc } from "./dom.js";
import { formatUsd } from "./format.js";
import { currentTheme } from "./theme.js";

let lcPromise = null;
export function loadLightweightCharts() {
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  lcPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/lightweight-charts.standalone.js";
    s.onload = () => resolve(window.LightweightCharts);
    s.onerror = () => reject(new Error("Chart library failed to load"));
    document.head.appendChild(s);
  });
  return lcPromise;
}

const PALETTES = {
  dark: { text: "#8a8f99", grid: "rgba(255,255,255,0.045)", border: "#232325", cross: "#4a4a52", label: "#1c1c1e" },
  light: { text: "#5a6170", grid: "rgba(15,17,21,0.07)", border: "#e3e5ea", cross: "#9aa0ab", label: "#1b1e24" },
};
/** Chart colours for the active light/dark theme. */
export const chartColors = () => PALETTES[currentTheme()];

// Charts re-colour themselves when the theme changes.
const tracked = new Set();
export function trackTheme(chart, optionsFor) {
  const apply = () => {
    try {
      chart.applyOptions(optionsFor(chartColors()));
    } catch {
      tracked.delete(apply); // chart was removed
    }
  };
  tracked.add(apply);
}
window.addEventListener("hf:themechange", () => tracked.forEach((f) => f()));

const themed = (c) => ({
  layout: { textColor: c.text },
  grid: { horzLines: { color: c.grid } },
  crosshair: { vertLine: { color: c.cross, labelBackgroundColor: c.label }, horzLine: { color: c.cross, labelBackgroundColor: c.label } },
});

const baseOptions = (LC) => ({
  autoSize: true,
  layout: { background: { type: LC.ColorType.Solid, color: "transparent" }, textColor: chartColors().text, fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 },
  grid: { vertLines: { visible: false }, horzLines: { color: chartColors().grid } },
  rightPriceScale: { borderVisible: false },
  timeScale: { borderVisible: false },
  crosshair: { vertLine: { color: chartColors().cross, labelBackgroundColor: chartColors().label }, horzLine: { color: chartColors().cross, labelBackgroundColor: chartColors().label } },
  handleScroll: false,
  handleScale: false,
});

/** Area chart of {t: ISO date, v: number} points (portfolio value, equity index). */
export async function valueChart(el, points, { format = (v) => formatUsd(v), color } = {}) {
  const LC = await loadLightweightCharts();
  el.innerHTML = "";
  const up = points.length > 1 ? points[points.length - 1].v >= points[0].v : true;
  const stroke = color ?? (up ? "#19c784" : "#f0465a");
  const chart = LC.createChart(el, { ...baseOptions(LC), localization: { priceFormatter: format } });
  trackTheme(chart, themed);
  const series = chart.addSeries(LC.AreaSeries, { lineColor: stroke, topColor: `${stroke}55`, bottomColor: `${stroke}00`, lineWidth: 2, priceLineVisible: false });
  const seen = new Set();
  series.setData(
    points
      .map((p) => ({ time: Math.floor(new Date(p.t).getTime() / 1000), value: p.v }))
      .filter((p) => (seen.has(p.time) ? false : seen.add(p.time))),
  );
  chart.timeScale().fitContent();
  return chart;
}

/** Daily bar/area chart for admin analytics: rows [{date:'YYYY-MM-DD', ...}]. */
export async function seriesChart(el, rows, key, { kind = "area", color = "#F4BE2C", format = (v) => v.toLocaleString("en-US", { maximumFractionDigits: 2 }) } = {}) {
  const LC = await loadLightweightCharts();
  el.innerHTML = "";
  const chart = LC.createChart(el, { ...baseOptions(LC), localization: { priceFormatter: format } });
  trackTheme(chart, themed);
  const data = rows.map((r) => ({ time: r.date, value: r[key] }));
  if (kind === "bar") {
    chart.addSeries(LC.HistogramSeries, { color, priceLineVisible: false }).setData(data);
  } else {
    chart.addSeries(LC.AreaSeries, { lineColor: color, topColor: `${color}55`, bottomColor: `${color}00`, lineWidth: 2, priceLineVisible: false }).setData(data);
  }
  chart.timeScale().fitContent();
  return chart;
}

/** Donut + legend (SVG). slices: [{label, value, color}] */
export function donut(slices, total, size = 200) {
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const main = sorted.slice(0, 6);
  const rest = sorted.slice(6).reduce((s, x) => s + x.value, 0);
  const all = rest > 0 ? [...main, { label: "Other", value: rest, color: "#3a4763" }] : main;
  const sum = all.reduce((s, x) => s + x.value, 0) || 1;
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const gap = all.length > 1 ? 1.2 : 0;
  const arcs = all
    .map((s) => {
      const len = (s.value / sum) * c;
      const dash = `${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}`;
      const el = `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${esc(s.color)}" stroke-width="12" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 50 50)"><title>${esc(s.label)}: ${((s.value / sum) * 100).toFixed(1)}%</title></circle>`;
      offset += len;
      return el;
    })
    .join("");
  const legend = all
    .map(
      (s) =>
        `<li class="flex items-center justify-between gap-3 text-sm"><span class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full" style="background:${esc(s.color)}"></span><span class="text-fg">${esc(s.label)}</span></span><span class="num text-muted">${((s.value / sum) * 100).toFixed(1)}%</span></li>`,
    )
    .join("");
  return raw(`<div class="flex flex-col items-center gap-5 sm:flex-row lg:flex-col xl:flex-row">
    <div class="relative shrink-0" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 100 100" class="h-full w-full" role="img" aria-label="Allocation chart">${arcs}</svg>
      <div class="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><p class="text-[11px] text-dim">Total</p><p class="num font-display text-lg font-bold text-white">${total !== null && total !== undefined ? esc(formatUsd(total, { compact: total > 1e6 })) : "—"}</p></div></div>
    </div>
    <ul class="w-full flex-1 space-y-2">${legend}</ul>
  </div>`);
}

/** Lightweight SVG candlestick preview (homepage hero). */
export function candlesSvg(candles, width = 560, height = 210) {
  if (!candles || candles.length < 2) return raw("");
  const volH = height * 0.18;
  const priceH = height - volH - 6;
  const hi = Math.max(...candles.map((c) => c.high));
  const lo = Math.min(...candles.map((c) => c.low));
  const vmax = Math.max(...candles.map((c) => c.volume)) || 1;
  const range = hi - lo || 1;
  const step = width / candles.length;
  const bw = Math.max(1.5, step * 0.62);
  const y = (p) => 4 + (1 - (p - lo) / range) * (priceH - 8);
  const grid = [0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${width}" y1="${priceH * f}" y2="${priceH * f}" style="stroke:var(--grid-line)" stroke-dasharray="3 5"/>`).join("");
  const bars = candles
    .map((c, i) => {
      const color = c.close >= c.open ? "var(--color-up)" : "var(--color-down)";
      const x = i * step + step / 2;
      const top = y(Math.max(c.open, c.close));
      const bottom = y(Math.min(c.open, c.close));
      const vh = (c.volume / vmax) * volH;
      return `<line x1="${x}" x2="${x}" y1="${y(c.high)}" y2="${y(c.low)}" stroke="${color}" stroke-width="1"/><rect x="${x - bw / 2}" y="${top}" width="${bw}" height="${Math.max(1, bottom - top)}" fill="${color}"/><rect x="${x - bw / 2}" y="${height - vh}" width="${bw}" height="${vh}" fill="${color}" opacity="0.25"/>`;
    })
    .join("");
  return raw(`<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="h-full w-full" role="img" aria-label="Price chart">${grid}${bars}</svg>`);
}
