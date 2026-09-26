import "server-only";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/config";

/** Addresses configured by administrators (WalletAddress table). */
class ManualProvider {
  id = "manual";
  name = "Manual review";

  async getDepositAddress(userId, networkId) {
    const assigned = await prisma.walletAddress.findFirst({
      where: { networkId, userId, isActive: true },
      orderBy: { createdAt: "desc" },
    });
    const row = assigned ?? (await prisma.walletAddress.findFirst({ where: { networkId, userId: null, isActive: true }, orderBy: { createdAt: "desc" } }));
    if (!row) return null;
    return { address: row.address, memo: row.memo, provider: row.provider, shared: row.userId === null };
  }
}

const registry = {
  manual: new ManualProvider(),
};

export function paymentProvider() {
  return registry[env().PAYMENT_PROVIDER] ?? registry.manual;
}
