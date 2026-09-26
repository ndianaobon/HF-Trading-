import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";

export const GET = route({ auth: "user" }, async ({ session }) => {
  const favs = await prisma.favoriteMarket.findMany({ where: { userId: session.user.id }, include: { market: { select: { symbol: true } } } });
  return favs.map((f) => f.market.symbol);
});

export const POST = route({ auth: "user", body: z.object({ market: z.string().max(20) }) }, async ({ session, body }) => {
  const market = await prisma.market.findUnique({ where: { symbol: body.market } });
  if (!market) throw new AppError("NOT_FOUND", "Unknown market.");
  const key = { userId_marketId: { userId: session.user.id, marketId: market.id } };
  const existing = await prisma.favoriteMarket.findUnique({ where: key });
  if (existing) await prisma.favoriteMarket.delete({ where: key });
  else await prisma.favoriteMarket.create({ data: { userId: session.user.id, marketId: market.id } });
  return { market: body.market, favorite: !existing };
});
