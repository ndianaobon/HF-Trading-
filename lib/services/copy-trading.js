import "server-only";
import { prisma, withTransaction } from "@/lib/db/prisma";
import { D, ZERO } from "@/lib/db/decimal";
import { AppError } from "@/lib/api/errors";
import { isDemoMode } from "@/lib/config";
import * as wallet from "@/lib/trading/wallet-service";
import { recordTransaction } from "@/lib/trading/transaction-service";
import { announce, createNotification } from "@/lib/notifications/service";
import { publish } from "@/lib/realtime/bus";
import { audit } from "./audit";

export async function startCopying(userId, traderId, cfg) {
  const trader = await prisma.copyTrader.findUnique({ where: { id: traderId } });
  if (!trader || !trader.isActive) throw new AppError("NOT_FOUND", "This trader is not available.");
  const allocation = D(cfg.allocation);
  const max = D(cfg.maxAllocation);
  if (allocation.lt(trader.minAllocation)) throw new AppError("BELOW_MINIMUM", `Minimum allocation is ${trader.minAllocation} USDT.`);
  if (max.lt(allocation)) throw new AppError("VALIDATION_ERROR", "Maximum allocation must be at least the allocation amount.");
  const usdt = await wallet.assetBySymbol("USDT");

  const res = await withTransaction(async (tx) => {
    const existing = await tx.copySubscription.findFirst({ where: { userId, traderId, status: { not: "STOPPED" } } });
    if (existing) throw new AppError("CONFLICT", "You are already copying this trader.");
    await wallet.debit(tx, userId, usdt.id, allocation);
    const sub = await tx.copySubscription.create({
      data: { userId, traderId, allocation, maxAllocation: max, stopLossPct: D(cfg.stopLossPct), isDemo: isDemoMode() || trader.isDemo },
    });
    await recordTransaction(tx, {
      userId,
      type: "COPY_TRADING",
      direction: "DEBIT",
      assetId: usdt.id,
      amount: allocation,
      isDemo: sub.isDemo,
      description: `Copy allocation: ${trader.displayName}`,
      metadata: { subscriptionId: sub.id },
    });
    await tx.copyTrader.update({ where: { id: traderId }, data: { followers: { increment: 1 } } });
    const n = await createNotification(
      {
        userId,
        type: "INVESTMENT_UPDATE",
        title: `Now copying ${trader.displayName}`,
        body: `${allocation} USDT allocated. Stop-copy threshold: ${cfg.stopLossPct}% drawdown.`,
        link: "/dashboard/copy-trading",
      },
      tx,
    );
    return { sub, n };
  });
  announce(res.n);
  publish(userId, { type: "wallet.updated", assets: ["USDT"] });
  return res.sub;
}

export async function updateCopy(userId, id, patch) {
  const sub = await prisma.copySubscription.findUnique({ where: { id } });
  if (!sub || sub.userId !== userId) throw new AppError("NOT_FOUND");
  if (sub.status === "STOPPED") throw new AppError("CONFLICT", "This copy relationship has ended.");
  if (patch.maxAllocation && D(patch.maxAllocation).lt(sub.allocation))
    throw new AppError("VALIDATION_ERROR", "Maximum allocation cannot be below the current allocation.");
  return prisma.copySubscription.update({
    where: { id },
    data: {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.maxAllocation ? { maxAllocation: D(patch.maxAllocation) } : {}),
      ...(patch.stopLossPct !== undefined ? { stopLossPct: D(patch.stopLossPct) } : {}),
    },
  });
}

/** Stops copying and returns allocation ± recorded P&L to the wallet. */
export async function stopCopying(userId, id, actor) {
  const res = await withTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CopySubscription" WHERE id = ${id} FOR UPDATE`;
    const sub = await tx.copySubscription.findUnique({ where: { id }, include: { trader: true } });
    if (!sub || (!actor && sub.userId !== userId)) throw new AppError("NOT_FOUND");
    if (sub.status === "STOPPED") throw new AppError("CONFLICT", "Already stopped.");
    let payout = sub.allocation.plus(sub.pnl);
    if (payout.lt(0)) payout = ZERO;
    const usdt = await tx.asset.findUniqueOrThrow({ where: { symbol: "USDT" } });
    if (payout.gt(0)) await wallet.credit(tx, sub.userId, usdt.id, payout);
    const updated = await tx.copySubscription.update({ where: { id }, data: { status: "STOPPED", stoppedAt: new Date() } });
    if (payout.gt(0))
      await recordTransaction(tx, {
        userId: sub.userId,
        type: "COPY_TRADING",
        direction: "CREDIT",
        assetId: usdt.id,
        amount: payout,
        isDemo: sub.isDemo,
        description: `Stopped copying ${sub.trader.displayName}`,
        metadata: { subscriptionId: id, pnl: sub.pnl.toString() },
      });
    await tx.copyTrader.update({ where: { id: sub.traderId }, data: { followers: { decrement: sub.trader.followers > 0 ? 1 : 0 } } });
    if (actor) await audit({ actorId: actor.id, actorEmail: actor.email, ip: actor.ip, action: "copy.stop", targetType: "CopySubscription", targetId: id }, tx);
    const n = await createNotification(
      {
        userId: sub.userId,
        type: "INVESTMENT_UPDATE",
        title: `Stopped copying ${sub.trader.displayName}`,
        body: `${payout} USDT returned to your wallet.`,
        link: "/dashboard/copy-trading",
      },
      tx,
    );
    return { updated, n };
  });
  announce(res.n);
  publish(res.updated.userId, { type: "wallet.updated", assets: ["USDT"] });
  return res.updated;
}
