/**
 * Smart Money Concepts / ICT market-structure analysis — pure functions over
 * candles ({ time (s), open, high, low, close }), no I/O, so every rule can be
 * unit-tested and every decision audited.
 *
 * A bullish setup (bearish is the exact mirror) requires, in order:
 *   1. higher-timeframe bias bullish                      (htfBias)
 *   2. sell-side liquidity swept: a wick below a swing low,
 *      equal lows, the previous day's low or the Asian low,
 *      with the candle closing back above it               (sweep)
 *   3. bullish displacement: a large-bodied candle          (displacement)
 *   4. structure shift: a close above the last swing high   (bos)
 *   5. an entry zone left by the move: fair value gap and/or
 *      order block                                          (fvg / orderBlock)
 *   6. the zone sits in the discount half of the range      (premiumDiscount)
 *   7. price retraces into the zone                         (retrace)
 *   8. lower-timeframe structure turns up inside the zone   (ltfConfirmation)
 *   9. stop below the sweep; target at opposing liquidity
 *      (or fixed R) meets the minimum risk/reward          (riskReward)
 */

/* ───────────── Primitives ───────────── */

/** Average true range over the last `n` candles (simple mean). */
export function atr(c, n = 14, end = c.length - 1) {
  const from = Math.max(1, end - n + 1);
  let sum = 0;
  let count = 0;
  for (let i = from; i <= end; i++) {
    const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    sum += tr;
    count++;
  }
  return count ? sum / count : 0;
}

/** Fractal swing points: a high (low) with `len` lower highs (higher lows) either side. */
export function findSwings(c, len = 3) {
  const out = [];
  for (let i = len; i < c.length - len; i++) {
    let hi = true;
    let lo = true;
    for (let k = 1; k <= len; k++) {
      if (!(c[i].high > c[i - k].high && c[i].high >= c[i + k].high)) hi = false;
      if (!(c[i].low < c[i - k].low && c[i].low <= c[i + k].low)) lo = false;
    }
    if (hi) out.push({ i, time: c[i].time, price: c[i].high, type: "H" });
    if (lo) out.push({ i, time: c[i].time, price: c[i].low, type: "L" });
  }
  return out;
}

/**
 * Market structure: walks the candles, and each time a close breaks the last
 * confirmed swing high/low records a BOS (with the trend) or CHOCH (against it).
 */
export function structure(c, len = 3) {
  const swings = findSwings(c, len);
  const events = [];
  let trend = null;
  let lastH = null;
  let lastL = null;
  let brokenH = true;
  let brokenL = true;
  let si = 0;
  for (let k = 0; k < c.length; k++) {
    while (si < swings.length && swings[si].i + len <= k) {
      if (swings[si].type === "H") [lastH, brokenH] = [swings[si], false];
      else [lastL, brokenL] = [swings[si], false];
      si++;
    }
    if (lastH && !brokenH && c[k].close > lastH.price) {
      events.push({ type: trend === "BEARISH" ? "CHOCH" : "BOS", dir: "BULLISH", k, time: c[k].time, level: lastH.price });
      trend = "BULLISH";
      brokenH = true;
    }
    if (lastL && !brokenL && c[k].close < lastL.price) {
      events.push({ type: trend === "BULLISH" ? "CHOCH" : "BOS", dir: "BEARISH", k, time: c[k].time, level: lastL.price });
      trend = "BEARISH";
      brokenL = true;
    }
  }
  return { trend: trend ?? "NEUTRAL", events, swings, lastEvent: events[events.length - 1] ?? null };
}

const DAY = 86_400;

/** Previous UTC day's high/low and today's Asian-session (00:00–07:00 UTC) range. */
export function sessionLevels(c) {
  if (!c.length) return {};
  const lastDay = Math.floor(c[c.length - 1].time / DAY);
  const prev = c.filter((x) => Math.floor(x.time / DAY) === lastDay - 1);
  const asia = c.filter((x) => Math.floor(x.time / DAY) === lastDay && x.time % DAY < 7 * 3600);
  const hi = (a) => (a.length ? Math.max(...a.map((x) => x.high)) : null);
  const lo = (a) => (a.length ? Math.min(...a.map((x) => x.low)) : null);
  return {
    prevDayHigh: prev.length ? { price: hi(prev), time: prev[prev.length - 1].time, label: "Previous day high" } : null,
    prevDayLow: prev.length ? { price: lo(prev), time: prev[prev.length - 1].time, label: "Previous day low" } : null,
    asiaHigh: asia.length ? { price: hi(asia), time: asia[asia.length - 1].time, label: "Asian session high" } : null,
    asiaLow: asia.length ? { price: lo(asia), time: asia[asia.length - 1].time, label: "Asian session low" } : null,
  };
}

