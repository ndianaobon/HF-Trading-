import "server-only";
import { prisma, withTransaction } from "@/lib/db/prisma";
import { D } from "@/lib/db/decimal";
import { AppError } from "@/lib/api/errors";
import { isDemoMode } from "@/lib/config";
import { getUsdtPrices } from "@/lib/market-data/service";
import * as wallet from "@/lib/trading/wallet-service";
import { recordTransaction } from "@/lib/trading/transaction-service";
import { addToPosition, reducePosition } from "@/lib/trading/positions";
import { announce, createNotification } from "@/lib/notifications/service";
import { publish } from "@/lib/realtime/bus";
import { audit } from "./audit";

/**
 * Manual balance adjustment by an administrator (corrections, manual credits).
 * Always recorded as an ADJUSTMENT in the user's ledger — visible in their
 * account statement — with the admin, reason and before/after balance in the
 * audit log. Debits can't take the available balance below zero.
 */
export async function adjustBalance(userId, input, actor) {
  if (userId === actor.id) throw new AppError("FORBIDDEN", "You can't adjust your own balance.");
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { adminUser: true } });
  if (!user) throw new AppError("NOT_FOUND");
  if (user.adminUser && actor.role !== "SUPER_ADMIN") throw new AppError("FORBIDDEN", "Only a super admin can adjust staff balances.");
  const asset = await wallet.assetBySymbol(input.asset);
  const amount = D(input.amount);
  if (!amount.isFinite() || amount.lte(0)) throw new AppError("VALIDATION_ERROR", "Enter an amount greater than zero.");
  const credit = input.direction === "CREDIT";

  // Cost basis for non-USDT assets at the current price, so portfolio P&L stays meaningful.
  let price = null;
  if (asset.symbol !== "USDT") {
    price = await getUsdtPrices()
      .then((p) => p.prices[asset.symbol] ?? null)
      .catch(() => null);
  }

  const res = await withTransaction(async (tx) => {
    const before = await wallet.ensureWallet(tx, userId, asset.id);
    if (credit) await wallet.credit(tx, userId, asset.id, amount);
    else await wallet.debit(tx, userId, asset.id, amount);
    if (price) {
      if (credit) await addToPosition(tx, userId, asset.id, amount, amount.mul(price));
      else await reducePosition(tx, userId, asset.id, amount, amount.mul(price));
    }
    const note = input.note?.trim() || null;
    const t = await recordTransaction(tx, {
      userId,
      type: "ADJUSTMENT",
      direction: credit ? "CREDIT" : "DEBIT",
      assetId: asset.id,
      amount,
      isDemo: isDemoMode(),
      description: note ? `Balance adjustment: ${note}` : "Balance adjustment",
      metadata: { adjustment: true },
    });
    const after = await tx.wallet.findUniqueOrThrow({ where: { userId_assetId: { userId, assetId: asset.id } } });
    await audit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        ip: actor.ip,
        userAgent: actor.userAgent,
        action: `balance.${credit ? "credit" : "debit"}`,
        targetType: "User",
        targetId: userId,
        metadata: {
          asset: asset.symbol,
          amount: amount.toString(),
          reason: input.reason,
          note,
          reference: t.reference,
          availableBefore: before.available.toString(),
          availableAfter: after.available.toString(),
        },
      },
      tx,
    );
    const n = await createNotification(
      {
        userId,
        type: "SYSTEM_ANNOUNCEMENT",
        title: `Balance ${credit ? "credited" : "debited"}: ${credit ? "+" : "−"}${amount} ${asset.symbol}`,
        body: note ?? `HarborFinance made a balance adjustment to your ${asset.symbol} wallet. Reference ${t.reference}.`,
        link: "/dashboard/transactions",
      },
      tx,
    );
    return { t, n, after };
  });
  announce(res.n);
  publish(userId, { type: "wallet.updated", assets: [asset.symbol] });
  return { reference: res.t.reference, available: res.after.available.toString() };
}
