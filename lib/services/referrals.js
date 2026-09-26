import "server-only";
import { prisma, withTransaction } from "@/lib/db/prisma";
import { D } from "@/lib/db/decimal";
import { AppError } from "@/lib/api/errors";
import { isDemoMode } from "@/lib/config";
import { getSetting } from "./settings";
import { getUsdtPrices } from "@/lib/market-data/service";
import * as wallet from "@/lib/trading/wallet-service";
import { recordTransaction } from "@/lib/trading/transaction-service";
import { announce, createNotification } from "@/lib/notifications/service";
import { publish } from "@/lib/realtime/bus";
import { audit } from "./audit";

/** Links a new account to its referrer (called at registration). */
export async function linkReferral(referredId, code) {
  if (!code) return;
  const referrer = await prisma.user.findUnique({ where: { referralCode: code.trim().toUpperCase() } });
  if (!referrer || referrer.id === referredId) return;
  await prisma.referral.create({ data: { referrerId: referrer.id, referredId } }).catch(() => {});
}

/**
 * Qualifying-action hooks. Rewards are created as PENDING with the amount
 * configured by admins (default 0 = no monetary reward), and paid only after
 * review. Unique (referralId, reason) makes this idempotent.
 */
async function qualify(referredId, action) {
  const referral = await prisma.referral.findUnique({ where: { referredId } });
  if (!referral || referral.status !== "PENDING") return;
  const program = await getSetting("referral.program");
  if (!program.enabled || program.qualifyingAction !== action) return;

  await prisma.referral.update({ where: { id: referral.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
  if (program.rewardAmount <= 0) return;
  const asset = await prisma.asset.findUnique({ where: { symbol: program.rewardAsset } });
  if (!asset) return;
  await prisma.referralReward
    .create({
      data: {
        referralId: referral.id,
        userId: referral.referrerId,
        assetId: asset.id,
        amount: D(program.rewardAmount),
        reason: action,
        isDemo: isDemoMode(),
      },
    })
    .catch(() => {});
}

export async function onQualifyingDeposit(userId, depositId) {
  const program = await getSetting("referral.program");
  if (program.qualifyingAction !== "FIRST_DEPOSIT") return;
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId }, include: { asset: true } });
  if (!deposit) return;
  let value = deposit.amount.toNumber();
  if (deposit.asset.symbol !== "USDT") {
    const price = await getUsdtPrices()
      .then((p) => p.prices[deposit.asset.symbol])
      .catch(() => undefined);
    if (!price) return;
    value *= price;
  }
  if (value < program.minQualifyingDeposit) return;
  await qualify(userId, "FIRST_DEPOSIT");
}

export async function onKycApproved(userId) {
  await qualify(userId, "KYC_APPROVED");
}

export async function settleReward(rewardId, decision, actor) {
  const res = await withTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ReferralReward" WHERE id = ${rewardId} FOR UPDATE`;
    const r = await tx.referralReward.findUnique({ where: { id: rewardId }, include: { asset: true } });
    if (!r) throw new AppError("NOT_FOUND");
    if (r.status !== "PENDING") throw new AppError("CONFLICT", "Reward is already settled.");
    const updated = await tx.referralReward.update({
      where: { id: rewardId },
      data: { status: decision, paidAt: decision === "COMPLETED" ? new Date() : null },
    });
    let n = null;
    if (decision === "COMPLETED") {
      await wallet.credit(tx, r.userId, r.assetId, r.amount);
      await recordTransaction(tx, {
        userId: r.userId,
        type: "REFERRAL",
        direction: "CREDIT",
        assetId: r.assetId,
        amount: r.amount,
        isDemo: r.isDemo,
        description: "Referral reward",
      });
      n = await createNotification(
        {
          userId: r.userId,
          type: "SYSTEM_ANNOUNCEMENT",
          title: `Referral reward credited: ${r.amount} ${r.asset.symbol}`,
          body: "A referral reward has been added to your wallet.",
          link: "/dashboard/referrals",
        },
        tx,
      );
    }
    await audit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        ip: actor.ip,
        action: `referral.reward.${decision.toLowerCase()}`,
        targetType: "ReferralReward",
        targetId: rewardId,
        metadata: { amount: r.amount.toString() },
      },
      tx,
    );
    return { updated, n, asset: r.asset.symbol };
  });
  if (res.n) {
    announce(res.n);
    publish(res.updated.userId, { type: "wallet.updated", assets: [res.asset] });
  }
  return res.updated;
}