/** Sell-side liquidity: swing lows, equal lows, previous-day and Asian lows. */
function sellSideLiquidity(c, swings, len, a) {
  const lows = swings.filter((s) => s.type === "L" && s.i + len < c.length);
  const levels = lows.map((s) => ({ price: s.price, time: c[s.i + len].time, label: "Swing low" }));
  for (let x = 0; x < lows.length; x++) {
    for (let y = x + 1; y < lows.length; y++) {
      if (Math.abs(lows[x].price - lows[y].price) <= 0.1 * a) levels.push({ price: Math.min(lows[x].price, lows[y].price), time: c[Math.min(c.length - 1, lows[y].i + len)].time, label: "Equal lows" });
    }
  }
  const s = sessionLevels(c);
  if (s.prevDayLow) levels.push(s.prevDayLow);
  if (s.asiaLow) levels.push(s.asiaLow);
  return levels;
}

/** Fair value gaps between candles i-1 and i+1 in [from, to]: bullish when low[i+1] > high[i-1]. */
export function bullishFvgs(c, from, to) {
  const out = [];
  for (let i = Math.max(1, from); i <= Math.min(to, c.length - 2); i++) {
    if (c[i + 1].low > c[i - 1].high) out.push({ low: c[i - 1].high, high: c[i + 1].low, i, time: c[i].time });
  }
  return out;
}

/* ───────────── Mirroring (bearish = mirrored bullish) ───────────── */

const mirrorCandles = (c) => c.map((x) => ({ time: x.time, open: -x.open, high: -x.low, low: -x.high, close: -x.close }));

/* ───────────── Setup detection ───────────── */

const PRIORITY = ["Previous day low", "Asian session low", "Equal lows", "Swing low"];

/**
 * Looks for a bullish setup in mirrored-or-not candles. Prices returned are in
 * the same (possibly mirrored) space; `detectSetup` maps them back.
 */
