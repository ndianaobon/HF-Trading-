import "server-only";

// No external exchange is connected, so every order (in demo and live mode) is
// filled by the internal simulator at live market prices. Orders and trades are
// flagged as simulated and labelled that way in the UI.
const SIMULATOR = {
  name: "HarborFinance Simulator",
  simulated: true,
  maxFillNotionalPerCycle: 50_000,
};

export function getVenue() {
  return SIMULATOR;
}

export function venueStatus() {
  return { available: true, simulated: true, name: SIMULATOR.name };
}
