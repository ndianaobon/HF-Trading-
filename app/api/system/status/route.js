import { route } from "@/lib/api/route";
import { isDemoMode } from "@/lib/config";
import { getTickers, feedError } from "@/lib/market-data/service";
import { venueStatus } from "@/lib/trading/venue";
import { getSetting } from "@/lib/services/settings";

export const GET = route({ auth: "none" }, async () => {
  let feed = null;
  try {
    feed = (await getTickers()).status;
  } catch {
    feed = null;
  }
  const maintenance = await getSetting("platform.maintenance");
  return {
    mode: isDemoMode() ? "demo" : "live",
    marketData: feed ? { ...feed, available: true } : { available: false, error: feedError() ? "Provider unreachable" : null },
    execution: venueStatus(),
    maintenance,
    serverTime: Date.now(),
  };
});
