import "server-only";
import { emails, sendLater } from "@/lib/email/mailer";
import { prisma, withTransaction } from "@/lib/db/prisma";
import { D } from "@/lib/db/decimal";
import { AppError } from "@/lib/api/errors";
import { isDemoMode } from "@/lib/config";
import * as wallet from "@/lib/trading/wallet-service";
import { recordTransaction } from "@/lib/trading/transaction-service";
import { reducePosition } from "@/lib/trading/positions";
import { announce, createNotification } from "@/lib/notifications/service";
import { publish } from "@/lib/realtime/bus";
import { getSetting } from "@/lib/services/settings";
import { confirmSensitiveAction } from "@/lib/auth/confirm";
import { audit } from "@/lib/services/audit";
import { paymentProvider } from "./providers";

export async function withdrawalQuote(assetSymbol, networkCode) {
  const network = await prisma.network.findFirst({ where: { code: networkCode, asset: { symbol: assetSymbol.toUpperCase() } }, include: { asset: true } });
  if (!network) throw new AppError("UNSUPPORTED_NETWORK");
  return {
    asset: network.asset.symbol,
    network: network.code,
    networkName: network.name,
    fee: network.withdrawalFee.toString(),
    minWithdrawal: network.minWithdrawal.toString(),
    memoRequired: network.memoRequired,
    processingTime: network.processingTime, // null unless configured by an administrator
    enabled: network.asset.withdrawEnabled && network.withdrawEnabled,
  };
}

/**
 * Withdrawal request: validates, performs step-up auth, then atomically moves
 * amount + fee from available to locked. Funds leave the account only when an
 * administrator marks the withdrawal completed with an on-chain reference.
 */
export async function requestWithdrawal(userId, input, meta) {
  const network = await prisma.network.findFirst({ where: { code: input.network, asset: { symbol: input.asset.toUpperCase() } }, include: { asset: true } });
  if (!network) throw new AppError("UNSUPPORTED_NETWORK");
  if (!network.asset.withdrawEnabled || !network.withdrawEnabled) throw new AppError("WITHDRAWAL_UNAVAILABLE");

  const address = input.address.trim();
  if (network.addressPattern && !new RegExp(network.addressPattern).test(address)) throw new AppError("INVALID_ADDRESS");
  if (network.memoRequired && !input.memo?.trim()) throw new AppError("VALIDATION_ERROR", "A memo / destination tag is required for this network.");

  const amount = D(input.amount);
  if (!amount.isFinite() || amount.lte(0)) throw new AppError("VALIDATION_ERROR", "Enter a valid amount.");
  if (amount.lt(network.minWithdrawal)) throw new AppError("BELOW_MINIMUM", `Minimum withdrawal is ${network.minWithdrawal} ${network.asset.symbol}.`);
  const fee = network.withdrawalFee;
  const total = amount.plus(fee);

  const kyc = await getSetting("kyc.requirements");
  if (kyc.requiredForWithdrawal) {
    const approved = await prisma.kycApplication.findFirst({ where: { userId, status: "APPROVED" } });
    if (!approved) throw new AppError("KYC_REQUIRED");
  }

  await confirmSensitiveAction(userId, { code: input.code, password: input.password });

  const w = await withTransaction(async (tx) => {
    await wallet.lock(tx, userId, network.assetId, total);
    const created = await tx.withdrawal.create({
      data: {
        userId,
        assetId: network.assetId,
        networkId: network.id,
        amount,
        fee,
        totalDebit: total,
        address,
        memo: input.memo?.trim() || null,
        status: "PENDING_REVIEW",
        isDemo: isDemoMode(),
        requestedIp: meta.ip,
      },
    });
    await recordTransaction(tx, {
      userId,
      type: "WITHDRAWAL",
      direction: "DEBIT",
      status: "PENDING",
      assetId: network.assetId,
      amount,
      fee,
      isDemo: created.isDemo,
      withdrawalId: created.id,
      description: `${network.asset.symbol} withdrawal via ${network.name}${created.isDemo ? " (demo)" : ""}`,
      metadata: { address },
    });
    const n = await createNotification(
      {
        userId,
        type: "WITHDRAWAL_STATUS",
        title: `Withdrawal requested: ${amount} ${network.asset.symbol}`,
        body: "Your withdrawal is pending review. You'll be notified when its status changes.",
        link: "/dashboard/withdraw",
      },
      tx,
    );
    await audit(
      {
        actorId: userId,
        actorEmail: meta.email ?? null,
        action: "withdrawal.request",
        targetType: "Withdrawal",
        targetId: created.id,
        ip: meta.ip,
        metadata: { amount: amount.toString(), asset: network.asset.symbol, network: network.code },
      },
      tx,
    );
    return { created, n };
  });

  publish(userId, { type: "withdrawal.updated", withdrawalId: w.created.id, status: w.created.status });
  publish(userId, { type: "wallet.updated", assets: [network.asset.symbol] });
  announce(w.n);
  sendLater(emailWithdrawal(w.created.id, "requested"));
  return w.created;
}

