import { z } from "zod";
import { route, paginate, paginationSchema, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";
import { getTickers } from "@/lib/market-data/service";
import { createSignal } from "@/lib/services/copy-trading";
import { signalSchema } from "@/lib/validation/admin";

const query = z.object({
  ...paginationSchema,
  traderId: z.string().max(40).optional(),
  status: z.enum(["CREATED", "ACTIVE", "EXECUTED", "CLOSED", "CANCELLED", "LIVE"]).optional(),
});

export const GET = route({ admin: "copytraders.manage", query }, async ({ query }) => {
  const where = {
    ...(query.traderId ? { traderId: query.traderId } : {}),
    ...(query.status === "LIVE" ? { status: { in: ["CREATED", "ACTIVE", "EXECUTED"] } } : query.status ? { status: query.status } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.copySignal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...paginate(query.page, query.pageSize),
      include: { trader: { select: { displayName: true, avatarColor: true } }, market: { select: { symbol: true, pricePrecision: true } } },
    }),
    prisma.copySignal.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  const trades = ids.length ? await prisma.copyTrade.groupBy({ by: ["signalId", "status"], where: { signalId: { in: ids } }, _count: { _all: true }, _sum: { netPnl: true } }) : [];
  let tickers = null;
  try {
    tickers = (await getTickers()).tickers;
  } catch {
    // prices unavailable: currentPrice is null
  }
  const items = rows.map((s) => {
    const mine = trades.filter((t) => t.signalId === s.id);
    const n = (st) => mine.filter((t) => t.status === st).reduce((a, t) => a + t._count._all, 0);
    return {
      ...s,
      currentPrice: tickers?.get(s.market.symbol)?.lastPrice ?? null,
      copies: { open: n("OPEN"), closed: n("CLOSED"), failed: n("FAILED"), pending: n("PENDING") },
      realizedPnl: mine.filter((t) => t.status === "CLOSED").reduce((a, t) => a + Number(t._sum.netPnl ?? 0), 0),
    };
  });
  return pageResult(items, total, query.page, query.pageSize);
});

export const POST = route({ admin: "copytraders.manage", body: signalSchema }, async ({ session, body, ip }) => createSignal(body, { id: session.user.id, email: session.user.email, ip }));