function bullishSetup({ setup, entry, last, targets }, p) {
  const len = p.swingLength;
  const c = setup;
  const n = c.length;
  if (n < 40) return null;
  const a = atr(c, 14);
  const { swings } = structure(c, len);
  const levels = sellSideLiquidity(c, swings, len, a);

  // 2. Liquidity sweep: within the lookback, the candle with the lowest low that wicked below a
  //    level formed before it and closed back above it (the liquidity grab itself).
  let sweep = null;
  for (let j = n - 1; j >= Math.max(1, n - p.sweepLookback); j--) {
    const hits = levels.filter((l) => l.time < c[j].time && c[j].low < l.price && c[j].close > l.price);
    if (hits.length && (!sweep || c[j].low < c[sweep.j].low)) {
      hits.sort((x, y) => PRIORITY.indexOf(x.label) - PRIORITY.indexOf(y.label) || x.price - y.price);
      sweep = { j, level: hits[0], time: c[j].time };
    }
  }
  if (!sweep) return null;
  const j = sweep.j;

  // 4. Structure shift: a close above the most recent swing high confirmed before the sweep.
  const priorHighs = swings.filter((s) => s.type === "H" && s.i + len <= j);
  const refHigh = priorHighs.length ? priorHighs[priorHighs.length - 1].price : Math.max(...c.slice(Math.max(0, j - 10), j).map((x) => x.high));
  let k = -1;
  for (let x = j + 1; x < n; x++) {
    if (c[x].close > refHigh) {
      k = x;
      break;
    }
  }
  if (k < 0) return null; // no structure shift yet: not a candidate
  const key = `${sweep.time}:${c[k].time}`;

  // The sweep's extreme is the lowest low from the sweep up to the break.
  const sweepLow = Math.min(...c.slice(j, k + 1).map((x) => x.low));

  // 3. Displacement: a strong-bodied bullish candle between the sweep and the break.
  let disp = null;
  for (let x = j; x <= k; x++) {
    const body = c[x].close - c[x].open;
    const range = c[x].high - c[x].low || 1e-12;
    if (body >= p.displacementAtr * a && (c[x].close - c[x].low) / range >= 0.7) {
      disp = { i: x, body };
      break;
    }
  }

  // 5. Entry zones created by the move.
  const fvgs = bullishFvgs(c, j + 1, k + 1).filter((g) => !c.slice(g.i + 2).some((x) => x.close < g.low));
  const fvg = fvgs.length ? fvgs[fvgs.length - 1] : null;
  let ob = null;
  for (let x = (disp?.i ?? k) - 1; x >= j; x--) {
    if (c[x].close < c[x].open) {
      ob = { low: c[x].low, high: Math.max(c[x].open, c[x].close), i: x, time: c[x].time };
      break;
    }
  }
  const zone = p.entryZone === "OB" ? ob : p.entryZone === "FVG" ? fvg : (fvg ?? ob);
  const zoneKind = zone === fvg && fvg ? "FVG" : zone ? "Order block" : null;

  // 6. Premium / discount of the dealing range (sweep low → high of the move).
  const rangeHigh = Math.max(...c.slice(j, n).map((x) => x.high));
  const eq = (sweepLow + rangeHigh) / 2;
  const inDiscount = zone ? (zone.low + zone.high) / 2 <= eq : false;

  // Invalidation / expiry.
  const invalidated = zone ? c.slice(k + 1).some((x) => x.close < zone.low) || c.slice(k + 1).some((x) => x.low < sweepLow) || last < sweepLow : false;
  const age = n - 1 - k;
  const expired = age > p.setupExpiryCandles;

  // 7. Retrace into the zone (entry timeframe), and 8. lower-timeframe confirmation after the touch.
  const bosTime = c[k].time;
  const touchIdx = zone ? entry.findIndex((x) => x.time > bosTime && x.low <= zone.high) : -1;
  const zoneHeight = zone ? zone.high - zone.low : 0;
  const nearZone = zone ? last >= zone.low - 0.1 * zoneHeight && last <= zone.high + 0.5 * zoneHeight : false;
  const retrace = touchIdx >= 0 && nearZone;
  let ltfConfirm = false;
  if (touchIdx >= 0) {
    const s = structure(entry, Math.max(1, Math.min(2, len)));
    ltfConfirm = s.events.some((e) => e.dir === "BULLISH" && e.time >= entry[touchIdx].time);
  }

  // 9. Stop, target and risk/reward from the live price.
  const stopLoss = sweepLow - p.stopBufferAtr * a;
  const risk = last - stopLoss;
  let takeProfit = null;
  let targetLabel = null;
  if (risk > 0) {
    if (p.takeProfitMode === "FIXED_RR") {
      takeProfit = last + p.fixedRiskReward * risk;
      targetLabel = `${p.fixedRiskReward}R`;
    } else {
      // External liquidity: untaken levels beyond the high of the move.
      const above = targets.filter((t) => t.price > Math.max(last, rangeHigh)).sort((x, y) => x.price - y.price);
      if (above.length) [takeProfit, targetLabel] = [above[0].price, above[0].label];
    }
  }
  const rr = risk > 0 && takeProfit ? (takeProfit - last) / risk : null;

  return {
    key,
    sweep: { ...sweep.level, candleTime: sweep.time, extreme: sweepLow },
    bos: { level: refHigh, time: bosTime },
    displacement: disp ? { time: c[disp.i].time, atrMultiple: disp.body / a } : null,
    fvg,
    orderBlock: ob,
    zone,
    zoneKind,
    equilibrium: eq,
    inDiscount,
    retrace,
    touched: touchIdx >= 0,
    ltfConfirm,
    stopLoss,
    takeProfit,
    targetLabel,
    rr,
    invalidated,
    expired,
    ageCandles: age,
    atr: a,
  };
}

/**
 * Detects a setup in one direction and evaluates every condition.
 *   data:   { bias: [{ tf, candles }], setup: candles, entry: candles, last }
 *   params: strategyParams + { minRiskReward }
 * Returns null when there is no candidate (no sweep followed by a structure
 * shift), otherwise the setup with its condition checklist and verdict:
 *   status "READY"    — every required condition passed: trade it
 *          "WAITING"  — setup valid, waiting for retrace / confirmation
 *          "REJECTED" — a required structural condition failed (reason)
 *          "EXPIRED"  — entry never came within the expiry window
 */
