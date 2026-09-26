import "server-only";
import { D, ZERO } from "@/lib/db/decimal";

/** Adds quantity at a total cost (quote currency, fees included) — weighted-average cost basis. */
export async function addToPosition(tx, userId, assetId, quantity, totalCost) {
  const existing = await tx.position.findUnique({ where: { userId_assetId: { userId, assetId } } });
  const q0 = existing?.quantity ?? ZERO;
  const c0 = q0.mul(existing?.avgCost ?? ZERO);
  const q1 = q0.plus(quantity);
  const avg = q1.gt(0) ? c0.plus(totalCost).div(q1).toDecimalPlaces(18) : ZERO;
  await tx.position.upsert({
    where: { userId_assetId: { userId, assetId } },
    create: { userId, assetId, quantity: q1, avgCost: avg },
    update: { quantity: q1, avgCost: avg },
  });
}

/** Removes quantity with net proceeds; books realised P&L against average cost. */
export async function reducePosition(tx, userId, assetId, quantity, netProceeds) {
  const existing = await tx.position.findUnique({ where: { userId_assetId: { userId, assetId } } });
  if (!existing) return;
  const q = D(quantity);
  const tracked = q.gt(existing.quantity) ? existing.quantity : q;
  // Only the tracked portion has a known cost basis.
  const proceedsForTracked = q.gt(0) ? D(netProceeds).mul(tracked).div(q) : ZERO;
  const realized = proceedsForTracked.minus(tracked.mul(existing.avgCost));
  const remaining = existing.quantity.minus(tracked);
  await tx.position.update({
    where: { id: existing.id },
    data: {
      quantity: remaining.lt(0) ? ZERO : remaining,
      realizedPnl: existing.realizedPnl.plus(realized).toDecimalPlaces(18),
      ...(remaining.lte(0) ? { avgCost: ZERO } : {}),
    },
  });
}
