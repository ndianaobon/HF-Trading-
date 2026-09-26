import { NextResponse } from "next/server";
import { route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

/** Published fee schedule: trading fees, network fees/minimums and plan fees. */
export const GET = route({ auth: "none" }, async () => {
  const [fees, networks, plans] = await Promise.all([
    prisma.feeConfiguration.findMany({ where: { isActive: true, type: { in: ["TRADING_MAKER", "TRADING_TAKER"] }, marketId: null, assetId: null } }),
    prisma.network.findMany({ include: { asset: true }, orderBy: [{ asset: { sortOrder: "asc" } }, { code: "asc" }] }),
    prisma.investmentPlan.findMany({ where: { status: "ACTIVE" }, orderBy: { sortOrder: "asc" } }),
  ]);
  const rate = (t) => fees.find((f) => f.type === t)?.rate.toString() ?? "0.001";
  const data = {
    trading: { maker: rate("TRADING_MAKER"), taker: rate("TRADING_TAKER") },
    networks: networks.map((n) => ({
      asset: n.asset.symbol,
      name: n.name,
      minDeposit: n.minDeposit.toString(),
      minWithdrawal: n.minWithdrawal.toString(),
      withdrawalFee: n.withdrawalFee.toString(),
      confirmations: n.confirmations,
    })),
    plans: plans.map((p) => ({
      name: p.name,
      managementFeePct: p.managementFeePct.toString(),
      performanceFeePct: p.performanceFeePct.toString(),
      earlyExitAllowed: p.earlyExitAllowed,
      earlyExitFeePct: p.earlyExitFeePct.toString(),
    })),
  };
  return NextResponse.json({ data }, { headers: { "Cache-Control": "public, max-age=60" } });
});