async function lockWithdrawal(tx, id) {
  await tx.$queryRaw`SELECT id FROM "Withdrawal" WHERE id = ${id} FOR UPDATE`;
  const w = await tx.withdrawal.findUnique({ where: { id }, include: { asset: true, network: true } });
  if (!w) throw new AppError("NOT_FOUND");
  return w;
}

async function notifyStatus(tx, w, asset, title, body) {
  return createNotification(
    { userId: w.userId, type: "WITHDRAWAL_STATUS", title: `${title}: ${w.amount.toString()} ${asset}`, body, link: "/dashboard/withdraw" },
    tx,
  );
}

export async function cancelWithdrawalByUser(userId, id) {
  const res = await withTransaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.userId !== userId) throw new AppError("NOT_FOUND");
    if (w.status !== "PENDING_REVIEW") throw new AppError("CONFLICT", "Only withdrawals pending review can be cancelled.");
    await wallet.unlock(tx, userId, w.assetId, w.totalDebit);
    await tx.transaction.updateMany({ where: { withdrawalId: id }, data: { status: "CANCELLED" } });
    return tx.withdrawal.update({ where: { id }, data: { status: "CANCELLED" } });
  });
  publish(userId, { type: "withdrawal.updated", withdrawalId: id, status: "CANCELLED" });
  publish(userId, { type: "wallet.updated", assets: [] });
  return res;
}

/** Admin: approve for processing. Uses the provider's automated payout if available. */
export async function approveWithdrawal(id, actor, note) {
  const res = await withTransaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.status !== "PENDING_REVIEW") throw new AppError("CONFLICT", `Withdrawal is ${w.status.toLowerCase().replace("_", " ")}.`);
    const updated = await tx.withdrawal.update({
      where: { id },
      data: { status: "PROCESSING", processedAt: new Date(), reviewedById: actor.id, reviewNote: note ?? null },
    });
    const n = await notifyStatus(tx, w, w.asset.symbol, "Withdrawal approved", "Your withdrawal has been approved and is being processed.");
    await audit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        ip: actor.ip,
        userAgent: actor.userAgent,
        action: "withdrawal.approve",
        targetType: "Withdrawal",
        targetId: id,
        metadata: { note },
      },
      tx,
    );
    return { updated, n, w };
  });
  const provider = paymentProvider();
  if (provider.submitWithdrawal && !res.w.isDemo) {
    await provider.submitWithdrawal({
      withdrawalId: id,
      asset: res.w.asset.symbol,
      network: res.w.network.code,
      address: res.w.address,
      memo: res.w.memo,
      amount: res.w.amount.toString(),
    });
  }
  publish(res.updated.userId, { type: "withdrawal.updated", withdrawalId: id, status: "PROCESSING" });
  announce(res.n);
  return res.updated;
}

/** Emails the account owner about a withdrawal (sent in the background). */
async function emailWithdrawal(id, kind) {
  const w = await prisma.withdrawal.findUnique({ where: { id }, include: { user: { select: { email: true } }, asset: true, network: true } });
  if (!w) return;
  const base = { amount: w.amount.toString(), fee: w.fee.toString(), asset: w.asset.symbol, network: w.network.name, address: w.address };
  if (kind === "requested") return emails.withdrawalRequested(w.user.email, base);
  if (kind === "completed") return emails.withdrawalCompleted(w.user.email, { ...base, txHash: w.txHash });
  return emails.withdrawalRejected(w.user.email, { ...base, reason: w.rejectionReason, failed: w.status === "FAILED" });
}

/** Admin: mark completed. Requires the on-chain transaction hash for live withdrawals. */
export async function completeWithdrawal(id, actor, txHash) {
  const res = await withTransaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    if (w.status !== "PROCESSING") throw new AppError("CONFLICT", "Only withdrawals in processing can be completed.");
    if (!w.isDemo && !txHash?.trim()) throw new AppError("VALIDATION_ERROR", "An on-chain transaction hash is required to mark a withdrawal completed.");
    await wallet.consumeLocked(tx, w.userId, w.assetId, w.totalDebit);
    const pos = await tx.position.findUnique({ where: { userId_assetId: { userId: w.userId, assetId: w.assetId } } });
    if (pos && pos.quantity.gt(0)) await reducePosition(tx, w.userId, w.assetId, w.amount, w.amount.mul(pos.avgCost));
    const updated = await tx.withdrawal.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date(), txHash: txHash?.trim() || null } });
    await tx.transaction.updateMany({ where: { withdrawalId: id }, data: { status: "COMPLETED" } });
    const n = await notifyStatus(
      tx,
      w,
      w.asset.symbol,
      "Withdrawal successful",
      txHash ? `Transaction hash: ${txHash}` : "Your simulated withdrawal was successful (demo).",
    );
    await audit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        ip: actor.ip,
        userAgent: actor.userAgent,
        action: "withdrawal.complete",
        targetType: "Withdrawal",
        targetId: id,
        metadata: { txHash },
      },
      tx,
    );
    return { updated, n, asset: w.asset.symbol };
  });
  publish(res.updated.userId, { type: "withdrawal.updated", withdrawalId: id, status: "COMPLETED" });
  publish(res.updated.userId, { type: "wallet.updated", assets: [res.asset] });
  announce(res.n);
  sendLater(emailWithdrawal(id, "completed"));
  return res.updated;
}

