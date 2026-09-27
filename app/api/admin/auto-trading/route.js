import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { listMarkets } from "@/lib/market-data/service";
import { venueStatus } from "@/lib/trading/venue";
import { UNAVAILABLE_INSTRUMENTS, enabledSymbols, getBotConfig } from "@/lib/autobot/config";
import { setBotStatus } from "@/lib/autobot/engine";
import { startOfUtcDay } from "@/lib/autobot/risk";
import { botPerformance } from "@/lib/autobot/stats";

/** Bot status, settings, health, instrument catalogue and performance. */
export const GET = route({ admin: "autobot.manage" }, async () => {
  const [cfg, markets, participants, signalsToday, perf] = await Promise.all([
    getBotConfig(),
    listMarkets(),
    prisma.autoBotParticipant.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.autoBotSignal.groupBy({ by: ["status"], where: { createdAt: { gte: startOfUtcDay() } }, _count: { _all: true } }),
    botPerformance(),
  ]);
  const by = (rows) => Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  return {
    status: cfg.status,
    statusReason: cfg.statusReason,
    statusChangedAt: cfg.statusChangedAt,
    statusChangedBy: cfg.statusChangedBy,
    settings: cfg.settings,
    health: cfg.health,
    venue: venueStatus(),
    enabledCount: enabledSymbols(cfg.settings).length,
    instruments: {
      tradable: markets
        .filter((m) => m.status === "ACTIVE" && m.quote.symbol === "USDT" && !m.categories.includes("STABLECOIN"))
        .map((m) => ({ symbol: m.symbol, name: m.base.name, alias: m.symbol === "BTC-USDT" ? "BTCUSD" : null, ...(cfg.settings.instruments[m.symbol] ?? { enabled: false }) })),
      unavailable: UNAVAILABLE_INSTRUMENTS,
    },
    participants: by(participants),
    signalsToday: by(signalsToday),
    performance: perf,
  };
});

const body = z.object({ action: z.enum(["start", "pause", "resume", "stop"]), reason: z.string().trim().max(300).optional() });

/** Start / pause / resume / emergency stop. Stopping never closes positions by itself. */
export const PATCH = route({ admin: "autobot.manage", body }, async ({ session, body, ip }) => {
  const cfg = await getBotConfig();
  const actor = { id: session.user.id, email: session.user.email, ip };
  if ((body.action === "start" || body.action === "resume") && !enabledSymbols(cfg.settings).length) {
    throw new AppError("CONFLICT", "Enable at least one instrument before starting the bot.");
  }
  if (body.action === "resume" && cfg.status !== "PAUSED") throw new AppError("CONFLICT", "Only a paused bot can be resumed.");
  if (body.action === "pause" && cfg.status !== "RUNNING") throw new AppError("CONFLICT", "Only a running bot can be paused.");
  const status = { start: "RUNNING", resume: "RUNNING", pause: "PAUSED", stop: "STOPPED" }[body.action];
  await setBotStatus(status, { actor, reason: body.reason ?? (body.action === "stop" ? "Emergency stop" : null) });
  return { status };
});
