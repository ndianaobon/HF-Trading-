// Candlestick chart for the trading page: volume, overlays (MA, EMA, Bollinger)
// and separate panes for RSI and MACD. Historical candles come from the API;
// the live candle is streamed in by the page.

import { html, mount, cx } from "../core/dom.js";
import { api } from "../core/api.js";
import { loadLightweightCharts, chartColors, trackTheme } from "../core/charts.js";

/** Theme-dependent chart options (re-applied when light/dark mode changes). */
const themeOptions = (c) => ({
  layout: { textColor: c.text, panes: { separatorColor: c.border, separatorHoverColor: c.cross } },
  grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
  rightPriceScale: { borderColor: c.border },
  timeScale: { borderColor: c.border },
  crosshair: { vertLine: { color: c.cross, labelBackgroundColor: c.label }, horzLine: { color: c.cross, labelBackgroundColor: c.label } },
});
import { skeleton } from "../core/ui.js";
import { bollinger, ema, macd, rsi, sma } from "../core/indicators.js";
import { formatCompact, formatPrice } from "../core/format.js";

const UP = "#19c784";
const DOWN = "#f0465a";
const volColor = (c) => (c.close >= c.open ? "rgba(25,199,132,0.28)" : "rgba(240,70,90,0.28)");
const toLine = (candles, values) => values.flatMap((v, i) => (v === null ? [] : [{ time: candles[i].time, value: v }]));
const closes = (c) => c.map((x) => x.close);

/**
 * Creates the chart inside `el`. Returns { update(kline), destroy() }.
 * indicators: Set of "ma" | "ema" | "bb" | "rsi" | "macd".
 */