export function detectSetup(side, data, params, fmt = (v) => String(v)) {
  const bull = side === "BUY";
  const m = bull ? (x) => x : mirrorCandles;
  const sgn = bull ? 1 : -1;
  const setupC = m(data.setup);
  const entryC = m(data.entry);
  // Opposing liquidity to target: swing highs on the setup and bias timeframes plus the previous day's high.
  // Only liquidity that is still resting (no later candle has traded through it) can be a target.
  const targets = [];
  const hiLabel = bull ? "Swing high liquidity" : "Swing low liquidity";
  for (const src of [...data.bias.map((b) => b.candles), data.setup]) {
    const mc = m(src);
    for (const s of findSwings(mc, params.swingLength)) {
      if (s.type === "H" && !mc.slice(s.i + 1).some((x) => x.high > s.price)) targets.push({ price: s.price, label: hiLabel });
    }
    const lv = sessionLevels(mc);
    const lastDay = Math.floor(mc[mc.length - 1].time / DAY);
    if (lv.prevDayHigh && !mc.some((x) => Math.floor(x.time / DAY) === lastDay && x.high > lv.prevDayHigh.price)) {
      targets.push({ price: lv.prevDayHigh.price, label: bull ? "Previous day high" : "Previous day low" });
    }
  }
  const r = bullishSetup({ setup: setupC, entry: entryC, last: sgn * data.last, targets }, params);
  if (!r) return null;

  const px = (v) => (v === null || v === undefined ? null : sgn * v);
  const zone = r.zone ? (bull ? { low: r.zone.low, high: r.zone.high } : { low: -r.zone.high, high: -r.zone.low }) : null;
  const want = bull ? "BULLISH" : "BEARISH";
  const biases = data.bias.map((b) => ({ tf: b.tf, trend: structure(b.candles, params.swingLength).trend }));
  const htfOk = params.htfMode === "ANY" ? biases.some((b) => b.trend === want) : biases.every((b) => b.trend === want);
  const word = bull ? { liq: "sell-side", zone: "discount", shift: "high" } : { liq: "buy-side", zone: "premium", shift: "low" };

  const conditions = [
    { key: "htfBias", label: "HTF bias", required: params.requireHtfAlignment, passed: htfOk, detail: biases.map((b) => `${b.tf} ${b.trend.toLowerCase()}`).join(", ") },
    { key: "sweep", label: "Liquidity sweep", required: true, passed: true, detail: `${bull ? r.sweep.label : r.sweep.label.replace("low", "high").replace("lows", "highs")} ${fmt(px(r.sweep.price))} swept (${word.liq})` },
    { key: "displacement", label: "Displacement", required: params.requireDisplacement, passed: !!r.displacement, detail: r.displacement ? `${r.displacement.atrMultiple.toFixed(1)}× ATR candle` : `No candle ≥ ${params.displacementAtr}× ATR` },
    { key: "bos", label: "BOS / market structure shift", required: true, passed: true, detail: `Close beyond swing ${word.shift} ${fmt(px(r.bos.level))}` },
    { key: "fvg", label: "Fair value gap", required: params.entryZone === "FVG", passed: !!r.fvg, detail: r.fvg ? `${fmt(px(bull ? r.fvg.low : r.fvg.high))} – ${fmt(px(bull ? r.fvg.high : r.fvg.low))}` : "None left by the move" },
    { key: "orderBlock", label: "Order block", required: params.entryZone === "OB", passed: !!r.orderBlock, detail: r.orderBlock ? `${fmt(px(bull ? r.orderBlock.low : r.orderBlock.high))} – ${fmt(px(bull ? r.orderBlock.high : r.orderBlock.low))}` : "None found" },
    { key: "entryZone", label: "Entry zone", required: true, passed: !!zone, detail: zone ? `${r.zoneKind} ${fmt(zone.low)} – ${fmt(zone.high)}` : "No FVG or order block" },
    { key: "premiumDiscount", label: bull ? "Discount zone" : "Premium zone", required: params.requirePremiumDiscount, passed: r.inDiscount, detail: `Equilibrium ${fmt(px(r.equilibrium))}` },
    { key: "retrace", label: "Retrace into zone", required: true, passed: r.retrace, detail: r.retrace ? "Price is in the entry zone" : r.touched ? "Zone touched; price has left it" : "Waiting for price to reach the zone" },
    { key: "ltfConfirmation", label: "LTF confirmation", required: params.requireLtfConfirmation, passed: r.ltfConfirm, detail: r.ltfConfirm ? "Lower-timeframe structure shifted in the trade direction" : "Waiting for lower-timeframe structure shift" },
    { key: "riskReward", label: "Risk/Reward", required: true, passed: r.rr !== null && r.rr >= params.minRiskReward, detail: r.rr !== null ? `1:${r.rr.toFixed(2)} (min 1:${params.minRiskReward}) → ${r.targetLabel}` : "No target liquidity beyond the entry" },
  ];

  const failed = (keys) => conditions.find((x) => keys.includes(x.key) && x.required && !x.passed);
  const structural = failed(["htfBias", "displacement", "fvg", "orderBlock", "entryZone", "premiumDiscount"]);
  let status;
  let reason = null;
  if (structural) {
    status = "REJECTED";
    reason = structural.key === "htfBias" ? `Higher-timeframe bias is not ${want.toLowerCase()} (${structural.detail})` : `Required ${structural.label.toLowerCase()} confirmation missing`;
  } else if (r.invalidated) {
    status = "REJECTED";
    reason = "Entry zone invalidated: price closed through it";
  } else if (failed(["retrace", "ltfConfirmation"])) {
    status = r.expired ? "EXPIRED" : "WAITING";
    reason = r.expired ? `No entry within ${params.setupExpiryCandles} candles` : null;
  } else if (failed(["riskReward"])) {
    status = "REJECTED";
    reason = r.rr === null ? "No opposing liquidity to target" : `Risk/reward 1:${r.rr.toFixed(2)} is below the 1:${params.minRiskReward} minimum`;
  } else {
    status = "READY";
  }

  return {
    side,
    key: `${side}:${r.key}`,
    status,
    reason,
    conditions,
    htfBias: biases,
    zone,
    zoneKind: r.zoneKind,
    stopLoss: px(r.stopLoss),
    takeProfit: px(r.takeProfit),
    riskReward: r.rr,
    entryPrice: data.last,
    sweep: { price: px(r.sweep.price), label: r.sweep.label, time: r.sweep.candleTime },
    ageCandles: r.ageCandles,
  };
}

