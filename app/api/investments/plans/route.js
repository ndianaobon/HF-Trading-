import { route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

export const GET = route({ auth: "none" }, async () =>
  prisma.investmentPlan.findMany({
    where: { status: "ACTIVE" },
    orderBy: { sortOrder: "asc" },
    include: { asset: { select: { symbol: true } } },
  }),
);
