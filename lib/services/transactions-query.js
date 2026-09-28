import "server-only";
import { z } from "zod";
import { paginationSchema } from "@/lib/api/route";

export const TX_TYPES = ["DEPOSIT", "WITHDRAWAL", "TRADE", "TRANSFER", "INVESTMENT", "COPY_TRADING", "REFERRAL", "FEE", "ADJUSTMENT", "PROFIT"];
export const TX_STATUSES = ["PENDING", "CONFIRMING", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED"];

export const transactionQuery = z.object({
  type: z.enum(TX_TYPES).optional(),
  status: z.enum(TX_STATUSES).optional(),
  asset: z.string().max(10).optional(),
  q: z.string().trim().max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  userId: z.string().max(40).optional(),
  ...paginationSchema,
});

export function transactionWhere(query, userId) {
  return {
    ...(userId ? { userId } : query.userId ? { userId: query.userId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.asset ? { asset: { symbol: query.asset.toUpperCase() } } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
      : {}),
    ...(query.q
      ? {
          OR: [
            { reference: { contains: query.q, mode: "insensitive" } },
            { id: query.q },
            { description: { contains: query.q, mode: "insensitive" } },
            ...(userId ? [] : [{ user: { email: { contains: query.q, mode: "insensitive" } } }]),
          ],
        }
      : {}),
  };
}

export function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    // Neutralise spreadsheet formula injection.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}
