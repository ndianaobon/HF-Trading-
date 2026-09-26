import { z } from "zod";
import { NextResponse } from "next/server";
import { route } from "@/lib/api/route";
import { platformSeries } from "@/lib/services/reports";
import { toCsv } from "@/lib/services/transactions-query";

const query = z.object({ range: z.enum(["7", "30", "90", "180"]).default("30"), format: z.enum(["json", "csv"]).default("json") });

export const GET = route({ admin: "reports.read", query }, async ({ query }) => {
  const series = await platformSeries(Number(query.range));
  if (query.format === "csv") {
    return new NextResponse(toCsv(series), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="harborfinance-report-${query.range}d.csv"` },
    });
  }
  const totals = series.reduce(
    (a, d) => ({
      signups: a.signups + d.signups,
      volume: a.volume + d.volume,
      deposits: a.deposits + d.deposits,
      withdrawals: a.withdrawals + d.withdrawals,
      revenue: a.revenue + d.revenue,
    }),
    { signups: 0, volume: 0, deposits: 0, withdrawals: 0, revenue: 0 },
  );
  return { series, totals };
});
