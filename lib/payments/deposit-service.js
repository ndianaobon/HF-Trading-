import "server-only";
import { emails, sendLater } from "@/lib/email/mailer";
import { prisma, withTransaction } from "@/lib/db/prisma";
import { D } from "@/lib/db/decimal";
import { AppError } from "@/lib/api/errors";
import { isDemoMode } from "@/lib/config";
import * as wallet from "@/lib/trading/wallet-service";
import { recordTransaction } from "@/lib/trading/transaction-service";
import { addToPosition } from "@/lib/trading/positions";
import { getUsdtPrices } from "@/lib/market-data/service";
import { announce, createNotification } from "@/lib/notifications/service";
import { publish } from "@/lib/realtime/bus";
import { getSetting } from "@/lib/services/settings";
import { paymentProvider } from "./providers";
import { onQualifyingDeposit } from "@/lib/services/referrals";
import { audit } from "@/lib/services/audit";

const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function loadNetwork(assetSymbol, networkCode) {
  const network = await prisma.network.findFirst({
    where: { code: networkCode, asset: { symbol: assetSymbol.toUpperCase() } },
    include: { asset: true },
  });
  if (!network) throw new AppError("UNSUPPORTED_NETWORK");
  if (!network.asset.depositEnabled || !network.depositEnabled) throw new AppError("DEPOSIT_UNAVAILABLE");
  return network;
}

async function assertKycForDeposit(userId) {
  const req = await getSetting("kyc.requirements");
  if (!req.requiredForDeposit) return;
  const approved = await prisma.kycApplication.findFirst({ where: { userId, status: "APPROVED" } });
  if (!approved) throw new AppError("KYC_REQUIRED");
}

/** Deposit instructions. Addresses come only from the configured payment provider. */
export async function getDepositInstructions(userId, assetSymbol, networkCode) {
  const network = await loadNetwork(assetSymbol, networkCode);
  const address = isDemoMode() ? null : await paymentProvider().getDepositAddress(userId, network.id);
  return {
    asset: network.asset.symbol,
    network: { code: network.code, name: network.name },
    minDeposit: network.minDeposit.toString(),
    confirmations: network.confirmations,
    memoRequired: network.memoRequired,
    address,
    demo: isDemoMode(),
    available: isDemoMode() || address !== null,
    reason: isDemoMode()
      ? "Demo mode: on-chain deposit addresses are disabled. Use a simulated deposit to add test funds."
      : address
        ? null
        : "Deposits on this network are not available yet. No deposit address has been configured.",
  };
}

/**
 * Live/manual mode: user reports an on-chain transfer to a configured address.
 * The deposit stays PENDING until finance staff (or a provider webhook)
 * confirms it on-chain. Unique (network, txHash) prevents double crediting.
 */
export async function reportDeposit(userId, input) {
  if (isDemoMode()) throw new AppError("FEATURE_DISABLED", "Use simulated deposits in demo mode.");
  await assertKycForDeposit(userId);
  const network = await loadNetwork(input.asset, input.network);
  const address = await paymentProvider().getDepositAddress(userId, network.id);
  if (!address) throw new AppError("DEPOSIT_UNAVAILABLE");
  const amount = D(input.amount);
  if (amount.lt(network.minDeposit)) throw new AppError("BELOW_MINIMUM", `Minimum deposit is ${network.minDeposit} ${network.asset.symbol}.`);

  const deposit = await withTransaction(async (tx) => {
    const d = await tx.deposit.create({
      data: {
        userId,
        assetId: network.assetId,
        networkId: network.id,
        amount,
        txHash: input.txHash.trim(),
        address: address.address,
        status: "PENDING",
        requiredConfirmations: network.confirmations,
        provider: address.provider,
        expiresAt: new Date(Date.now() + PENDING_TTL_MS),
      },
    });
    await recordTransaction(tx, {
      userId,
      type: "DEPOSIT",
      direction: "CREDIT",
      status: "PENDING",
      assetId: network.assetId,
      amount,
      isDemo: false,
      depositId: d.id,
      description: `${network.asset.symbol} deposit via ${network.name}`,
      metadata: { txHash: d.txHash },
    });
    return d;
  });
  publish(userId, { type: "deposit.updated", depositId: deposit.id, status: deposit.status });
  return deposit;
}

/** Demo mode only: creates a clearly-labelled simulated deposit that confirms over ~30s. */
export async function simulateDeposit(userId, input) {
  if (!isDemoMode()) throw new AppError("FEATURE_DISABLED");
  const network = await loadNetwork(input.asset, input.network);
  const amount = D(input.amount);
  if (amount.lt(network.minDeposit)) throw new AppError("BELOW_MINIMUM", `Minimum deposit is ${network.minDeposit} ${network.asset.symbol}.`);
  const max = network.asset.type === "STABLECOIN" ? 100_000 : 100;
  if (amount.gt(max)) throw new AppError("ABOVE_MAXIMUM", `Simulated deposits are limited to ${max} ${network.asset.symbol}.`);

  const deposit = await withTransaction(async (tx) => {
    const d = await tx.deposit.create({
      data: {
        userId,
        assetId: network.assetId,
        networkId: network.id,
        amount,
        status: "CONFIRMING",
        requiredConfirmations: network.confirmations,
        provider: "demo-simulator",
        isDemo: true,
        expiresAt: new Date(Date.now() + PENDING_TTL_MS),
      },
    });
    await recordTransaction(tx, {
      userId,
      type: "DEPOSIT",
      direction: "CREDIT",
      status: "CONFIRMING",
      assetId: network.assetId,
      amount,
      isDemo: true,
      depositId: d.id,
      description: `Simulated ${network.asset.symbol} deposit (demo)`,
    });
    return d;
  });
  publish(userId, { type: "deposit.updated", depositId: deposit.id, status: deposit.status });
  return deposit;
}

