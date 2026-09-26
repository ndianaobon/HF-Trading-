import { route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";
import { appUrl } from "@/lib/config";
import { getSetting } from "@/lib/services/settings";

/** Referred users are shown with masked identities. */
function mask(email) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}${"•".repeat(Math.max(2, local.length - 2))}@${domain}`;
}

export const GET = route({ auth: "user" }, async ({ session }) => {
  const userId = session.user.id;
  const [referrals, rewards, program] = await Promise.all([
    prisma.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: "desc" },
      include: { referred: { select: { email: true, createdAt: true } }, rewards: true },
    }),
    prisma.referralReward.findMany({ where: { userId }, include: { asset: { select: { symbol: true } } } }),
    getSetting("referral.program"),
  ]);
  const sum = (status) => rewards.filter((r) => r.status === status).reduce((s, r) => s + r.amount.toNumber(), 0);
  return {
    code: session.user.referralCode,
    link: `${appUrl()}/register?ref=${session.user.referralCode}`,
    program: {
      enabled: program.enabled,
      rewardAsset: program.rewardAsset,
      rewardAmount: program.rewardAmount,
      qualifyingAction: program.qualifyingAction,
      minQualifyingDeposit: program.minQualifyingDeposit,
      terms: program.terms,
    },
    stats: {
      total: referrals.length,
      active: referrals.filter((r) => r.status === "ACTIVE").length,
      rewardsTotal: sum("COMPLETED") + sum("PENDING"),
      pending: sum("PENDING"),
      completed: sum("COMPLETED"),
      asset: program.rewardAsset,
    },
    referrals: referrals.map((r) => ({
      id: r.id,
      user: mask(r.referred.email),
      registeredAt: r.referred.createdAt,
      status: r.status,
      reward: r.rewards.reduce((s, x) => s + (x.status !== "CANCELLED" ? x.amount.toNumber() : 0), 0),
      rewardStatus: r.rewards[0]?.status ?? null,
      isDemo: r.rewards.some((x) => x.isDemo),
    })),
  };
});
