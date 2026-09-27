import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { listMarkets } from "@/lib/market-data/service";
import { audit } from "@/lib/services/audit";
import { saveBotSettings } from "@/lib/autobot/config";

/** Replaces the bot settings (strategy, timeframes, risk, sessions, instruments, news, participation). */
export const PUT = route({ admin: "autobot.manage", body: z.object({ settings: z.record(z.any()) }) }, async ({ session, body, ip }) => {
  const markets = new Set((await listMarkets()).filter((m) => m.status === "ACTIVE").map((m) => m.symbol));
  for (const [symbol, v] of Object.entries(body.settings.instruments ?? {})) {
    if (v?.enabled && !markets.has(symbol)) throw new AppError("VALIDATION_ERROR", `${symbol} is not a tradable market on the platform.`);
  }
  const saved = await saveBotSettings(body.settings);
  await audit({ actorId: session.user.id, actorEmail: session.user.email, ip, action: "autobot.settings", targetType: "AutoBotConfig", targetId: "default", metadata: { settings: saved } });
  return saved;
});
