import { route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";
import { enabledSymbols, getBotConfig } from "@/lib/autobot/config";

/** Latest market analysis for each enabled instrument. */
export const GET = route({ admin: "autobot.manage" }, async () => {
  const { settings } = await getBotConfig();
  const symbols = enabledSymbols(settings);
  const rows = await prisma.autoBotAnalysis.findMany({ where: { symbol: { in: symbols } } });
  return symbols.map((symbol) => {
    const r = rows.find((x) => x.symbol === symbol);
    return { symbol, updatedAt: r?.updatedAt ?? null, ...(r?.data ?? {}) };
  });
});