export function createTradeChart(el, { symbol, interval, pricePrecision, indicators }) {
  let destroyed = false;
  let chart = null;
  let series = null;
  let data = [];
  let refresh = null;

  mount(el, html`<div class="relative h-full w-full"><div class="pointer-events-none absolute top-2 left-3 z-10 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]" data-legend></div><div class="absolute inset-3" data-loading>${skeleton("h-full w-full")}</div><div class="h-full w-full" data-canvas></div></div>`);
  const legend = el.querySelector("[data-legend]");
  const canvas = el.querySelector("[data-canvas]");
  const loading = el.querySelector("[data-loading]");

  const drawLegend = (c) => {
    if (!c) return (legend.innerHTML = "");
    const up = c.close >= c.open;
    legend.innerHTML = String(
      html`${["open", "high", "low", "close"].map((k) => html`<span class="text-dim">${k[0].toUpperCase()} <span class="${cx("num", up ? "text-up" : "text-down")}">${formatPrice(c[k], pricePrecision)}</span></span>`)}
      <span class="text-dim">V <span class="num text-muted">${formatCompact(c.volume)}</span></span>
      ${indicators.has("ma") ? html`<span class="font-semibold text-accent">MA 20</span>` : ""}
      ${indicators.has("ema") ? html`<span><span class="font-semibold text-info">EMA 12</span> <span class="font-semibold text-[#a05bb8]">EMA 26</span></span>` : ""}
      ${indicators.has("bb") ? html`<span class="text-muted">BB 20, 2</span>` : ""}`,
    );
  };

  async function build() {
    const LC = await loadLightweightCharts();
    const res = await api(`/api/markets/${symbol}/candles?interval=${interval}&limit=500`, { allowAnonymous: true });
    if (destroyed) return;
    data = res.candles;
    loading.hidden = true;
    if (!data.length) {
      mount(canvas, html`<div class="grid h-full place-items-center text-sm text-muted">No chart data for this interval yet.</div>`);
      return;
    }
    chart?.remove();
    canvas.innerHTML = "";
    chart = LC.createChart(canvas, {
      autoSize: true,
      ...themeOptions(chartColors()),
      layout: { ...themeOptions(chartColors()).layout, background: { type: LC.ColorType.Solid, color: "transparent" }, fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 },
      timeScale: { borderColor: chartColors().border, timeVisible: interval !== "1d" && interval !== "1w", secondsVisible: false, rightOffset: 6 },
      crosshair: { ...themeOptions(chartColors()).crosshair, mode: LC.CrosshairMode.Normal },
    });
    trackTheme(chart, themeOptions);
    const candles = chart.addSeries(LC.CandlestickSeries, { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false, priceFormat: { type: "price", precision: pricePrecision, minMove: 1 / 10 ** pricePrecision } });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.24 } });
    const volume = chart.addSeries(LC.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const lines = [];
    const addLine = (color, compute, pane = 0, opts = {}) => {
      const s = chart.addSeries(LC.LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...opts }, pane);
      lines.push({ series: s, compute });
      return s;
    };
    if (indicators.has("ma")) addLine("#F4BE2C", (c) => toLine(c, sma(closes(c), 20)));
    if (indicators.has("ema")) {
      addLine("#4da2ff", (c) => toLine(c, ema(closes(c), 12)));
      addLine("#b86bc8", (c) => toLine(c, ema(closes(c), 26)));
    }
    if (indicators.has("bb")) {
      addLine("rgba(154,166,188,0.7)", (c) => toLine(c, bollinger(closes(c)).upper), 0, { lineStyle: LC.LineStyle.Dashed });
      addLine("rgba(154,166,188,0.45)", (c) => toLine(c, bollinger(closes(c)).mid));
      addLine("rgba(154,166,188,0.7)", (c) => toLine(c, bollinger(closes(c)).lower), 0, { lineStyle: LC.LineStyle.Dashed });
    }
    let pane = 1;
    if (indicators.has("rsi")) {
      const s = addLine("#F4BE2C", (c) => toLine(c, rsi(closes(c), 14)), pane++, { lastValueVisible: true, priceFormat: { type: "price", precision: 1, minMove: 0.1 } });
      s.createPriceLine({ price: 70, color: "rgba(240,70,90,0.5)", lineStyle: LC.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" });
      s.createPriceLine({ price: 30, color: "rgba(25,199,132,0.5)", lineStyle: LC.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" });
    }
    if (indicators.has("macd")) {
      const p = pane++;
      const hist = chart.addSeries(LC.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, p);
      lines.push({
        series: hist,
        compute: (c) => {
          const m = macd(closes(c));
          return m.hist.flatMap((v, i) => (v === null ? [] : [{ time: c[i].time, value: v, color: v >= 0 ? "rgba(25,199,132,0.55)" : "rgba(240,70,90,0.55)" }]));
        },
      });
      addLine("#4da2ff", (c) => toLine(c, macd(closes(c)).line), p);
      addLine("#F4BE2C", (c) => toLine(c, macd(closes(c)).signal), p);
    }
    chart
      .panes()
      .slice(1)
      .forEach((pn) => pn.setHeight(110));

    candles.setData(data.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
    volume.setData(data.map((c) => ({ time: c.time, value: c.volume, color: volColor(c) })));
    lines.forEach((l) => l.series.setData(l.compute(data)));
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - 140), to: data.length + 4 });
    chart.subscribeCrosshairMove((p) => drawLegend(p.time ? (data.find((x) => x.time === p.time) ?? null) : data[data.length - 1]));
    series = { candles, volume, lines };
    drawLegend(data[data.length - 1]);
  }

  const start = () =>
    build().catch(() => {
      if (destroyed) return;
      loading.hidden = true;
      mount(canvas, html`<div class="grid h-full place-items-center text-center text-sm text-muted"><div><p class="font-semibold text-white">Chart data unavailable</p><p class="mt-1 text-xs">The market-data provider is not responding. Retrying automatically.</p></div></div>`);
    });
  start();
  refresh = setInterval(() => document.visibilityState === "visible" && !series && start(), 60000);

  return {
    update(k) {
      if (!series || !k || !data.length) return;
      const lastBar = data[data.length - 1];
      if (k.time < lastBar.time) return;
      if (k.time === lastBar.time) data[data.length - 1] = k;
      else data.push(k);
      series.candles.update({ time: k.time, open: k.open, high: k.high, low: k.low, close: k.close });
      series.volume.update({ time: k.time, value: k.volume, color: volColor(k) });
      if (series.lines.length) {
        const recent = data.slice(-300);
        series.lines.forEach((l) => {
          const pts = l.compute(recent);
          const p = pts[pts.length - 1];
          if (p) l.series.update(p);
        });
      }
      drawLegend(k);
    },
    destroy() {
      destroyed = true;
      clearInterval(refresh);
      chart?.remove();
    },
  };
}
