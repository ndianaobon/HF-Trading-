import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

/**
 * Automated trading bot configuration (AutoBotConfig row "default").
 * Everything here is set by an administrator; defaults are conservative and the
 * bot starts STOPPED with no instruments enabled.
 */

export const TIMEFRAMES = { "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "4h": 240, "1d": 1440 };
const tf = z.enum(Object.keys(TIMEFRAMES));
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (UTC)");
const pct = (max) => z.coerce.number().min(0).max(max);

export const settingsSchema = z
  .object({
    strategy: z.literal("SMC_ICT").default("SMC_ICT"),
    timeframes: z.object({
      bias: z.array(tf).min(1).max(3),
      setup: tf,
      entry: tf,
    }),
    strategyParams: z.object({
      swingLength: z.coerce.number().int().min(1).max(10),
      sweepLookback: z.coerce.number().int().min(5).max(100),
      displacementAtr: z.coerce.number().min(0.5).max(5),
      entryZone: z.enum(["FVG_OR_OB", "FVG", "OB"]),
      requireHtfAlignment: z.boolean(),
      htfMode: z.enum(["ALL", "ANY"]),
      requireDisplacement: z.boolean(),
      requirePremiumDiscount: z.boolean(),
      requireLtfConfirmation: z.boolean(),
      setupExpiryCandles: z.coerce.number().int().min(2).max(100),
      takeProfitMode: z.enum(["LIQUIDITY", "FIXED_RR"]),
      fixedRiskReward: z.coerce.number().min(1).max(20),
      stopBufferAtr: z.coerce.number().min(0).max(2),
    }),
    risk: z.object({
      riskPerTradePct: z.coerce.number().min(0.05).max(5),
      maxOpenTrades: z.coerce.number().int().min(1).max(50),
      maxDailyLossPct: pct(50).refine((v) => v > 0, "Must be above 0"),
      maxDrawdownPct: pct(90).refine((v) => v > 0, "Must be above 0"),
      maxExposurePerInstrumentPct: pct(100).refine((v) => v > 0, "Must be above 0"),
      maxTotalExposurePct: pct(100).refine((v) => v > 0, "Must be above 0"),
      maxConsecutiveLosses: z.coerce.number().int().min(1).max(20),
      /** Spot markets cannot be leveraged: positions are paid in full. */
      maxLeverage: z.literal(1).default(1),
      /** Every bot trade carries a stop loss; this cannot be turned off. */
      requireStopLoss: z.literal(true).default(true),
      minRiskReward: z.coerce.number().min(0.5).max(20),
    }),
    sessions: z
      .array(z.object({ key: z.string().max(20), label: z.string().max(40), start: hhmm, end: hhmm, enabled: z.boolean() }))
      .max(8),
    instruments: z.record(
      z.string().regex(/^[A-Z0-9]{2,10}-[A-Z]{3,5}$/),
      z.object({
        enabled: z.boolean(),
        maxExposurePct: pct(100).nullable().optional(),
        hours: z.object({ start: hhmm, end: hhmm }).nullable().optional(),
      }),
    ),
    news: z.object({
      enabled: z.boolean(),
      events: z
        .array(
          z.object({
            id: z.string().max(40),
            title: z.string().trim().min(2).max(120),
            time: z.string().datetime(),
            instruments: z.array(z.string().max(20)).max(40),
            before: z.coerce.number().int().min(0).max(720),
            after: z.coerce.number().int().min(0).max(720),
          }),
        )
        .max(200),
    }),
    participation: z.object({
      availableToUsers: z.boolean(),
      mode: z.enum(["USER_OPT_IN", "ADMIN_ONLY"]),
      minEquity: z.coerce.number().min(0),
    }),
  })
  .superRefine((s, ctx) => {
    const m = (t) => TIMEFRAMES[t];
    if (s.timeframes.bias.some((b) => m(b) <= m(s.timeframes.setup))) ctx.addIssue({ code: "custom", path: ["timeframes", "bias"], message: "Bias timeframes must be higher than the setup timeframe" });
    if (m(s.timeframes.setup) <= m(s.timeframes.entry)) ctx.addIssue({ code: "custom", path: ["timeframes", "entry"], message: "The entry timeframe must be lower than the setup timeframe" });
  });

export const DEFAULT_SETTINGS = {
  strategy: "SMC_ICT",
  timeframes: { bias: ["4h", "1h"], setup: "15m", entry: "5m" },
  strategyParams: {
    swingLength: 3,
    sweepLookback: 24,
    displacementAtr: 1.2,
    entryZone: "FVG_OR_OB",
    requireHtfAlignment: true,
    htfMode: "ALL",
    requireDisplacement: true,
    requirePremiumDiscount: true,
    requireLtfConfirmation: true,
    setupExpiryCandles: 16,
    takeProfitMode: "LIQUIDITY",
    fixedRiskReward: 3,
    stopBufferAtr: 0.2,
  },
  risk: {
    riskPerTradePct: 1,
    maxOpenTrades: 5,
    maxDailyLossPct: 3,
    maxDrawdownPct: 10,
    maxExposurePerInstrumentPct: 20,
    maxTotalExposurePct: 50,
    maxConsecutiveLosses: 3,
    maxLeverage: 1,
    requireStopLoss: true,
    minRiskReward: 2,
  },
  sessions: [
    { key: "ASIA", label: "Asian session", start: "23:00", end: "08:00", enabled: false },
    { key: "LONDON", label: "London session", start: "07:00", end: "16:00", enabled: true },
    { key: "NEW_YORK", label: "New York session", start: "12:00", end: "21:00", enabled: true },
  ],
  instruments: {},
  news: { enabled: true, events: [] },
  participation: { availableToUsers: true, mode: "USER_OPT_IN", minEquity: 100 },
};

/**
 * Instruments requested for the bot that the platform cannot trade: they have no
 * tradable market, no execution venue and no reliable real-time feed, and they
 * need short selling / leverage, which spot trading does not offer. They are shown
 * to administrators as unavailable and can never be enabled.
 */
export const UNAVAILABLE_INSTRUMENTS = [
  ["XAUUSD", "Gold", "Metals"],
  ["XAGUSD", "Silver", "Metals"],
  ["EURUSD", "Euro / US Dollar", "Forex majors"],
  ["GBPUSD", "British Pound / US Dollar", "Forex majors"],
  ["USDJPY", "US Dollar / Japanese Yen", "Forex majors"],
  ["USDCHF", "US Dollar / Swiss Franc", "Forex majors"],
  ["USDCAD", "US Dollar / Canadian Dollar", "Forex majors"],
  ["AUDUSD", "Australian Dollar / US Dollar", "Forex majors"],
  ["NZDUSD", "New Zealand Dollar / US Dollar", "Forex majors"],
  ["EURGBP", "Euro / British Pound", "Forex crosses"],
  ["EURJPY", "Euro / Japanese Yen", "Forex crosses"],
  ["GBPJPY", "British Pound / Japanese Yen", "Forex crosses"],
  ["AUDJPY", "Australian Dollar / Japanese Yen", "Forex crosses"],
  ["EURAUD", "Euro / Australian Dollar", "Forex crosses"],
  ["GBPAUD", "British Pound / Australian Dollar", "Forex crosses"],
  ["AUDCAD", "Australian Dollar / Canadian Dollar", "Forex crosses"],
  ["CADJPY", "Canadian Dollar / Japanese Yen", "Forex crosses"],
].map(([symbol, name, group]) => ({ symbol, name, group, reason: "No tradable market or execution venue on the platform (requires a forex/CFD broker with short selling)." }));

/** Merges stored settings over the defaults, so new fields always have a value. */
function withDefaults(stored) {
  const s = stored && typeof stored === "object" ? stored : {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    timeframes: { ...DEFAULT_SETTINGS.timeframes, ...s.timeframes },
    strategyParams: { ...DEFAULT_SETTINGS.strategyParams, ...s.strategyParams },
    risk: { ...DEFAULT_SETTINGS.risk, ...s.risk, maxLeverage: 1, requireStopLoss: true },
    sessions: s.sessions ?? DEFAULT_SETTINGS.sessions,
    instruments: s.instruments ?? {},
    news: { ...DEFAULT_SETTINGS.news, ...s.news },
    participation: { ...DEFAULT_SETTINGS.participation, ...s.participation },
  };
}

export async function getBotConfig() {
  const row = await prisma.autoBotConfig.upsert({ where: { id: "default" }, create: { id: "default", settings: DEFAULT_SETTINGS }, update: {} });
  const parsed = settingsSchema.safeParse(withDefaults(row.settings));
  return { ...row, settings: parsed.success ? parsed.data : DEFAULT_SETTINGS };
}

export async function saveBotSettings(settings) {
  const parsed = settingsSchema.parse(withDefaults(settings));
  await prisma.autoBotConfig.upsert({ where: { id: "default" }, create: { id: "default", settings: parsed }, update: { settings: parsed } });
  return parsed;
}

export const enabledSymbols = (settings) =>
  Object.entries(settings.instruments)
    .filter(([, v]) => v.enabled)
    .map(([k]) => k);
