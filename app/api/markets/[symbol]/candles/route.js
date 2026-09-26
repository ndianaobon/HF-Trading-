import { z } from "zod";
import { NextResponse } from "next/server";
import { route } from "@/lib/api/route";
import { getCandles } from "@/lib/market-data/service";
import { INTERVALS } from "@/lib/market-data/types";

const query = z.object({ interval: z.enum(INTERVALS).default("1h"), limit: z.coerce.number().int().min(50).max(1000).default(500) });

export const GET = route({ auth: "none", query }, async ({ params, query }) => {
  const candles = await getCandles(params.symbol, query.interval, query.limit);
  return NextResponse.json({ data: { candles, source: "Binance" } }, { headers: { "Cache-Control": "public, max-age=5" } });
});
