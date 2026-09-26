import { route } from "@/lib/api/route";
import { getWallets } from "@/lib/trading/wallet-service";
import { getUsdtPrices } from "@/lib/market-data/service";
import { prisma } from "@/lib/db/prisma";

export const GET = route({ auth: "user" }, async ({ session }) => {
  const [wallets, networks] = await Promise.all([
    getWallets(session.user.id),
    prisma.network.findMany({ select: { assetId: true, code: true, depositEnabled: true, withdrawEnabled: true } }),
  ]);
  let prices = null;
  try {
    prices = (await getUsdtPrices()).prices;
  } catch {
    prices = null;
  }
  return wallets.map((w) => {
    const nets = networks.filter((n) => n.assetId === w.assetId);
    const price = prices?.[w.symbol] ?? null;
    return {
      symbol: w.symbol,
      name: w.name,
      color: w.color,
      type: w.type,
      available: w.available.toString(),
      locked: w.locked.toString(),
      total: w.total.toString(),
      price,
      valueUsdt: price !== null ? w.total.toNumber() * price : null,
      canDeposit: w.depositEnabled && nets.some((n) => n.depositEnabled),
      canWithdraw: w.withdrawEnabled && nets.some((n) => n.withdrawEnabled),
    };
  });
});
