import { z } from "zod";
import { route, paginationSchema, paginate, pageResult } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { depositReportSchema } from "@/lib/validation/schemas";
import { reportDeposit } from "@/lib/payments/deposit-service";
import { prisma } from "@/lib/db/prisma";

const query = z.object({ ...paginationSchema });

export const GET = route({ auth: "user", query }, async ({ session, query }) => {
  const where = { userId: session.user.id };
  const [items, total] = await Promise.all([
    prisma.deposit.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { asset: { select: { symbol: true, color: true } }, network: { select: { code: true, name: true } } },
      ...paginate(query.page, query.pageSize),
    }),
    prisma.deposit.count({ where }),
  ]);
  return pageResult(items, total, query.page, query.pageSize);
});

/**
 * Report an on-chain deposit to a configured address (live/manual mode).
 * Multipart (with an optional payment screenshot in `proof`) or JSON.
 */
export const POST = route({ auth: "verified", rateLimit: RATE_LIMITS.money }, async ({ session, req }) => {
  const type = req.headers.get("content-type") ?? "";
  let fields;
  let proof = null;
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    fields = Object.fromEntries(["asset", "network", "amount", "txHash"].map((k) => [k, form.get(k) ?? undefined]));
    const file = form.get("proof");
    if (file instanceof File && file.size > 0) proof = file;
  } else {
    fields = await req.json().catch(() => {
      throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON.");
    });
  }
  return reportDeposit(session.user.id, depositReportSchema.parse(fields), proof);
});
