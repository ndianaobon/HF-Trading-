import { route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { z } from "zod";
import { enabledSymbols, getBotConfig } from "@/lib/autobot/config";
import { joinBot, setParticipantStatus } from "@/lib/autobot/engine";
import { botPerformance } from "@/lib/autobot/stats";

/** The signed-in user's view of the automated trading bot: only their own account. */
export const GET = route({ auth: "user" }, async ({ session }) => {
  const [cfg, participant] = await Promise.all([getBotConfig(), prisma.autoBotParticipant.findUnique({ where: { userId: session.user.id } })]);
  const { settings } = cfg;
  return {
    available: settings.participation.availableToUsers,
    mode: settings.participation.mode,
    minEquity: settings.participation.minEquity,
    botStatus: cfg.status,
    strategy: "SMC / ICT",
    riskPerTradePct: settings.risk.riskPerTradePct,
    maxOpenTrades: settings.risk.maxOpenTrades,
    maxDailyLossPct: settings.risk.maxDailyLossPct,
    minRiskReward: settings.risk.minRiskReward,
    timeframes: settings.timeframes,
    instruments: enabledSymbols(settings),
    sessions: settings.sessions.filter((s) => s.enabled).map((s) => `${s.label} ${s.start}–${s.end} UTC`),
    participant,
    performance: participant ? await botPerformance({ userId: session.user.id }) : null,
  };
});

/** Join (opt in). */
export const POST = route({ auth: "verified", rateLimit: RATE_LIMITS.money }, async ({ session }) => joinBot(session.user.id));

/** Pause / resume own participation (when the administrator allows users to control it). */
export const PATCH = route({ auth: "user", body: z.object({ action: z.enum(["pause", "resume"]) }) }, async ({ session, body }) =>
  setParticipantStatus(session.user.id, body.action === "pause" ? "PAUSED" : "ACTIVE"),
);

/** Leave: open bot positions are closed at market. */
export const DELETE = route({ auth: "user", rateLimit: RATE_LIMITS.money }, async ({ session }) => setParticipantStatus(session.user.id, "STOPPED", { closePositions: true }));