/** Credits a deposit exactly once. Row lock + status check prevent double processing. */
/** Emails the account owner that a deposit was credited (sent in the background). */
async function emailDeposit(id) {
  const d = await prisma.deposit.findUnique({ where: { id }, include: { user: { select: { email: true } }, asset: true, network: true } });
  if (d) await emails.depositConfirmed(d.user.email, { amount: d.amount.toString(), asset: d.asset.symbol, network: d.network.name, txHash: d.txHash });
}

export async function completeDeposit(depositId, actor) {
  let priceMap = null;
  try {
    priceMap = (await getUsdtPrices()).prices;
  } catch {
    priceMap = null;
  }

  const result = await withTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Deposit" WHERE id = ${depositId} FOR UPDATE`;
    const d = await tx.deposit.findUnique({ where: { id: depositId }, include: { asset: true, network: true } });
    if (!d) throw new AppError("NOT_FOUND");
    if (d.status !== "PENDING" && d.status !== "CONFIRMING") throw new AppError("CONFLICT", `Deposit is already ${d.status.toLowerCase()}.`);

    await wallet.credit(tx, d.userId, d.assetId, d.amount);
    const updated = await tx.deposit.update({
      where: { id: d.id },
      data: { status: "COMPLETED", confirmations: Math.max(d.confirmations, d.requiredConfirmations), creditedAt: new Date(), reviewedById: actor?.id ?? null },
    });
    await tx.transaction.updateMany({ where: { depositId: d.id, type: "DEPOSIT" }, data: { status: "COMPLETED" } });
    const price = priceMap?.[d.asset.symbol];
    if (d.asset.symbol !== "USDT" && price) {
      await addToPosition(tx, d.userId, d.assetId, d.amount, d.amount.mul(price));
    }
    const n = await createNotification(
      {
        userId: d.userId,
        type: "DEPOSIT_RECEIVED",
        title: `${d.isDemo ? "Simulated deposit" : "Deposit"} received: ${d.amount.toString()} ${d.asset.symbol}`,
        body: `Your ${d.asset.symbol} deposit via ${d.network.name} has been credited to your wallet.`,
        link: "/dashboard/transactions?type=DEPOSIT",
      },
      tx,
    );
    if (actor) {
      await audit(
        {
          actorId: actor.id,
          actorEmail: actor.email,
          ip: actor.ip,
          action: "deposit.approve",
          targetType: "Deposit",
          targetId: d.id,
          metadata: { amount: d.amount.toString(), asset: d.asset.symbol, txHash: d.txHash },
        },
        tx,
      );
    }
    return { updated, n, asset: d.asset.symbol };
  });

  publish(result.updated.userId, { type: "deposit.updated", depositId, status: "COMPLETED" });
  publish(result.updated.userId, { type: "wallet.updated", assets: [result.asset] });
  announce(result.n);
  sendLater(emailDeposit(result.updated.id));
  await onQualifyingDeposit(result.updated.userId, result.updated.id).catch((e) => console.error("[referrals]", e));
  return result.updated;
}

export async function failDeposit(depositId, status, reason, actor) {
  const d = await withTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Deposit" WHERE id = ${depositId} FOR UPDATE`;
    const dep = await tx.deposit.findUnique({ where: { id: depositId } });
    if (!dep) throw new AppError("NOT_FOUND");
    if (dep.status !== "PENDING" && dep.status !== "CONFIRMING") throw new AppError("CONFLICT", `Deposit is already ${dep.status.toLowerCase()}.`);
    const updated = await tx.deposit.update({ where: { id: depositId }, data: { status, failureReason: reason, reviewedById: actor?.id ?? null } });
    await tx.transaction.updateMany({ where: { depositId, type: "DEPOSIT" }, data: { status: status === "EXPIRED" ? "EXPIRED" : "FAILED" } });
    if (actor) {
      await audit(
        {
          actorId: actor.id,
          actorEmail: actor.email,
          ip: actor.ip,
          action: status === "FAILED" ? "deposit.reject" : "deposit.expire",
          targetType: "Deposit",
          targetId: depositId,
          metadata: { reason },
        },
        tx,
      );
    }
    return updated;
  });
  publish(d.userId, { type: "deposit.updated", depositId, status });
  return d;
}

/** Demo simulator + expiry job. Called by the background scheduler. */
export async function processDepositQueue() {
  const confirming = await prisma.deposit.findMany({ where: { status: "CONFIRMING", isDemo: true }, take: 100 });
  for (const d of confirming) {
    const step = Math.max(1, Math.ceil(d.requiredConfirmations / 5));
    const next = Math.min(d.requiredConfirmations, d.confirmations + step);
    if (next >= d.requiredConfirmations) {
      await completeDeposit(d.id).catch((e) => console.error("[deposits] complete failed", e));
    } else {
      await prisma.deposit.update({ where: { id: d.id }, data: { confirmations: next } });
      publish(d.userId, { type: "deposit.updated", depositId: d.id, status: "CONFIRMING" });
    }
  }
  const expired = await prisma.deposit.findMany({ where: { status: "PENDING", expiresAt: { lt: new Date() } }, take: 100 });
  for (const d of expired) {
    await failDeposit(d.id, "EXPIRED", "No confirmation received before expiry.").catch(() => {});
  }
}
