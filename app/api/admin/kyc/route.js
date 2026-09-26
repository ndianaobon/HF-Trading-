import { z } from "zod";
import { route, paginationSchema, paginate, pageResult } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

const query = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(), q: z.string().max(80).optional(), ...paginationSchema });

export const GET = route({ admin: "kyc.read", query }, async ({ query }) => {
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.q ? { OR: [{ fullName: { contains: query.q, mode: "insensitive" } }, { user: { email: { contains: query.q, mode: "insensitive" } } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.kycApplication.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        status: true,
        fullName: true,
        country: true,
        idType: true,
        submittedAt: true,
        reviewedAt: true,
        rejectionReason: true,
        user: { select: { id: true, email: true, isDemo: true } },
        _count: { select: { documents: true } },
      },
      ...paginate(query.page, query.pageSize),
    }),
    prisma.kycApplication.count({ where }),
  ]);
  return pageResult(items, total, query.page, query.pageSize);
});
