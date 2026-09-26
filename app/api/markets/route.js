import { NextResponse } from "next/server";
import { route } from "@/lib/api/route";
import { marketsSnapshot } from "@/lib/market-data/snapshot";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "none" }, async () => {
  const data = await marketsSnapshot();
  return NextResponse.json({ data }, { headers: { "Cache-Control": "public, max-age=2, stale-while-revalidate=5" } });
});
