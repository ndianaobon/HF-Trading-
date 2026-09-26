import { route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

/** Platform liabilities per asset (sum of customer balances) plus funding configuration. */
export const GET = route({ admin: "wallets.read" }, async () => {
  const [sums, assets, networks, addresses] = await Promise.all([
    prisma.wallet.groupBy({
      by: ["assetId"],
      _sum: { available: true, locked: true },
      _count: { _all: true },
      where: { OR: [{ available: { gt: 0 } }, { locked: { gt: 0 } }] },
    }),
    prisma.asset.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.network.findMany({
      include: { asset: { select: { symbol: true } }, _count: { select: { addresses: { where: { isActive: true } } } } },
      orderBy: [{ assetId: "asc" }, { code: "asc" }],
    }),
    prisma.walletAddress.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { network: { include: { asset: { select: { symbol: true } } } }, user: { select: { email: true } } },
    }),
  ]);
  const bySum = new Map(sums.map((s) => [s.assetId, s]));
  return {
    balances: assets
      .map((a) => {
        const s = bySum.get(a.id);
        return {
          symbol: a.symbol,
          name: a.name,
          color: a.color,
          available: s?._sum.available?.toString() ?? "0",
          locked: s?._sum.locked?.toString() ?? "0",
          holders: s?._count._all ?? 0,
          depositEnabled: a.depositEnabled,
          withdrawEnabled: a.withdrawEnabled,
        };
      })
      .filter((b) => b.holders > 0 || b.depositEnabled),
    networks: networks.map((n) => ({
      id: n.id,
      asset: n.asset.symbol,
      code: n.code,
      name: n.name,
      minDeposit: n.minDeposit.toString(),
      minWithdrawal: n.minWithdrawal.toString(),
      withdrawalFee: n.withdrawalFee.toString(),
      confirmations: n.confirmations,
      processingTime: n.processingTime,
      depositEnabled: n.depositEnabled,
      withdrawEnabled: n.withdrawEnabled,
      activeAddresses: n._count.addresses,
    })),
    addresses: addresses.map((a) => ({
      id: a.id,
      asset: a.network.asset.symbol,
      network: a.network.code,
      address: a.address,
      memo: a.memo,
      label: a.label,
      provider: a.provider,
      isActive: a.isActive,
      assignedTo: a.user?.email ?? null,
      createdAt: a.createdAt,
    })),
  };
});