/** Admin: reject (from review) or mark failed (from processing). Funds are returned. */
export async function rejectWithdrawal(id, actor, reason, as) {
  const res = await withTransaction(async (tx) => {
    const w = await lockWithdrawal(tx, id);
    const allowed = as === "REJECTED" ? ["PENDING_REVIEW"] : ["PENDING_REVIEW", "PROCESSING"];
    if (!allowed.includes(w.status)) throw new AppError("CONFLICT", `Withdrawal is ${w.status.toLowerCase().replace("_", " ")}.`);
    await wallet.unlock(tx, w.userId, w.assetId, w.totalDebit);
    const updated = await tx.withdrawal.update({ where: { id }, data: { status: as, rejectionReason: reason, reviewedById: actor.id } });
    await tx.transaction.updateMany({ where: { withdrawalId: id }, data: { status: as === "REJECTED" ? "CANCELLED" : "FAILED" } });
    const n = await notifyStatus(
      tx,
      w,
      w.asset.symbol,
      as === "REJECTED" ? "Withdrawal rejected" : "Withdrawal failed",
      `Reason: ${reason}. The funds have been returned to your available balance.`,
    );
    await audit(
      {
        actorId: actor.id,
        actorEmail: actor.email,
        ip: actor.ip,
        userAgent: actor.userAgent,
        action: as === "REJECTED" ? "withdrawal.reject" : "withdrawal.fail",
        targetType: "Withdrawal",
        targetId: id,
        metadata: { reason },
      },
      tx,
    );
    return { updated, n, asset: w.asset.symbol };
  });
  publish(res.updated.userId, { type: "withdrawal.updated", withdrawalId: id, status: as });
  publish(res.updated.userId, { type: "wallet.updated", assets: [res.asset] });
  announce(res.n);
  sendLater(emailWithdrawal(id, "rejected"));
  return res.updated;
}

/** Internal transfer between HarborFinance accounts (instant, no network fee). */
export async function internalTransfer(userId, input) {
  const asset = await wallet.assetBySymbol(input.asset);
  const amount = D(input.amount);
  if (!amount.isFinite() || amount.lte(0)) throw new AppError("VALIDATION_ERROR", "Enter a valid amount.");
  const recipient = await prisma.user.findUnique({ where: { email: input.recipientEmail.trim().toLowerCase() } });
  if (!recipient || recipient.status !== "ACTIVE") throw new AppError("NOT_FOUND", "No active HarborFinance account uses that email.");
  if (recipient.id === userId) throw new AppError("VALIDATION_ERROR", "You cannot transfer to your own account.");
  await confirmSensitiveAction(userId, { code: input.code, password: input.password });

  const demo = isDemoMode();
  const res = await withTransaction(async (tx) => {
    await wallet.debit(tx, userId, asset.id, amount);
    await wallet.credit(tx, recipient.id, asset.id, amount);
    const out = await recordTransaction(tx, {
      userId,
      type: "TRANSFER",
      direction: "DEBIT",
      assetId: asset.id,
      amount,
      isDemo: demo,
      description: `Transfer to ${recipient.email}`,
      metadata: { counterparty: recipient.id, note: input.note },
    });
    await recordTransaction(tx, {
      userId: recipient.id,
      type: "TRANSFER",
      direction: "CREDIT",
      assetId: asset.id,
      amount,
      isDemo: demo,
      description: "Internal transfer received",
      metadata: { counterparty: userId, reference: out.reference, note: input.note },
    });
    const n = await createNotification(
      {
        userId: recipient.id,
        type: "DEPOSIT_RECEIVED",
        title: `Transfer received: ${amount} ${asset.symbol}`,
        body: "An internal transfer from another HarborFinance account was credited to your wallet.",
        link: "/dashboard/transactions?type=TRANSFER",
      },
      tx,
    );
    return { out, n };
  });
  publish(userId, { type: "wallet.updated", assets: [asset.symbol] });
  publish(recipient.id, { type: "wallet.updated", assets: [asset.symbol] });
  announce(res.n);
  return res.out;
}
