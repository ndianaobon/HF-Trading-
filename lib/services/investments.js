import "server-only";
import { prisma, withTransaction } from "@/lib/db/prisma";
import { D, ZERO } from "@/lib/db/decimal";
import { AppError } from "@/lib/api/errors";
import { isDemoMode } from "@/lib/config";
import * as wallet from "@/lib/trading/wallet-service";
import { recordTransaction } from "@/lib/trading/transaction-service";
import { announce, createNotification } from "@/lib/notifications/service";
import { publish } from "@/lib/realtime/bus";
import { getSetting } from "./settings";
import { audit } from "./audit";

/**
 * Investment plans are managed strategies. HarborFinance never projects or
 * guarantees returns: a subscription's result is only known when it is
 * settled, using the realised P&L recorded by the strategy manager.
 */

export async function subscribeToPlan(userId, input) {
  if (!input.acceptTerms) throw new AppError("VALIDATION_ERROR", "You must accept the plan terms and risk disclosure.");
  const plan = await prisma.investmentPlan.findUnique({ where: { id: input.planId }, include: { asset: true } });
  if (!plan || plan.status !== "ACTIVE") throw new AppError("NOT_FOUND", "This plan is not available.");
  const amount = D(input.amount);
  if (!amount.isFinite() || amount.lt(plan.minAllocation))
    throw new AppError("BELOW_MINIMUM", `Minimum allocation is ${plan.minAllocation} ${plan.asset.symbol}.`);
  if (amount.gt(plan.maxAllocation)) throw new AppError("ABOVE_MAXIMUM", `Maximum allocation is ${plan.maxAllocation} ${plan.asset.symbol}.`);

  const kyc = await getSetting("kyc.requirements");
  if (kyc.requiredForInvestments && !isDemoMode()) {
    const approved = await prisma.kycApplication.findFirst({ where: { userId, status: "APPROVED" } });
    if (!approved) throw new AppError("KYC_REQUIRED");
  }

  const res = await withTransaction(async (tx) => {
    await wallet.debit(tx, userId, plan.assetId, amount);
    const sub = await tx.investmentSubscription.create({
      data: { userId, planId: plan.id, amount, status: "PENDING", termsAcceptedAt: new Date(), isDemo: isDemoMode() },
    });
    await recordTransaction(tx, {
      userId,
      type: "INVESTMENT",
      direction: "DEBIT",
      assetId: plan.assetId,
      amount,
      isDemo: sub.isDemo,
      description: `Allocation to ${plan.name} plan`,
      metadata: { subscriptionId: sub.id },
    });
    const n = await createNotification(
      {
        userId,
        type: "INVESTMENT_UPDATE",
        title: `Subscription received: ${plan.name}`,
        body: `Your ${amount} ${plan.asset.symbol} allocation is pending and will be activated at the next allocation window.`,
        link: "/dashboard/investments",
      },
      tx,
    );
    return { sub, n };
  });
  announce(res.n);
  publish(userId, { type: "wallet.updated", assets: [plan.asset.symbol] });
  return res.sub;
}

