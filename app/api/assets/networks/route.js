import { route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

/** Funding catalogue: assets and their supported networks with limits and fees. */
export const GET = route({ auth: "none" }, async () => {
  const assets = await prisma.asset.findMany({
    where: { isActive: true, networks: { some: {} } },
    orderBy: { sortOrder: "asc" },
    include: { networks: { orderBy: { code: "asc" } } },
  });
  return assets.map((a) => ({
    symbol: a.symbol,
    name: a.name,
    color: a.color,
    depositEnabled: a.depositEnabled,
    withdrawEnabled: a.withdrawEnabled,
    networks: a.networks.map((n) => ({
      code: n.code,
      name: n.name,
      minDeposit: n.minDeposit.toString(),
      minWithdrawal: n.minWithdrawal.toString(),
      withdrawalFee: n.withdrawalFee.toString(),
      confirmations: n.confirmations,
      memoRequired: n.memoRequired,
      processingTime: n.processingTime,
      depositEnabled: n.depositEnabled && a.depositEnabled,
      withdrawEnabled: n.withdrawEnabled && a.withdrawEnabled,
    })),
  }));
});
