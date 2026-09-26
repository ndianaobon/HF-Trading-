import { NextResponse } from "next/server";
import { route, paginate, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";
import { transactionQuery, transactionWhere, toCsv } from "@/lib/services/transactions-query";

export const GET = route({ admin: "transactions.read", query: transactionQuery }, async ({ query, req }) => {
  const where = transactionWhere(query);
  if (req.nextUrl.searchParams.get("format") === "csv") {
    const rows = await prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20_000,
      include: { asset: { select: { symbol: true } }, user: { select: { email: true } } },
    });
    return new NextResponse(
      toCsv(
        rows.map((t) => ({
          date: t.createdAt,
          reference: t.reference,
          user: t.user.email,
          type: t.type,
          direction: t.direction,
          asset: t.asset.symbol,
          amount: t.amount.toString(),
          fee: t.fee.toString(),
          status: t.status,
          simulated: t.isDemo ? "yes" : "no",
        })),
      ),
      { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="transactions.csv"` } },
    );
  }
  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { asset: { select: { symbol: true, color: true } }, user: { select: { id: true, email: true } } },
      ...paginate(query.page, query.pageSize),
    }),
    prisma.transaction.count({ where }),
  ]);
  return pageResult(items, total, query.page, query.pageSize);
});
