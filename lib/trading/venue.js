import "server-only";
import { isDemoMode } from "@/lib/config";
import { AppError } from "@/lib/api/errors";

const SIMULATOR = {
  name: "HarborFinance Simulator",
  simulated: true,
  maxFillNotionalPerCycle: 50_000,
};

export function getVenue() {
  if (isDemoMode()) return SIMULATOR;
  throw new AppError("ORDER_REJECTED", "Live order routing is not yet available on this platform.");
}

export function venueStatus() {
  if (isDemoMode()) return { available: true, simulated: true, name: SIMULATOR.name };
  return { available: false, simulated: false, name: "Not configured" };
}
