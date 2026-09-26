import "server-only";
import { prisma } from "@/lib/db/prisma";
import { D } from "@/lib/db/decimal";
import { AppError } from "@/lib/api/errors";

/**
 * WalletService — the only code allowed to change balances.
 *
 * Every mutation is a single conditional UPDATE (… WHERE available >= amount),
 * so concurrent requests cannot overdraw a wallet. The database additionally
 * enforces CHECK (available >= 0 AND locked >= 0). All functions must be
 * called inside a transaction together with the matching ledger entry.
 */

function assertPositive(amount) {
  if (!D(amount).isFinite() || D(amount).lte(0)) throw new AppError("VALIDATION_ERROR", "Amount must be positive.");
}

export async function ensureWallet(tx, userId, assetId) {
  return tx.wallet.upsert({
    where: { userId_assetId: { userId, assetId } },
    create: { userId, assetId },
    update: {},
  });
}

export async function credit(tx, userId, assetId, amount) {
  assertPositive(amount);
  await ensureWallet(tx, userId, assetId);
  await tx.wallet.update({
    where: { userId_assetId: { userId, assetId } },
    data: { available: { increment: D(amount) } },
  });
}

export async function debit(tx, userId, assetId, amount) {
  assertPositive(amount);
  const { count } = await tx.wallet.updateMany({
    where: { userId, assetId, available: { gte: D(amount) } },
    data: { available: { decrement: D(amount) } },
  });
  if (count !== 1) throw new AppError("INSUFFICIENT_BALANCE");
}

/** Moves funds from available to locked (order reservations, pending withdrawals). */
export async function lock(tx, userId, assetId, amount) {
  assertPositive(amount);
  const { count } = await tx.wallet.updateMany({
    where: { userId, assetId, available: { gte: D(amount) } },
    data: { available: { decrement: D(amount) }, locked: { increment: D(amount) } },
  });
  if (count !== 1) throw new AppError("INSUFFICIENT_BALANCE");
}

/** Returns reserved funds to available. */
export async function unlock(tx, userId, assetId, amount) {
  if (D(amount).lte(0)) return;
  const { count } = await tx.wallet.updateMany({
    where: { userId, assetId, locked: { gte: D(amount) } },
    data: { locked: { decrement: D(amount) }, available: { increment: D(amount) } },
  });
  if (count !== 1) throw new Error(`Wallet invariant violated: cannot unlock ${amount} for ${userId}/${assetId}`);
}

/** Removes reserved funds from the wallet (they leave the account or are exchanged). */
export async function consumeLocked(tx, userId, assetId, amount) {
  if (D(amount).lte(0)) return;
  const { count } = await tx.wallet.updateMany({
    where: { userId, assetId, locked: { gte: D(amount) } },
    data: { locked: { decrement: D(amount) } },
  });
  if (count !== 1) throw new Error(`Wallet invariant violated: cannot consume ${amount} for ${userId}/${assetId}`);
}

export async function getWallets(userId) {
  const [assets, wallets] = await Promise.all([
    prisma.asset.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { symbol: "asc" }] }),
    prisma.wallet.findMany({ where: { userId } }),
  ]);
  const byAsset = new Map(wallets.map((w) => [w.assetId, w]));
  return assets.map((a) => {
    const w = byAsset.get(a.id);
    const available = w?.available ?? D(0);
    const locked = w?.locked ?? D(0);
    return {
      assetId: a.id,
      symbol: a.symbol,
      name: a.name,
      color: a.color,
      type: a.type,
      decimals: a.decimals,
      depositEnabled: a.depositEnabled,
      withdrawEnabled: a.withdrawEnabled,
      available,
      locked,
      total: available.plus(locked),
    };
  });
}

export async function assetBySymbol(symbol, db = prisma) {
  const asset = await db.asset.findUnique({ where: { symbol: symbol.toUpperCase() } });
  if (!asset || !asset.isActive) throw new AppError("NOT_FOUND", "Unknown asset.");
  return asset;
}
