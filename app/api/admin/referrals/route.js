import { z } from "zod";
import { route, paginationSchema, paginate, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

const query = z.object({ rewardStatus: z.enum(["PENDING", "COMPLETED", "CANCELLED"]).optional(), ...paginationSchema });

export const GET = route({ admin: "referrals.manage", query }, async ({ query }) => {
  const where = query.rewardStatus ? { status: query.rewardStatus } : {};
  const [rewards, total, referralCount, activeCount] = await Promise.all([
    prisma.referralReward.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { email: true } }, asset: { select: { symbol: true } }, referral: { include: { referred: { select: { email: true } } } } },
      ...paginate(query.page, query.pageSize),
    }),
    prisma.referralReward.count({ where }),
    prisma.referral.count(),
    prisma.referral.count({ where: { status: "ACTIVE" } }),
  ]);
  return { ...pageResult(rewards, total, query.page, query.pageSize), referralCount, activeCount };
});