/** Market overview for the admin "current analysis" view. */
export function marketOverview(data, params) {
  const s = structure(data.setup, params.swingLength);
  const a = atr(data.setup, 14);
  const lv = sessionLevels(data.setup);
  const highs = s.swings.filter((x) => x.type === "H" && x.price > data.last).sort((x, y) => x.price - y.price);
  const lows = s.swings.filter((x) => x.type === "L" && x.price < data.last).sort((x, y) => y.price - x.price);
  const n = data.setup.length;
  const fvgs = bullishFvgs(data.setup, n - 30, n - 1).filter((g) => !data.setup.slice(g.i + 2).some((x) => x.close < g.low));
  const bearFvgs = bullishFvgs(mirrorCandles(data.setup), n - 30, n - 1)
    .filter((g) => !mirrorCandles(data.setup).slice(g.i + 2).some((x) => x.close < g.low))
    .map((g) => ({ low: -g.high, high: -g.low, time: g.time }));
  return {
    last: data.last,
    bias: data.bias.map((b) => ({ tf: b.tf, trend: structure(b.candles, params.swingLength).trend })),
    setupTrend: s.trend,
    lastEvent: s.lastEvent ? { type: s.lastEvent.type, dir: s.lastEvent.dir, level: s.lastEvent.level, time: s.lastEvent.time } : null,
    atr: a,
    liquidityAbove: highs[0]?.price ?? null,
    liquidityBelow: lows[0]?.price ?? null,
    prevDayHigh: lv.prevDayHigh?.price ?? null,
    prevDayLow: lv.prevDayLow?.price ?? null,
    asiaHigh: lv.asiaHigh?.price ?? null,
    asiaLow: lv.asiaLow?.price ?? null,
    bullishFvgs: fvgs.slice(-3).map((g) => ({ low: g.low, high: g.high, time: g.time })),
    bearishFvgs: bearFvgs.slice(-3),
  };
}
