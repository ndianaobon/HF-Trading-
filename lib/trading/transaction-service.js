import "server-only";
import { D } from "@/lib/db/decimal";
import { reference } from "@/lib/security/crypto";

const PREFIX = {
  DEPOSIT: "DEP",
  WITHDRAWAL: "WDR",
  TRADE: "TRD",
  TRANSFER: "TRF",
  INVESTMENT: "INV",
  COPY_TRADING: "CPY",
  REFERRAL: "REF",
  FEE: "FEE",
  ADJUSTMENT: "ADJ",
  PROFIT: "PRF",
};

/** TransactionService — append a ledger record inside the caller's DB transaction. */
export async function recordTransaction(tx, entry) {
  return tx.transaction.create({
    data: {
      userId: entry.userId,
      type: entry.type,
      direction: entry.direction,
      status: entry.status ?? "COMPLETED",
      assetId: entry.assetId,
      amount: D(entry.amount),
      fee: D(entry.fee ?? 0),
      reference: reference(PREFIX[entry.type]),
      idempotencyKey: entry.idempotencyKey ?? null,
      description: entry.description ?? null,
      isDemo: entry.isDemo,
      depositId: entry.depositId ?? null,
      withdrawalId: entry.withdrawalId ?? null,
      orderId: entry.orderId ?? null,
      metadata: entry.metadata ?? {},
    },
  });
}
