import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";

export const GET = route({ auth: "none" }, async ({ params }) => {
  const trader = await prisma.copyTrader.findFirst({ where: { OR: [{ id: params.id }, { slug: params.id }], isActive: true } });
  if (!trader) throw new AppError("NOT_FOUND");
  return trader;
});
