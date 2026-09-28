import { NextResponse } from "next/server";
import { route, paginate, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";
import { transactionQuery, transactionWhere, toCsv } from "@/lib/services/transactions-query";

export const GET = route({ auth: "user", query: transactionQuery }, async ({ session, query, req }) => {
  const where = transactionWhere(query, session.user.id);

  if (req.nextUrl.searchParams.get("format") === "csv") {
    const rows = await prisma.transaction.findMany({ where, orderBy: { createdAt: "desc" }, take: 5000, include: { asset: { select: { symbol: true } } } });
    const csv = toCsv(
      rows.map((t) => ({
        date: t.createdAt,
        reference: t.reference,
        type: t.metadata?.express ? "EXPRESS_DEPOSIT" : t.type,
        direction: t.direction,
        asset: t.asset.symbol,
        amount: t.amount.toString(),
        fee: t.fee.toString(),
        status: t.status,
        simulated: t.isDemo ? "yes" : "no",
        description: t.description ?? "",
      })),
    );
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="harborfinance-transactions.csv"` },
    });
  }

  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { asset: { select: { symbol: true, color: true } } },
      ...paginate(query.page, query.pageSize),
    }),
    prisma.transaction.count({ where }),
  ]);
  return pageResult(items, total, query.page, query.pageSize);
});