export async function activateSubscription(id, actor) {
  return withTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "InvestmentSubscription" WHERE id = ${id} FOR UPDATE`;
    const sub = await tx.investmentSubscription.findUnique({ where: { id }, include: { plan: true } });
    if (!sub || sub.status !== "PENDING") return null;
    const now = new Date();
    const updated = await tx.investmentSubscription.update({
      where: { id },
      data: { status: "ACTIVE", startedAt: now, endsAt: new Date(now.getTime() + sub.plan.durationDays * 86_400_000) },
    });
    await createNotification(
      {
        userId: sub.userId,
        type: "INVESTMENT_UPDATE",
        title: `${sub.plan.name} subscription active`,
        body: `Your allocation is now active for ${sub.plan.durationDays} days. Results will vary and are not guaranteed.`,
        link: "/dashboard/investments",
      },
      tx,
    );
    if (actor)
      await audit(
        { actorId: actor.id, actorEmail: actor.email, ip: actor.ip, action: "investment.activate", targetType: "InvestmentSubscription", targetId: id },
        tx,
      );
    return updated;
  });
}

function feesFor(amount, pnl, plan, days) {
  const mgmt = amount.mul(plan.managementFeePct).div(100).mul(days).div(365);
  const perf = pnl.gt(0) ? pnl.mul(plan.performanceFeePct).div(100) : ZERO;
  return mgmt.plus(perf).toDecimalPlaces(8);
}

/**
 * Settles a subscription with the realised P&L recorded by the manager
 * (admin). Payout = principal + realised P&L − fees (floored at zero).
 */
export async function settleSubscription(id, realizedPnl, actor, mode = "COMPLETED") {
  const res = await withTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "InvestmentSubscription" WHERE id = ${id} FOR UPDATE`;
    const sub = await tx.investmentSubscription.findUnique({ where: { id }, include: { plan: true } });
    if (!sub) throw new AppError("NOT_FOUND");
    if (sub.status !== "ACTIVE" && sub.status !== "PENDING") throw new AppError("CONFLICT", "Subscription is already closed.");
    const pnl = sub.status === "PENDING" ? ZERO : D(realizedPnl);
    const days = sub.startedAt ? Math.max(0, (Date.now() - sub.startedAt.getTime()) / 86_400_000) : 0;
    let fees = sub.status === "PENDING" ? ZERO : feesFor(sub.amount, pnl, sub.plan, days);
    if (mode === "CANCELLED" && sub.status === "ACTIVE") fees = fees.plus(sub.amount.mul(sub.plan.earlyExitFeePct).div(100)).toDecimalPlaces(8);
    let payout = sub.amount.plus(pnl).minus(fees);
    if (payout.lt(0)) payout = ZERO;
    if (payout.gt(0)) await wallet.credit(tx, sub.userId, sub.plan.assetId, payout);
    const updated = await tx.investmentSubscription.update({
      where: { id },
      data: {
        status: mode,
        realizedPnl: pnl,
        feesCharged: fees,
        completedAt: mode === "COMPLETED" ? new Date() : null,
        cancelledAt: mode === "CANCELLED" ? new Date() : null,
      },
    });
    if (payout.gt(0)) {
      await recordTransaction(tx, {
        userId: sub.userId,
        type: "INVESTMENT",
        direction: "CREDIT",
        assetId: sub.plan.assetId,
        amount: payout,
        fee: fees,
        isDemo: sub.isDemo,
        description: `${sub.plan.name} plan ${mode === "COMPLETED" ? "settlement" : "cancellation"}`,
        metadata: { subscriptionId: id, realizedPnl: pnl.toString() },
      });
    }
    const n = await createNotification(
      {
        userId: sub.userId,
        type: "INVESTMENT_UPDATE",
        title: `${sub.plan.name} subscription ${mode === "COMPLETED" ? "settled" : "cancelled"}`,
        body: `${payout.toString()} USDT was returned to your wallet (realised P&L ${pnl.toString()}, fees ${fees.toString()}).`,
        link: "/dashboard/investments",
      },
      tx,
    );
    await audit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        ip: actor.ip,
        action: `investment.${mode.toLowerCase()}`,
        targetType: "InvestmentSubscription",
        targetId: id,
        metadata: { realizedPnl: pnl.toString(), fees: fees.toString(), payout: payout.toString() },
      },
      tx,
    );
    return { updated, n };
  });
  announce(res.n);
  publish(res.updated.userId, { type: "wallet.updated", assets: ["USDT"] });
  return res.updated;
}

/** User-initiated cancellation: full refund while pending; early-exit terms when active. */
export async function cancelByUser(userId, id) {
  const sub = await prisma.investmentSubscription.findUnique({ where: { id }, include: { plan: true, user: true } });
  if (!sub || sub.userId !== userId) throw new AppError("NOT_FOUND");
  if (sub.status === "ACTIVE" && !sub.plan.earlyExitAllowed) throw new AppError("CONFLICT", "This plan does not allow early exit.");
  if (sub.status === "ACTIVE" && sub.endsAt && sub.endsAt <= new Date())
    throw new AppError("CONFLICT", "This plan's term has ended and is awaiting settlement.");
  return settleSubscription(id, "0", { id: userId, email: sub.user.email }, "CANCELLED");
}

/** Demo scheduler: pending subscriptions activate after a short allocation window. */
export async function processInvestmentQueue() {
  if (!isDemoMode()) return;
  const pending = await prisma.investmentSubscription.findMany({ where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 60_000) } }, take: 50 });
  for (const s of pending) {
    const updated = await activateSubscription(s.id).catch(() => null);
    if (updated) publish(s.userId, { type: "notification.created", id: s.id, title: "Investment active" });
  }
}
